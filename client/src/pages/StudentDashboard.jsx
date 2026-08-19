import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { API_BASE } from '../config';
import PasswordInput from '../components/PasswordInput';
import StudentConnectionHeartbeat from '../components/StudentConnectionHeartbeat';

function formatTimeWindow(startTime, endTime, startsAt, endsAt) {
  if (startTime && endTime) return `${startTime} – ${endTime}`;
  if (startsAt && endsAt) {
    return `${new Date(startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return '';
}

export default function StudentDashboard() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState('');
  const [enteringKey, setEnteringKey] = useState('');
  const [practiceModules, setPracticeModules] = useState([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [selectedHistoryKey, setSelectedHistoryKey] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
  });

  const validateNewPassword = (value) => {
    if (value.length < 8) return 'Password must be at least 8 characters long.';
    if (!/[^A-Za-z0-9]/.test(value)) return 'Password must include at least one special symbol.';
    return '';
  };

  useEffect(() => {
    async function loadDashboard() {
      try {
        const meRes = await axios.get(`${API_BASE}/api/auth/me`, { params: { role: 'student' } });
        if (meRes.data.user.role !== 'student') {
          navigate('/teacher-dashboard');
          return;
        }
        setUser(meRes.data.user);
        const dashboardRes = await axios.get(`${API_BASE}/api/sessions/student-dashboard`);
        setDashboard(dashboardRes.data);
        const practiceRes = await axios.get(`${API_BASE}/api/sessions/practice`);
        setPracticeModules(practiceRes.data);
      } catch {
        navigate('/login');
      }
    }

    loadDashboard();
    const interval = setInterval(loadDashboard, 30000);
    return () => clearInterval(interval);
  }, [navigate]);

  const logout = async () => {
    await axios.post(`${API_BASE}/api/auth/logout`, { role: 'student' }).catch(() => {});
    navigate('/login');
  };

  const enterLab = async (slotKey = '', freeCoding = false, moduleId = '', workspaceMode = 'live', deliveryMode = 'session') => {
    const key = freeCoding ? 'free' : (moduleId || slotKey || 'lab');
    if (!freeCoding && workspaceMode === 'live') {
      const ok = window.confirm(
        'Start this lab session now? Your timer runs until the scheduled end time, and it continues even if you reload or log out.'
      );
      if (!ok) return;
    }

    try {
      setEnteringKey(key);
      if (deliveryMode === 'exam' && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
      const res = await axios.post(`${API_BASE}/api/sessions/init`, {
        slotKey,
        mode: freeCoding ? 'free' : workspaceMode,
        moduleId,
      });
      window.__labSessionId = res.data.sessionId;
      const params = new URLSearchParams();
      params.set('sessionId', res.data.sessionId);
      if (freeCoding) params.set('free', '1');
      if (workspaceMode === 'practice') params.set('practice', '1');
      if (moduleId) params.set('moduleId', moduleId);
      navigate(`/workspace?${params.toString()}`);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to start lab workspace.');
      setEnteringKey('');
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setMessage('');
    const passwordError = validateNewPassword(passwordForm.newPassword);
    if (passwordError) {
      setMessage(passwordError);
      return;
    }
    try {
      await axios.post(`${API_BASE}/api/auth/change-password`, {
        userId: user?.user_id,
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: '', newPassword: '' });
      setMessage('Password changed.');
      const res = await axios.get(`${API_BASE}/api/sessions/student-dashboard`);
      setDashboard(res.data);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to change password.');
    }
  };

  const hasActiveSessions = (dashboard?.activeSessions?.length || 0) > 0;
  const previousTests = dashboard?.previousTests || [];
  const historyMatches = previousTests.filter((test) => {
    const term = historySearch.trim().toLowerCase();
    if (!term) return true;
    return [test.moduleName, test.slotKey, test.sessionId, test.deliveryMode, test.lastSubmittedAt ? new Date(test.lastSubmittedAt).toLocaleDateString() : '']
      .some((value) => String(value || '').toLowerCase().includes(term));
  });
  const historyPageSize = 6;
  const historyPageCount = Math.max(1, Math.ceil(historyMatches.length / historyPageSize));
  const historyItems = historyMatches.slice(historyPage * historyPageSize, (historyPage + 1) * historyPageSize);
  const selectedHistory = historyMatches.find((test) => `${test.sessionId}-${test.moduleId}-${test.slotKey}` === selectedHistoryKey) || null;
  const formatDuration = (seconds) => {
    if (seconds == null) return 'Not available';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <StudentConnectionHeartbeat />
      <Header title="Student Dashboard" onLogout={logout} />
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {message && <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">{message}</div>}

          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{dashboard?.student?.name || 'Student'}</h1>
              <p className="text-sm text-gray-500">
                {dashboard?.student?.user_id} · Batch {dashboard?.student?.batch || '-'}
              </p>
            </div>
            <button onClick={logout} className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 text-sm font-medium">Logout</button>
          </div>

          {dashboard?.student?.mustChangePassword && (
            <form onSubmit={changePassword} className="bg-white border border-orange-200 rounded-lg p-5 shadow-sm space-y-3">
              <h2 className="text-base font-semibold text-gray-900">Change Default Password</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <PasswordInput
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  placeholder="Current password"
                  className="border rounded-md px-3 py-2 text-sm"
                />
                <PasswordInput
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  placeholder="New password"
                  className="border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <p className="text-xs text-gray-500">Minimum 8 characters with at least one special symbol.</p>
              <button className="px-4 py-2 rounded-md bg-orange-600 text-white text-sm font-medium">Update Password</button>
            </form>
          )}

          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Active Lab Sessions</h2>
            {dashboard?.activeSessions?.length ? (
              dashboard.activeSessions.map((s) => (
                <div key={s.module._id} className="border rounded-md p-4 flex items-center justify-between mb-3 last:mb-0">
                  <div>
                    <p className="font-medium text-gray-900">{s.module.name}</p>
                    <p className="text-sm text-gray-500">
                      {formatTimeWindow(s.startTime, s.endTime, s.startsAt, s.endsAt)} · Ends {s.endsAt ? new Date(s.endsAt).toLocaleString() : '-'}
                    </p>
                  </div>
                  <button
                    onClick={() => enterLab(s.slotKey, false, s.module._id, 'live', s.module.deliveryMode)}
                    disabled={!!enteringKey || s.canEnter === false}
                    className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {enteringKey === (s.module._id || s.slotKey) ? 'Starting...' : s.module.deliveryMode === 'exam' ? 'Enter Exam' : 'Enter Lab'}
                  </button>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500 mb-3">No lab session is open for your batch right now.</p>
            )}

            {dashboard?.upcomingSessions?.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Upcoming</h3>
                {dashboard.upcomingSessions.map((s) => (
                  <div key={s.assignmentId} className="border border-dashed rounded-md p-4 flex items-center justify-between mb-2 last:mb-0 bg-gray-50">
                    <div>
                      <p className="font-medium text-gray-900">{s.module.name}</p>
                      <p className="text-sm text-gray-500">
                        Opens {s.startsAt ? new Date(s.startsAt).toLocaleString() : formatTimeWindow(s.startTime, s.endTime)}
                      </p>
                    </div>
                    <span className="text-xs text-gray-500 px-3 py-1 rounded-full bg-white border">Not yet open</span>
                  </div>
                ))}
              </div>
            )}

            {!hasActiveSessions && (
              <div className="flex items-center justify-end gap-4 mt-4">
                <button
                  onClick={() => enterLab('', true)}
                  disabled={!!enteringKey}
                  className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {enteringKey === 'free' ? 'Starting...' : 'Open Free Coding'}
                </button>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Practice</h2>
            <p className="text-sm text-gray-500 mb-3">Teacher-released modules are available here without a time limit.</p>
            {practiceModules.length ? practiceModules.map((module) => (
              <div key={module._id} className="border rounded-md p-4 flex items-center justify-between mb-2 last:mb-0">
                <div><p className="font-medium text-gray-900">{module.name}</p><p className="text-sm text-gray-500">{module.questionCount} question(s)</p></div>
                <button onClick={() => enterLab('', false, module._id, 'practice')} disabled={!!enteringKey} className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium disabled:opacity-60">
                  {enteringKey === module._id ? 'Opening...' : 'Practice'}
                </button>
              </div>
            )) : <p className="text-sm text-gray-500">No practice modules have been released yet.</p>}
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div><h2 className="text-base font-semibold text-gray-900">Previous Tests</h2><p className="text-sm text-gray-500">Select a session to view your saved submission outcome.</p></div>
              <span className="text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-2.5 py-1">{previousTests.length} total</span>
            </div>
            {previousTests.length ? (
              <div>
                <input type="search" value={historySearch} onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(0); setSelectedHistoryKey(''); }} placeholder="Search by lab name, date, slot, session, or exam…" className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                {historyMatches.length ? <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.9fr)] gap-4">
                <div className="space-y-2">
                  {historyItems.map((test) => {
                    const key = `${test.sessionId}-${test.moduleId}-${test.slotKey}`;
                    const selected = selectedHistoryKey === key;
                    return <button key={key} type="button" onClick={() => setSelectedHistoryKey(key)} className={`w-full text-left rounded-lg border p-3 transition ${selected ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200' : 'border-gray-200 hover:border-indigo-200 hover:bg-gray-50'}`}>
                      <div className="flex justify-between gap-3"><p className="font-medium text-gray-900 truncate">{test.moduleName}</p><span className={`shrink-0 text-xs rounded-full px-2 py-0.5 ${test.deliveryMode === 'exam' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{test.deliveryMode === 'exam' ? 'Exam' : 'Session'}</span></div>
                      <p className="mt-1 text-xs text-gray-500">{test.lastSubmittedAt ? new Date(test.lastSubmittedAt).toLocaleString() : test.slotKey || test.sessionId}</p>
                      <p className="mt-1 text-sm text-gray-600">{test.passedCount}/{test.totalTestCases || '—'} checks passed · {test.questionCount} question{test.questionCount === 1 ? '' : 's'}</p>
                    </button>;
                  })}
                  {historyPageCount > 1 && <div className="flex justify-between items-center pt-2 text-sm"><button type="button" disabled={historyPage === 0} onClick={() => setHistoryPage((page) => page - 1)} className="px-3 py-1.5 border rounded disabled:opacity-40">Previous</button><span className="text-gray-500">Page {historyPage + 1} of {historyPageCount}</span><button type="button" disabled={historyPage + 1 >= historyPageCount} onClick={() => setHistoryPage((page) => page + 1)} className="px-3 py-1.5 border rounded disabled:opacity-40">Next</button></div>}
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  {selectedHistory ? <>
                    <p className="font-semibold text-gray-900">{selectedHistory.moduleName}</p>
                    <p className="mt-1 text-xs text-gray-500">Submitted {new Date(selectedHistory.lastSubmittedAt).toLocaleString()}</p>
                    <div className="grid grid-cols-2 gap-2 mt-4"><div className="rounded bg-white border p-2"><p className="text-xs text-gray-500">Checks passed</p><p className="font-semibold text-green-700">{selectedHistory.passedCount}/{selectedHistory.totalTestCases || '—'}</p></div><div className="rounded bg-white border p-2"><p className="text-xs text-gray-500">Time used</p><p className="font-semibold text-gray-900">{formatDuration(selectedHistory.usedSeconds)}</p></div></div>
                    <div className="mt-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Question log</p><div className="space-y-2">{selectedHistory.questions.map((question) => <details key={question.questionId} className="rounded bg-white border px-3 py-2 text-sm"><summary className="flex justify-between gap-2 cursor-pointer"><span className="truncate">{question.questionKey}</span><span className="shrink-0 font-medium text-gray-700">{question.passedCount}/{question.totalTestCases || '—'} passed</span></summary>{question.testcases?.length > 0 && <div className="mt-2 border-t pt-2 space-y-1 text-xs text-gray-600">{question.testcases.map((testcase, index) => <div key={`${testcase.name}-${index}`} className="flex justify-between gap-2"><span className="truncate">{testcase.name}</span><span>{testcase.passedCount}/{testcase.totalTestCases || '—'}</span></div>)}</div>}</details>)}</div></div>
                  </> : <p className="text-sm text-gray-500">Select a previous test to see its submission log, checks passed, and recorded time used.</p>}
                </div>
                </div> : <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500">No previous test matches “{historySearch}”.</p>}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No submitted lab sessions yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
