import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { API_BASE } from '../config';

export default function TeacherTimeControl() {
  const navigate = useNavigate();
  const [modules, setModules] = useState([]);
  const [slots, setSlots] = useState([]);
  const [batches, setBatches] = useState([]);
  const [activeAssignments, setActiveAssignments] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [form, setForm] = useState({
    moduleId: '',
    slotKey: '',
    batch: '',
    extraMinutes: 10,
    studentIds: '',
  });
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

  useEffect(() => {
    Promise.all([
      axios.get(`${API_BASE}/api/modules`),
      axios.get(`${API_BASE}/api/performance/slots`),
      axios.get(`${API_BASE}/api/batches`),
      axios.get(`${API_BASE}/api/modules/active-assignments`),
    ])
      .then(([moduleRes, slotRes, batchRes, assignmentRes]) => {
        setModules(moduleRes.data || []);
        setSlots(slotRes.data || []);
        setBatches(batchRes.data || []);
        setActiveAssignments(assignmentRes.data || []);
      })
      .catch(() => setMessage('Failed to load time extension filters.'));
  }, []);

  const loadAttempts = async () => {
    if (!form.moduleId || !form.slotKey) return;
    const res = await axios.get(`${API_BASE}/api/sessions/test-attempts`, {
      params: {
        moduleId: form.moduleId,
        slotKey: form.slotKey,
        batch: form.batch || undefined,
      },
    });
    setAttempts(res.data || []);
  };

  useEffect(() => {
    loadAttempts().catch(() => setAttempts([]));
  }, [form.moduleId, form.slotKey, form.batch]);

  const extendTime = async (e) => {
    e.preventDefault();
    setMessage('');

    try {
      const studentIds = form.studentIds
        .split(/[\s,]+/)
        .map((id) => id.trim())
        .filter(Boolean);

      const res = await axios.post(`${API_BASE}/api/sessions/test-attempts/extend`, {
        moduleId: form.moduleId,
        slotKey: form.slotKey,
        batch: form.batch,
        userIds: studentIds,
        extraMinutes: Number(form.extraMinutes),
      });

      setMessage(`Added time to ${res.data.updatedCount} student attempt(s).`);
      await loadAttempts();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to add time.');
    }
  };

  const selectActiveAssignment = (assignment) => {
    setForm({
      ...form,
      moduleId: assignment.moduleId || '',
      slotKey: assignment.slotKey || '',
      batch: assignment.targetBatch || '',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        title="Add Test Time"
        isTeacherPage={true}
        backLink="/teacher-dashboard"
        backText="Back to Dashboard"
        onLogout={handleLogout}
      />

      <div className="container mx-auto py-8 px-4">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form onSubmit={extendTime} className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Extension Details</h2>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Active Module</label>
              <select
                value=""
                onChange={(e) => {
                  const assignment = activeAssignments.find((item) => item._id === e.target.value);
                  if (assignment) selectActiveAssignment(assignment);
                }}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">Choose currently active module</option>
                {activeAssignments.map((assignment) => (
                  <option key={assignment._id} value={assignment._id}>
                    {assignment.moduleName} · {assignment.startTime && assignment.endTime ? `${assignment.startTime} – ${assignment.endTime}` : assignment.slotKey} · Batch {assignment.targetBatch || 'All'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Module</label>
              <select
                value={form.moduleId}
                onChange={(e) => setForm({ ...form, moduleId: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">Select module</option>
                {modules.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Lab Window</label>
              <select
                value={form.slotKey}
                onChange={(e) => setForm({ ...form, slotKey: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">Select session</option>
                {slots.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Batch</label>
              <select
                value={form.batch}
                onChange={(e) => setForm({ ...form, batch: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">All batches</option>
                {batches.map((b) => <option key={b._id || b.name} value={b.name}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Extra Minutes</label>
              <input
                type="number"
                min="1"
                value={form.extraMinutes}
                onChange={(e) => setForm({ ...form, extraMinutes: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Specific Student IDs</label>
              <textarea
                value={form.studentIds}
                onChange={(e) => setForm({ ...form, studentIds: e.target.value })}
                placeholder="Leave blank to apply to all matching students"
                className="w-full border rounded-md px-3 py-2 text-sm h-24"
              />
            </div>
            <button className="w-full py-2 rounded-md bg-indigo-600 text-white text-sm font-medium">
              Add Time
            </button>
            {message && <p className="text-sm text-gray-700">{message}</p>}
          </form>

          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Matching Attempts</h2>
            <div className="overflow-x-auto border rounded-md">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2">Student</th>
                    <th className="text-left px-3 py-2">Batch</th>
                    <th className="text-left px-3 py-2">Started</th>
                    <th className="text-left px-3 py-2">Ends</th>
                    <th className="text-left px-3 py-2">Extra</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {attempts.map((a) => (
                    <tr key={a._id}>
                      <td className="px-3 py-2">{a.studentName || a.userId}</td>
                      <td className="px-3 py-2">{a.batch || '-'}</td>
                      <td className="px-3 py-2">{new Date(a.startedAt).toLocaleString()}</td>
                      <td className="px-3 py-2">{new Date(a.endsAt).toLocaleString()}</td>
                      <td className="px-3 py-2">{a.extraMinutes || 0} min</td>
                    </tr>
                  ))}
                  {!attempts.length && (
                    <tr>
                      <td className="px-3 py-8 text-center text-gray-500" colSpan="5">
                        No attempts found for the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
