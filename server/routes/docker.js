import express from 'express';
import { docker } from '../docker/dockerManager.js';
import { authorize, requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth, authorize('admin'));

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
  const name = names[0] || container.Id.slice(0, 12);
  const labParts = name.match(/^lab_([^_]+)_(.+)$/);
  const sessionId = labParts?.[2] || '';
  return {
    id: container.Id,
    shortId: container.Id.slice(0, 12),
    names,
    name,
    image: container.Image,
    state: container.State,
    status: container.Status,
    created: container.Created ? new Date(container.Created * 1000).toISOString() : null,
    ports: container.Ports || [],
    isLabContainer: names.some((name) => isLabContainerName(name)),
    sessionId,
    isFreeCoding: sessionId === 'FREE_CODING',
  };
}

function matchesContainerFilter(container, filter = {}) {
  if (!container.isLabContainer) return false;
  if (filter.kind === 'free-coding') return container.isFreeCoding;
  if (filter.kind === 'session') return container.sessionId === filter.sessionId;
  return true;
}

async function runContainerCommand(container, command) {
  const exec = await container.exec({
    User: 'root', Cmd: ['bash', '-lc', command], AttachStdout: true, AttachStderr: true, Tty: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const output = await new Promise((resolve, reject) => {
    let text = '';
    stream.on('data', (chunk) => { text += chunk.toString(); });
    stream.on('end', () => resolve(text));
    stream.on('error', reject);
  });
  const result = await exec.inspect();
  return { output, exitCode: result.ExitCode ?? null };
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

router.post('/container/:id/:action', async (req, res) => {
  try {
    if (!['start', 'stop'].includes(req.params.action)) {
      return res.status(400).json({ error: 'Unsupported container action.' });
    }
    const container = docker.getContainer(req.params.id);
    if (req.params.action === 'start') await container.start();
    else await container.stop({ t: 5 });
    const inspect = await container.inspect();
    res.json({ success: true, state: inspect.State?.Status || 'unknown' });
  } catch (err) {
    if (err.statusCode === 304) return res.json({ success: true, unchanged: true });
    console.error(`[docker] ${req.params.action} container error:`, err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/containers/bulk/:action', async (req, res) => {
  try {
    if (!['stop', 'delete'].includes(req.params.action)) {
      return res.status(400).json({ error: 'Unsupported bulk action.' });
    }
    const containers = (await docker.listContainers({ all: true })).map(formatContainer);
    const selected = containers.filter((container) => matchesContainerFilter(container, req.body?.filter));
    const completed = [];
    const failed = [];
    for (const info of selected) {
      try {
        const container = docker.getContainer(info.id);
        if (req.params.action === 'stop') {
          if (info.state === 'running') await container.stop({ t: 5 });
        } else {
          await container.remove({ force: true });
        }
        completed.push(info.name);
      } catch (err) { failed.push({ name: info.name, error: err.message }); }
    }
    res.json({ success: true, matchedCount: selected.length, completed, failed });
  } catch (err) {
    console.error('[docker] bulk container action error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/containers/:id/details', async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    const inspect = await container.inspect();
    let stats = null;
    if (inspect.State?.Running) {
      const raw = await container.stats({ stream: false });
      const cpuDelta = (raw.cpu_stats?.cpu_usage?.total_usage || 0) - (raw.precpu_stats?.cpu_usage?.total_usage || 0);
      const systemDelta = (raw.cpu_stats?.system_cpu_usage || 0) - (raw.precpu_stats?.system_cpu_usage || 0);
      const cpuCount = raw.cpu_stats?.online_cpus || raw.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
      stats = {
        cpuPercent: systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0,
        memoryUsage: raw.memory_stats?.usage || 0,
        memoryLimit: raw.memory_stats?.limit || 0,
        memoryPercent: raw.memory_stats?.limit ? ((raw.memory_stats?.usage || 0) / raw.memory_stats.limit) * 100 : 0,
        networkRx: Object.values(raw.networks || {}).reduce((sum, network) => sum + (network.rx_bytes || 0), 0),
        networkTx: Object.values(raw.networks || {}).reduce((sum, network) => sum + (network.tx_bytes || 0), 0),
      };
    }
    res.json({
      container: formatContainer({ Id: inspect.Id, Names: [inspect.Name], Image: inspect.Config?.Image, State: inspect.State?.Status, Status: inspect.State?.Status, Created: Math.floor(new Date(inspect.Created).getTime() / 1000), Ports: [] }),
      state: inspect.State, config: { command: inspect.Config?.Cmd, env: inspect.Config?.Env, workingDir: inspect.Config?.WorkingDir, memoryLimit: inspect.HostConfig?.Memory || 0, nanoCpus: inspect.HostConfig?.NanoCpus || 0, pidsLimit: inspect.HostConfig?.PidsLimit || 0 },
      mounts: inspect.Mounts || [], stats,
    });
  } catch (err) {
    console.error('[docker] container details error:', err);
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

    const containerByName = new Map(containers.flatMap((container) => (
      (container.Names || []).map((rawName) => [rawName.replace(/^\//, ''), container])
    )));
    const volumes = await Promise.all((volumesResult.Volumes || []).map(async (volume) => {
      const formatted = formatVolume(volume, usageByName, existingContainerNames);
      if (formatted.sizeBytes === null || formatted.sizeBytes === 0) {
        try {
          const inspectedVolume = await docker.getVolume(volume.Name).inspect();
          const inspectedSize = inspectedVolume.UsageData?.Size;
          if (typeof inspectedSize === 'number' && inspectedSize >= 0) formatted.sizeBytes = inspectedSize;
        } catch (err) {
          console.warn(`[docker] could not inspect volume usage ${volume.Name}:`, err.message);
        }
      }
      // Docker's df endpoint reports zero/omits UsageData on some engines.
      // For an attached running lab container, measure the mounted workdir
      // directly so the dashboard reflects the students' actual files.
      const linked = containerByName.get(formatted.linkedContainer);
      if (linked?.State === 'running' && (formatted.sizeBytes === null || formatted.sizeBytes === 0)) {
        try {
          const result = await runContainerCommand(docker.getContainer(linked.Id), 'du -sb /home/labuser/workdir 2>/dev/null | cut -f1');
          const measured = Number.parseInt(result.output.trim(), 10);
          if (Number.isFinite(measured) && measured >= 0) formatted.sizeBytes = measured;
        } catch (err) {
          console.warn(`[docker] could not measure volume ${volume.Name}:`, err.message);
        }
      }
      return formatted;
    }));
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
