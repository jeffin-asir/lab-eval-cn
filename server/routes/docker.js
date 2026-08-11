import express from 'express';
import { docker } from '../docker/dockerManager.js';
import { authorize, requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth, authorize('faculty', 'admin'));

const LEGACY_CONTAINER_PREFIX = 'lab_exam_';
const LEGACY_VOLUME_PREFIX = 'lab_data_';
const LAB_PREFIX = 'lab_';

function isLabContainerName(name) {
  return name.startsWith(LAB_PREFIX) || name.startsWith(LEGACY_CONTAINER_PREFIX);
}

function isLabVolumeName(name) {
  return name.startsWith(LAB_PREFIX) || name.startsWith(LEGACY_VOLUME_PREFIX);
}

// New layout: container and volume share the same `lab_{userId}_{sessionId}` name.
// Legacy layout: lab_exam_* containers paired with lab_data_* volumes.
function volumeNameToContainerName(volumeName) {
  if (volumeName.startsWith(LAB_PREFIX) && !volumeName.startsWith(LEGACY_CONTAINER_PREFIX)) {
    return volumeName;
  }
  if (volumeName.startsWith(LEGACY_VOLUME_PREFIX)) {
    return `${LEGACY_CONTAINER_PREFIX}${volumeName.slice(LEGACY_VOLUME_PREFIX.length)}`;
  }
  return null;
}

function formatContainer(container) {
  const names = (container.Names || []).map((name) => name.replace(/^\//, ''));
  return {
    id: container.Id,
    shortId: container.Id.slice(0, 12),
    names,
    name: names[0] || container.Id.slice(0, 12),
    image: container.Image,
    state: container.State,
    status: container.Status,
    created: container.Created ? new Date(container.Created * 1000).toISOString() : null,
    ports: container.Ports || [],
    isLabContainer: names.some((name) => isLabContainerName(name)),
  };
}

function formatVolume(volume, usageByName, existingContainerNames) {
  const name = volume.Name;
  const usage = usageByName.get(name);
  const isLabVolume = isLabVolumeName(name);
  const linkedContainer = isLabVolume ? volumeNameToContainerName(name) : null;
  const containerExists = linkedContainer ? existingContainerNames.has(linkedContainer) : null;
  const inUse = usage ? usage.RefCount > 0 : containerExists;

  return {
    name,
    driver: volume.Driver,
    mountpoint: volume.Mountpoint,
    created: volume.CreatedAt || null,
    isLabVolume,
    linkedContainer,
    containerExists,
    sizeBytes: usage && typeof usage.Size === 'number' && usage.Size >= 0 ? usage.Size : null,
    refCount: usage ? usage.RefCount : null,
    inUse,
  };
}

router.get('/containers', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    res.json(containers.map(formatContainer));
  } catch (err) {
    console.error('[docker] list containers error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/containers/:id', async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    const inspect = await container.inspect();
    const name = String(inspect.Name || '').replace(/^\//, '');

    await container.remove({ force: req.query.force === '1' });
    res.json({ success: true, removed: name || req.params.id });
  } catch (err) {
    console.error('[docker] remove container error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/prune-lab-containers', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    const stoppedLabContainers = containers.filter((container) => {
      const names = (container.Names || []).map((name) => name.replace(/^\//, ''));
      return container.State !== 'running' && names.some((name) => isLabContainerName(name));
    });

    const removed = [];
    for (const info of stoppedLabContainers) {
      const container = docker.getContainer(info.Id);
      await container.remove({ force: true });
      removed.push(formatContainer(info));
    }

    res.json({ success: true, removedCount: removed.length, removed });
  } catch (err) {
    console.error('[docker] prune lab containers error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/volumes', async (req, res) => {
  try {
    const [volumesResult, containers] = await Promise.all([
      docker.listVolumes(),
      docker.listContainers({ all: true }),
    ]);
    const existingContainerNames = new Set(
      containers.flatMap((c) => (c.Names || []).map((name) => name.replace(/^\//, '')))
    );

    const usageByName = new Map();
    try {
      const df = await docker.df();
      for (const v of df.Volumes || []) {
        usageByName.set(v.Name, { Size: v.UsageData?.Size ?? -1, RefCount: v.UsageData?.RefCount ?? 0 });
      }
    } catch (err) {
      console.warn('[docker] df() unavailable, volume sizes will be omitted:', err.message);
    }

    const volumes = (volumesResult.Volumes || []).map((v) => formatVolume(v, usageByName, existingContainerNames));
    res.json(volumes);
  } catch (err) {
    console.error('[docker] list volumes error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/volumes/:name', async (req, res) => {
  try {
    const volume = docker.getVolume(req.params.name);
    await volume.remove({ force: req.query.force === '1' });
    res.json({ success: true, removed: req.params.name });
  } catch (err) {
    console.error('[docker] remove volume error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/prune-orphaned-volumes', async (req, res) => {
  try {
    const [volumesResult, containers] = await Promise.all([
      docker.listVolumes(),
      docker.listContainers({ all: true }),
    ]);
    const existingContainerNames = new Set(
      containers.flatMap((c) => (c.Names || []).map((name) => name.replace(/^\//, '')))
    );

    const orphaned = (volumesResult.Volumes || []).filter((v) => {
      const linkedContainer = volumeNameToContainerName(v.Name);
      return linkedContainer && !existingContainerNames.has(linkedContainer);
    });

    const removed = [];
    const failed = [];
    for (const v of orphaned) {
      try {
        await docker.getVolume(v.Name).remove({ force: true });
        removed.push(v.Name);
      } catch (err) {
        failed.push({ name: v.Name, error: err.message });
      }
    }

    res.json({ success: true, removedCount: removed.length, removed, failed });
  } catch (err) {
    console.error('[docker] prune orphaned volumes error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
