import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { API_BASE } from '../config';
import { getStudentDeviceId } from '../components/StudentConnectionHeartbeat';
import PasswordInput from '../components/PasswordInput';

export default function Login() {
  const navigate = useNavigate();
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetApproved, setResetApproved] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [connectionBlocked, setConnectionBlocked] = useState(false);
  const [disconnectRequestLoading, setDisconnectRequestLoading] = useState(false);
  useEffect(() => { axios.get(`${API_BASE}/api/auth/me`, { params: { role: 'student' } }).then((res) => { if (res.data.user.role === 'student') navigate('/student-dashboard'); }).catch(() => {}); }, [navigate]);

  const validateNewPassword = (value) => {
    if (value.length < 8) return 'Password must be at least 8 characters long.';
    if (!/[^A-Za-z0-9]/.test(value)) return 'Password must include at least one special symbol.';
    return '';
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setConnectionBlocked(false);

    const trimmedId = studentId.trim();

    if (!trimmedId || !password) {
      setError('Please enter your student ID and password.');
      return;
    }

    setLoading(true);
    try {
      const loginRes = await axios.post(`${API_BASE}/api/auth/student-login`, {
        userId: trimmedId,
        password,
      }, { headers: { 'X-CNLab-Device-Id': getStudentDeviceId() } });
      const student = loginRes.data.student;

      navigate('/student-dashboard');
    } catch (err) {
      if (err.response?.status === 409) {
        setConnectionBlocked(true);
        setError('This account is already active on another machine or network. Please log out there, wait for the session to expire, or ask your teacher to disconnect it.');
      } else {
        setError(err.response?.data?.error || 'Failed to login. Is the server running?');
      }
    } finally {
      setLoading(false);
    }
  };

  const requestSessionDisconnect = async () => {
    if (!studentId.trim() || !password) {
      setError('Enter your student ID and password before requesting a session disconnect.');
      return;
    }
    setDisconnectRequestLoading(true);
    try {
      await axios.post(`${API_BASE}/api/auth/session-disconnect-request`, { userId: studentId.trim(), password });
      setError('Disconnect request sent to your teacher. Once approved, sign in again.');
      setConnectionBlocked(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send the disconnect request.');
    } finally {
      setDisconnectRequestLoading(false);
    }
  };

  const requestPasswordReset = async () => {
    setError('');
    if (!studentId.trim()) {
      setError('Enter your student ID first.');
      return;
    }
    try {
      await axios.post(`${API_BASE}/api/auth/password-reset-request`, { userId: studentId.trim() });
      setError('Password reset request sent to teacher.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send reset request.');
    }
  };

  const checkResetApproval = async () => {
    setError('');
    if (!studentId.trim()) {
      setError('Enter your student ID first.');
      return;
    }
    try {
      const res = await axios.get(`${API_BASE}/api/auth/password-reset-request/${studentId.trim()}`);
      setResetApproved(res.data.request || null);
      if (!res.data.approved) setError('No approved password reset yet.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not check reset status.');
    }
  };

  const setApprovedPassword = async () => {
    setError('');
    if (!resetApproved || !newPassword) return;
    const passwordError = validateNewPassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    try {
      await axios.post(`${API_BASE}/api/auth/change-password`, {
        userId: resetApproved.userId,
        resetRequestId: resetApproved._id,
        newPassword,
      });
      setError('Password changed. You can login now.');
      setResetApproved(null);
      setNewPassword('');
      setPassword('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not change password.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">CN Lab Login</h1>
        <p className="text-sm text-gray-500 mb-6">
          Sign in with the credentials assigned by your teacher.
        </p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Roll Number / Student ID</label>
            <input
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="e.g. 2023103067"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1">Used in evaluation CSVs and grading export.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
              {error}
            </div>
          )}

          {connectionBlocked && (
            <button
              type="button"
              onClick={requestSessionDisconnect}
              disabled={disconnectRequestLoading}
              className="w-full py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm font-semibold hover:bg-amber-100 disabled:opacity-50"
            >
              {disconnectRequestLoading ? 'Sending request…' : 'Request teacher to disconnect active session'}
            </button>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {loading ? 'Starting session…' : 'Enter Lab'}
          </button>
        </form>

        <div className="mt-5 border-t pt-4 space-y-3">
          <div className="flex gap-2">
            <button onClick={requestPasswordReset} className="flex-1 text-sm px-3 py-2 rounded-md bg-gray-100 text-gray-700">
              Forgot password
            </button>
            <button onClick={checkResetApproval} className="flex-1 text-sm px-3 py-2 rounded-md bg-gray-100 text-gray-700">
              Check approval
            </button>
          </div>
          {resetApproved && (
            <div className="space-y-2">
              <PasswordInput
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-500">Minimum 8 characters with at least one special symbol.</p>
              <button onClick={setApprovedPassword} className="w-full py-2 rounded-md bg-green-600 text-white text-sm font-medium">
                Set New Password
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          <Link to="/" className="text-indigo-600 hover:underline">Back to home</Link>
        </p>
      </div>
    </div>
  );
}
