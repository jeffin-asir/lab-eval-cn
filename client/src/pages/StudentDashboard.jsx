import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { API_BASE } from '../config';
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

  const enterLab = async (slotKey = '', freeCoding = false, moduleId = '') => {
    const key = freeCoding ? 'free' : (moduleId || slotKey || 'lab');
    if (!freeCoding) {
      const ok = window.confirm(
        'Start this lab session now? Your timer runs until the scheduled end time, and it continues even if you reload or log out.'
      );
      if (!ok) return;
    }

    try {
      setEnteringKey(key);
      const res = await axios.post(`${API_BASE}/api/sessions/init`, {
        slotKey,
        mode: freeCoding ? 'free' : 'lab',
      });
      window.__labSessionId = res.data.sessionId;
      const params = new URLSearchParams();
      params.set('sessionId', res.data.sessionId);
      if (freeCoding) params.set('free', '1');
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
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  placeholder="Current password"
                  className="border rounded-md px-3 py-2 text-sm"
                />
                <input
                  type="password"
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
                    onClick={() => enterLab(s.slotKey, false, s.module._id)}
                    disabled={!!enteringKey || s.canEnter === false}
                    className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {enteringKey === (s.module._id || s.slotKey) ? 'Starting...' : 'Enter Lab'}
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
            <h2 className="text-base font-semibold text-gray-900 mb-3">Previous Tests</h2>
            {dashboard?.previousTests?.length ? (
              <div className="divide-y">
                {dashboard.previousTests.map((t) => (
                  <div key={`${t.sessionId}-${t.moduleId}`} className="py-3 text-sm">
                    <p className="font-medium text-gray-900">{t.moduleName}</p>
                    <p className="text-gray-500">{t.slotKey || t.sessionId} · {t.questionCount} submitted question(s)</p>
                  </div>
                ))}
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
