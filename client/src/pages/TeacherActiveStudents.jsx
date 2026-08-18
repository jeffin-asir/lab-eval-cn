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
  const [integritySummary, setIntegritySummary] = useState({ trackedAssignments: 0, flaggedStudents: 0, passwordSharing: [], multipleLogin: [] });
  const [selectedSignalType, setSelectedSignalType] = useState(null);

  const load = useCallback(async () => {
    try {
      const result = await axios.get(`${API_BASE}/api/auth/active-students`, { params: { role: 'teacher' } });
      setStudents([...(result.data.students || [])].sort((a, b) => a.userId.localeCompare(b.userId, undefined, { numeric: true, sensitivity: 'base' })));
      setIntegritySummary(result.data.integritySummary || { trackedAssignments: 0, flaggedStudents: 0, passwordSharing: [], multipleLogin: [] });
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
      || student.integrity?.passwordSharing?.some((item) => item.counterpartIds?.some((userId) => userId.toLowerCase().includes(term)))
      || student.integrity?.multipleLogin?.some((item) => item.counterpartIds?.some((userId) => userId.toLowerCase().includes(term)))
    ));
  }, [students, search]);

  const uniqueStudentCount = useMemo(
    () => new Set(students.map((s) => s.userId)).size,
    [students]
  );

  const selectedSignals = selectedSignalType === 'password-sharing'
    ? integritySummary.passwordSharing || []
    : selectedSignalType === 'multiple-login' ? integritySummary.multipleLogin || [] : [];

  const signalTitle = selectedSignalType === 'password-sharing' ? 'Sharing credentials' : 'Multiple login';

  const assessmentText = (assessment) => {
    if (!assessment || assessment.status === 'pending') return assessment?.message || 'Waiting for the five-minute comparison window.';
    if (assessment.status === 'no-match') return assessment.message;
    return `${assessment.sharedBy} passed ${assessment.passedCount}/${assessment.totalTestCases || '?'} first; ${assessment.copiedBy} later passed the same testcase result.`;
  };

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
          <button type="button" onClick={() => setSelectedSignalType(selectedSignalType === 'password-sharing' ? null : 'password-sharing')} className={`border rounded-lg p-4 text-left ${integritySummary.passwordSharing?.length ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
            <p className="text-xs text-gray-500">Sharing credentials</p>
            <p className={`text-2xl font-semibold ${integritySummary.passwordSharing?.length ? 'text-amber-700' : 'text-gray-700'}`}>{integritySummary.passwordSharing?.length || 0}</p>
          </button>
          <button type="button" onClick={() => setSelectedSignalType(selectedSignalType === 'multiple-login' ? null : 'multiple-login')} className={`border rounded-lg p-4 text-left ${integritySummary.multipleLogin?.length ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
            <p className="text-xs text-gray-500">Multiple login</p>
            <p className={`text-2xl font-semibold ${integritySummary.multipleLogin?.length ? 'text-red-700' : 'text-gray-700'}`}>{integritySummary.multipleLogin?.length || 0}</p>
          </button>
        </div>

        <div className="mb-5 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900 flex gap-2">
          <ShieldExclamationIcon className="w-5 h-5 shrink-0 text-indigo-600" />
          <p><span className="font-medium">Integrity tracker:</span> remembers logins while an active lab is running. A credential used on another student&apos;s assigned device is shown as <b>Sharing credentials</b>; the owner of that device is shown as <b>Multiple login</b>. These are investigation signals, not automatic proof. {integritySummary.trackedAssignments ? `Tracking ${integritySummary.trackedAssignments} active lab session${integritySummary.trackedAssignments === 1 ? '' : 's'}.` : 'No live lab session is currently being tracked.'}</p>
        </div>

        {selectedSignalType && <section className="mb-5 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div><h2 className="font-semibold text-gray-900">{signalTitle} details</h2><p className="text-xs text-gray-500">Submission evidence is checked five minutes after the login signal.</p></div>
            <button type="button" onClick={() => setSelectedSignalType(null)} className="text-sm text-indigo-700 hover:underline">Close</button>
          </div>
          {!selectedSignals.length ? <p className="p-4 text-sm text-gray-500">No {signalTitle.toLowerCase()} signals in the active lab.</p> : <div className="divide-y divide-gray-100">
            {selectedSignals.map((signal, index) => <div key={`${signal.userId}-${signal.deviceLabel}-${signal.occurredAt}-${index}`} className="p-4 text-sm">
              <p className="font-medium text-gray-900">{signal.userId}{signal.studentName && signal.studentName !== signal.userId ? ` · ${signal.studentName}` : ''}</p>
              <p className="mt-1 text-gray-600">{selectedSignalType === 'password-sharing' ? <>Logged into {signal.counterpartIds.join(', ')}&apos;s assigned device.</> : <>Assigned device also used by: {signal.counterpartIds.join(', ')}.</>}</p>
              <p className="mt-1 text-xs text-gray-500">{signal.scope} · {signal.deviceLabel} · {new Date(signal.occurredAt).toLocaleString()}</p>
              <p className={`mt-2 rounded-md px-3 py-2 text-xs ${signal.copyingAssessment?.status === 'match' ? 'bg-red-50 text-red-800' : 'bg-gray-50 text-gray-700'}`}><b>Submission check:</b> {assessmentText(signal.copyingAssessment)}</p>
            </div>)}
          </div>}
        </section>}

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
            <thead className="bg-gray-50 text-left text-gray-600"><tr><th className="p-3">Student (ID order)</th><th className="p-3">Integrity signals</th><th className="p-3">IP address</th><th className="p-3">Connected</th><th className="p-3">Last seen</th><th className="p-3">Browser</th><th className="p-3" /></tr></thead>
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
                  {!student.integrity?.passwordSharing?.length && !student.integrity?.multipleLogin?.length ? <span className="text-xs text-gray-400">No signal</span> : <div className="space-y-1.5">
                    {student.integrity.passwordSharing.map((item, index) => <div key={`sharing-${item.scope}-${item.occurredAt}-${index}`} className="flex gap-1.5 text-xs text-amber-800"><ExclamationTriangleIcon className="w-4 h-4 shrink-0" /><span><b>Sharing credentials</b> on {item.counterpartIds.join(', ')}&apos;s device</span></div>)}
                    {student.integrity.multipleLogin.map((item, index) => <div key={`multiple-${item.scope}-${item.occurredAt}-${index}`} className="flex gap-1.5 text-xs text-red-800"><ExclamationTriangleIcon className="w-4 h-4 shrink-0" /><span><b>Multiple login</b>: {item.counterpartIds.join(', ')} used this device</span></div>)}
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
