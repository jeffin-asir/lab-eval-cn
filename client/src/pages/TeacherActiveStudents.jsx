import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { API_BASE } from '../config';
import { ExclamationTriangleIcon, MagnifyingGlassIcon, ShieldExclamationIcon } from '@heroicons/react/24/outline';

export default function TeacherActiveStudents() {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [integritySummary, setIntegritySummary] = useState({ trackedAssignments: 0, flaggedStudents: 0, sharedDeviceStudents: 0 });

  const load = useCallback(async () => {
    try {
      const result = await axios.get(`${API_BASE}/api/auth/active-students`, { params: { role: 'teacher' } });
      setStudents(result.data.students);
      setIntegritySummary(result.data.integritySummary || { trackedAssignments: 0, flaggedStudents: 0, sharedDeviceStudents: 0 });
      setMessage('');
    } catch (error) {
      if ([401, 403].includes(error.response?.status)) navigate('/teacher-login');
      else setMessage(error.response?.data?.error || 'Unable to load active students.');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filteredStudents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return students;
    return students.filter((student) => (
      student.name?.toLowerCase().includes(term)
      || student.userId?.toLowerCase().includes(term)
      || student.batch?.toLowerCase().includes(term)
      || student.ipAddress?.toLowerCase().includes(term)
      || student.malpractice?.sharedDeviceScopes?.some((item) => item.userIds?.some((userId) => userId.toLowerCase().includes(term)))
    ));
  }, [students, search]);

  const uniqueStudentCount = useMemo(
    () => new Set(students.map((s) => s.userId)).size,
    [students]
  );

  const flaggedConnections = useMemo(() => students.filter((student) => (
    student.malpractice?.multiDeviceScopes?.length || student.malpractice?.sharedDeviceScopes?.length
  )), [students]);

  const disconnect = async (student) => {
    if (!window.confirm(`Disconnect ${student.userId}? They will be returned to the login page on their next request.`)) return;
    try {
      await axios.post(`${API_BASE}/api/auth/active-students/${student.connectionId}/disconnect`, {}, { params: { role: 'teacher' } });
      await load();
    } catch (error) {
      setMessage(error.response?.data?.error || 'Could not disconnect this student.');
    }
  };

  const logout = async () => {
    await axios.post(`${API_BASE}/api/auth/logout`, { role: 'teacher' }).catch(() => {});
    navigate('/teacher-login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Active Students" isTeacherPage backLink="/teacher-dashboard" backText="Dashboard" onLogout={logout} />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-wrap gap-3 items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Live student connections</h1>
            <p className="text-sm text-gray-500">Updates every 15 seconds. A student is considered offline after 15 minutes without a heartbeat.</p>
          </div>
          <button onClick={load} className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium">Refresh</button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-500">Total Connections</p>
            <p className="text-2xl font-semibold text-gray-900">{students.length}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-500">Unique Students</p>
            <p className="text-2xl font-semibold text-indigo-700">{uniqueStudentCount}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-500">Multi-connection Students</p>
            <p className="text-2xl font-semibold text-gray-700">{Math.max(0, students.length - uniqueStudentCount)}</p>
          </div>
          <div className={`border rounded-lg p-4 ${flaggedConnections.length ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
            <p className="text-xs text-gray-500">Integrity Signals</p>
            <p className={`text-2xl font-semibold ${flaggedConnections.length ? 'text-amber-700' : 'text-gray-700'}`}>{integritySummary.flaggedStudents}</p>
          </div>
        </div>

        <div className="mb-5 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900 flex gap-2">
          <ShieldExclamationIcon className="w-5 h-5 shrink-0 text-indigo-600" />
          <p><span className="font-medium">Malpractice tracker:</span> remembers logins while an active lab is running. It flags accounts used from multiple devices and browser devices used by multiple accounts. These are investigation signals, not automatic proof. {integritySummary.trackedAssignments ? `Tracking ${integritySummary.trackedAssignments} active lab session${integritySummary.trackedAssignments === 1 ? '' : 's'}.` : 'No live lab session is currently being tracked.'}</p>
        </div>

        {message && <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</p>}

        <div className="mb-4 relative max-w-sm">
          <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, ID, batch, or IP…"
            className="w-full pl-8 pr-3 py-2 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600"><tr><th className="p-3">Student</th><th className="p-3">Integrity signals</th><th className="p-3">IP address</th><th className="p-3">Connected</th><th className="p-3">Last seen</th><th className="p-3">Browser</th><th className="p-3" /></tr></thead>
            <tbody>
              {!loading && filteredStudents.length === 0 && (
                <tr>
                  <td colSpan="7" className="p-6 text-center text-gray-500">
                    {students.length ? 'No connections match your search.' : 'No active student connections.'}
                  </td>
                </tr>
              )}
              {filteredStudents.map((student) => <tr key={student.connectionId} className="border-t border-gray-100">
                <td className="p-3 font-medium text-gray-900"><div>{student.name}</div><div className="font-normal text-xs text-gray-500">{student.userId}{student.batch ? ` · ${student.batch}` : ''}</div></td>
                <td className="p-3 min-w-64">
                  {!student.malpractice?.multiDeviceScopes?.length && !student.malpractice?.sharedDeviceScopes?.length ? <span className="text-xs text-gray-400">No signal</span> : <div className="space-y-1.5">
                    {student.malpractice.multiDeviceScopes.map((item) => <div key={`devices-${item.scope}`} className="flex gap-1.5 text-xs text-amber-800"><ExclamationTriangleIcon className="w-4 h-4 shrink-0" /><span><b>Multiple devices</b> during {item.scope} ({item.deviceCount})</span></div>)}
                    {student.malpractice.sharedDeviceScopes.map((item) => <div key={`shared-${item.scope}-${item.deviceLabel}`} className="flex gap-1.5 text-xs text-red-800"><ExclamationTriangleIcon className="w-4 h-4 shrink-0" /><span><b>Shared device</b> during {item.scope}: {item.userIds.join(', ')}</span></div>)}
                  </div>}
                </td>
                <td className="p-3 font-mono text-xs">{student.ipAddress}</td><td className="p-3">{new Date(student.connectedAt).toLocaleString()}</td><td className="p-3">{new Date(student.lastSeenAt).toLocaleTimeString()}</td><td className="p-3 max-w-xs truncate text-gray-500" title={student.userAgent}>{student.userAgent || 'Unknown'}</td>
                <td className="p-3 text-right"><button onClick={() => disconnect(student)} className="rounded-md bg-red-600 px-3 py-1.5 text-white font-medium hover:bg-red-700">Disconnect</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
