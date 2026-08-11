import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { API_BASE } from '../config';
import {
  ArrowPathIcon,
  CubeIcon,
  MagnifyingGlassIcon,
  ServerStackIcon,
  CircleStackIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

function StateBadge({ state }) {
  const running = state === 'running';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
      running ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
    }`}>
      {state || 'unknown'}
    </span>
  );
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function TeacherDocker() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('containers'); // 'containers' | 'volumes'

  const [containers, setContainers] = useState([]);
  const [containersLoading, setContainersLoading] = useState(false);
  const [containerSearch, setContainerSearch] = useState('');

  const [volumes, setVolumes] = useState([]);
  const [volumesLoading, setVolumesLoading] = useState(false);
  const [volumesLoaded, setVolumesLoaded] = useState(false);
  const [volumeSearch, setVolumeSearch] = useState('');

  const [message, setMessage] = useState('');

  useEffect(() => {
    axios.get(`${API_BASE}/api/auth/me`, { params: { role: 'teacher' } })
      .then((res) => {
        if (!['faculty', 'admin'].includes(res.data.user.role)) navigate('/teacher-login');
      })
      .catch((err) => { if (err.response?.status === 401) navigate('/teacher-login'); });
  }, [navigate]);

  const handleLogout = async () => {
    await axios.post(`${API_BASE}/api/auth/logout`, { role: 'teacher' }).catch(() => {});
    navigate('/teacher-login');
  };

  const loadContainers = useCallback(async () => {
    setContainersLoading(true);
    setMessage('');
    try {
      const res = await axios.get(`${API_BASE}/api/docker/containers`);
      setContainers(res.data || []);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to load Docker containers.');
    } finally {
      setContainersLoading(false);
    }
  }, []);

  const loadVolumes = useCallback(async () => {
    setVolumesLoading(true);
    setMessage('');
    try {
      const res = await axios.get(`${API_BASE}/api/docker/volumes`);
      setVolumes(res.data || []);
      setVolumesLoaded(true);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to load Docker volumes.');
    } finally {
      setVolumesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContainers();
  }, [loadContainers]);

  // Volumes are only fetched once the tab is first opened (df() is a
  // heavier engine call than listing containers).
  useEffect(() => {
    if (tab === 'volumes' && !volumesLoaded) loadVolumes();
  }, [tab, volumesLoaded, loadVolumes]);

  const stats = useMemo(() => {
    const running = containers.filter((c) => c.state === 'running').length;
    const lab = containers.filter((c) => c.isLabContainer).length;
    const stoppedLab = containers.filter((c) => c.isLabContainer && c.state !== 'running').length;
    return { total: containers.length, running, lab, stoppedLab };
  }, [containers]);

  const volumeStats = useMemo(() => {
    const orphaned = volumes.filter((v) => v.isLabVolume && !v.containerExists);
    const totalSizeBytes = volumes.reduce((sum, v) => (typeof v.sizeBytes === 'number' ? sum + v.sizeBytes : sum), 0);
    const orphanedSizeBytes = orphaned.reduce((sum, v) => (typeof v.sizeBytes === 'number' ? sum + v.sizeBytes : sum), 0);
    return { total: volumes.length, orphaned: orphaned.length, totalSizeBytes, orphanedSizeBytes };
  }, [volumes]);

  const filteredContainers = useMemo(() => {
    const term = containerSearch.trim().toLowerCase();
    if (!term) return containers;
    return containers.filter((c) => (
      c.name?.toLowerCase().includes(term)
      || c.image?.toLowerCase().includes(term)
      || c.state?.toLowerCase().includes(term)
      || c.shortId?.toLowerCase().includes(term)
    ));
  }, [containers, containerSearch]);

  const filteredVolumes = useMemo(() => {
    const term = volumeSearch.trim().toLowerCase();
    if (!term) return volumes;
    return volumes.filter((v) => (
      v.name?.toLowerCase().includes(term)
      || v.linkedContainer?.toLowerCase().includes(term)
    ));
  }, [volumes, volumeSearch]);

  const removeContainer = async (container) => {
    const force = container.state === 'running';
    const warning = force
      ? `Container "${container.name}" is running. Force delete it?`
      : `Delete container "${container.name}"?`;
    if (!confirm(warning)) return;

    setContainersLoading(true);
    try {
      await axios.delete(`${API_BASE}/api/docker/containers/${container.id}`, {
        params: { force: force ? '1' : undefined },
      });
      setMessage(`Removed ${container.name}.`);
      await loadContainers();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to remove container.');
    } finally {
      setContainersLoading(false);
    }
  };

  const pruneLabContainers = async () => {
    if (!confirm('Delete all stopped lab containers? Running containers will be kept.')) return;

    setContainersLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/docker/prune-lab-containers`);
      setMessage(`Removed ${res.data.removedCount || 0} stopped lab container(s).`);
      await loadContainers();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to prune lab containers.');
    } finally {
      setContainersLoading(false);
    }
  };

  const removeVolume = async (volume) => {
    const warning = volume.inUse
      ? `Volume "${volume.name}" still looks in use. Force delete it anyway? This permanently erases the data inside.`
      : `Delete volume "${volume.name}"? This permanently erases the data inside.`;
    if (!confirm(warning)) return;

    setVolumesLoading(true);
    try {
      await axios.delete(`${API_BASE}/api/docker/volumes/${encodeURIComponent(volume.name)}`, {
        params: { force: volume.inUse ? '1' : undefined },
      });
      setMessage(`Removed volume ${volume.name}.`);
      await loadVolumes();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to remove volume.');
    } finally {
      setVolumesLoading(false);
    }
  };

  const pruneOrphanedVolumes = async () => {
    if (!confirm('Delete every lab volume whose container no longer exists? This permanently erases the data inside them.')) return;

    setVolumesLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/docker/prune-orphaned-volumes`);
      setMessage(`Removed ${res.data.removedCount || 0} orphaned volume(s).`);
      await loadVolumes();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to prune orphaned volumes.');
    } finally {
      setVolumesLoading(false);
    }
  };

  const renderPorts = (ports = []) => {
    const mapped = ports
      .filter((port) => port.PublicPort)
      .map((port) => `${port.PublicPort}->${port.PrivatePort}/${port.Type}`);
    return mapped.length ? mapped.join(', ') : '-';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        title="Docker Manager"
        isTeacherPage={true}
        backLink="/teacher-dashboard"
        backText="Back to Dashboard"
        onLogout={handleLogout}
      />

      <div className="container mx-auto py-8 px-4">
        <div className="max-w-6xl mx-auto space-y-5">
          <div className="flex gap-2 border-b border-gray-200">
            <button
              onClick={() => setTab('containers')}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === 'containers'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <ServerStackIcon className="w-4 h-4" />
              Containers
            </button>
            <button
              onClick={() => setTab('volumes')}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === 'volumes'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <CircleStackIcon className="w-4 h-4" />
              Volumes
            </button>
          </div>

          {message && (
            <div className="p-3 rounded-md bg-yellow-50 border border-yellow-200 text-sm text-yellow-800">
              {message}
            </div>
          )}

          {tab === 'containers' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Total</p>
                  <p className="text-2xl font-semibold text-gray-900">{stats.total}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Running</p>
                  <p className="text-2xl font-semibold text-green-700">{stats.running}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Lab Containers</p>
                  <p className="text-2xl font-semibold text-indigo-700">{stats.lab}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Stopped Lab</p>
                  <p className="text-2xl font-semibold text-gray-700">{stats.stoppedLab}</p>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="p-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ServerStackIcon className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-base font-semibold text-gray-900">Containers</h2>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <div className="relative">
                      <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={containerSearch}
                        onChange={(e) => setContainerSearch(e.target.value)}
                        placeholder="Search by name, session, image, state…"
                        className="pl-8 pr-3 py-2 rounded-md border border-gray-300 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <button
                      onClick={loadContainers}
                      disabled={containersLoading}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <ArrowPathIcon className={`w-4 h-4 ${containersLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                    <button
                      onClick={pruneLabContainers}
                      disabled={containersLoading || stats.stoppedLab === 0}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-red-600 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <TrashIcon className="w-4 h-4" />
                      Delete Stopped Lab
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="text-left px-4 py-3">Name</th>
                        <th className="text-left px-4 py-3">Image</th>
                        <th className="text-left px-4 py-3">State</th>
                        <th className="text-left px-4 py-3">Ports</th>
                        <th className="text-left px-4 py-3">Created</th>
                        <th className="text-left px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredContainers.map((container) => (
                        <tr key={container.id}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <CubeIcon className="w-4 h-4 text-gray-400" />
                              <div>
                                <p className="font-medium text-gray-900">{container.name}</p>
                                <p className="text-xs text-gray-400">{container.shortId}</p>
                              </div>
                              {container.isLabContainer && (
                                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">lab</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{container.image}</td>
                          <td className="px-4 py-3">
                            <StateBadge state={container.state} />
                            <p className="text-xs text-gray-400 mt-1">{container.status}</p>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{renderPorts(container.ports)}</td>
                          <td className="px-4 py-3 text-gray-600">
                            {container.created ? new Date(container.created).toLocaleString() : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => removeContainer(container)}
                              disabled={containersLoading}
                              className="inline-flex items-center gap-1 text-red-700 hover:text-red-900 disabled:opacity-50"
                            >
                              <TrashIcon className="w-4 h-4" />
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!filteredContainers.length && (
                        <tr>
                          <td className="px-4 py-10 text-center text-gray-500" colSpan="6">
                            {containersLoading
                              ? 'Loading containers...'
                              : containers.length
                                ? 'No containers match your search.'
                                : 'No containers found.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {tab === 'volumes' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Total Volumes</p>
                  <p className="text-2xl font-semibold text-gray-900">{volumeStats.total}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Orphaned (no container)</p>
                  <p className="text-2xl font-semibold text-red-700">{volumeStats.orphaned}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Total Disk Used</p>
                  <p className="text-2xl font-semibold text-gray-900">{formatBytes(volumeStats.totalSizeBytes)}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Reclaimable (orphaned)</p>
                  <p className="text-2xl font-semibold text-indigo-700">{formatBytes(volumeStats.orphanedSizeBytes)}</p>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="p-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CircleStackIcon className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-base font-semibold text-gray-900">Volumes</h2>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <div className="relative">
                      <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={volumeSearch}
                        onChange={(e) => setVolumeSearch(e.target.value)}
                        placeholder="Search by name or session…"
                        className="pl-8 pr-3 py-2 rounded-md border border-gray-300 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <button
                      onClick={loadVolumes}
                      disabled={volumesLoading}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <ArrowPathIcon className={`w-4 h-4 ${volumesLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                    <button
                      onClick={pruneOrphanedVolumes}
                      disabled={volumesLoading || volumeStats.orphaned === 0}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-red-600 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <TrashIcon className="w-4 h-4" />
                      Delete Orphaned
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="text-left px-4 py-3">Name</th>
                        <th className="text-left px-4 py-3">Linked Container</th>
                        <th className="text-left px-4 py-3">Size</th>
                        <th className="text-left px-4 py-3">Status</th>
                        <th className="text-left px-4 py-3">Created</th>
                        <th className="text-left px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredVolumes.map((volume) => (
                        <tr key={volume.name}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <CircleStackIcon className="w-4 h-4 text-gray-400" />
                              <p className="font-medium text-gray-900">{volume.name}</p>
                              {volume.isLabVolume && (
                                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">lab</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {volume.linkedContainer || '-'}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{formatBytes(volume.sizeBytes)}</td>
                          <td className="px-4 py-3">
                            {volume.isLabVolume && !volume.containerExists ? (
                              <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">
                                orphaned
                              </span>
                            ) : volume.inUse ? (
                              <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
                                in use
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                                unused
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {volume.created ? new Date(volume.created).toLocaleString() : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => removeVolume(volume)}
                              disabled={volumesLoading}
                              className="inline-flex items-center gap-1 text-red-700 hover:text-red-900 disabled:opacity-50"
                            >
                              <TrashIcon className="w-4 h-4" />
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!filteredVolumes.length && (
                        <tr>
                          <td className="px-4 py-10 text-center text-gray-500" colSpan="6">
                            {volumesLoading
                              ? 'Loading volumes...'
                              : volumes.length
                                ? 'No volumes match your search.'
                                : 'No volumes found.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}