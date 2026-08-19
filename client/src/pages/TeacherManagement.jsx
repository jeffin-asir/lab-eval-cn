import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { API_BASE } from '../config';
import PasswordInput from '../components/PasswordInput';

const emptyForm = { name: '', userId: '', password: '', assignedBatches: [] };

export default function TeacherManagement() {
  const navigate = useNavigate();
  const [teachers, setTeachers] = useState([]);
  const [batches, setBatches] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');

  const logout = async () => { await axios.post(`${API_BASE}/api/auth/logout`, { role: 'teacher' }).catch(() => {}); navigate('/teacher-login'); };
  const load = async () => {
    const [me, teacherRes, batchRes] = await Promise.all([
      axios.get(`${API_BASE}/api/auth/me`, { params: { role: 'teacher' } }),
      axios.get(`${API_BASE}/api/batches/teachers`), axios.get(`${API_BASE}/api/batches`),
    ]);
    if (me.data.user.role !== 'admin') return navigate('/teacher-dashboard');
    setTeachers(teacherRes.data || []); setBatches(batchRes.data || []);
  };
  useEffect(() => { load().catch(() => navigate('/teacher-login')); }, []);
  const toggleBatch = (name) => setForm((prev) => ({ ...prev, assignedBatches: prev.assignedBatches.includes(name) ? prev.assignedBatches.filter((b) => b !== name) : [...prev.assignedBatches, name] }));
  const save = async (event) => {
    event.preventDefault(); setMessage('');
    try {
      if (editing) await axios.patch(`${API_BASE}/api/batches/teachers/${editing}`, { name: form.name, password: form.password || undefined, assignedBatches: form.assignedBatches });
      else await axios.post(`${API_BASE}/api/batches/teachers`, form);
      setMessage(editing ? 'Teacher updated.' : 'Teacher created.'); setForm(emptyForm); setEditing(null); await load();
    } catch (err) { setMessage(err.response?.data?.error || 'Could not save teacher.'); }
  };
  const edit = (teacher) => { setEditing(teacher.user_id); setForm({ name: teacher.name || '', userId: teacher.user_id, password: '', assignedBatches: teacher.assignedBatches || [] }); };
  const createBatch = async () => {
    const name = window.prompt('New batch name');
    if (!name?.trim()) return;
    try { const response = await axios.post(`${API_BASE}/api/batches/create-empty`, { name }); setBatches((previous) => [...previous, response.data.batch].sort((a, b) => a.name.localeCompare(b.name))); setMessage(`Batch ${response.data.batch.name} created.`); }
    catch (err) { setMessage(err.response?.data?.error || 'Could not create batch.'); }
  };
  return <div className="min-h-screen bg-gray-50"><Header title="Teachers & Batch Assignments" isTeacherPage backLink="/teacher-dashboard" backText="Back to Dashboard" onLogout={logout} />
    <main className="container mx-auto max-w-6xl px-4 py-8 grid gap-6 lg:grid-cols-3"><form onSubmit={save} className="rounded-xl border bg-white p-5 shadow-sm space-y-4"><h2 className="font-semibold">{editing ? 'Edit Teacher' : 'Create Teacher'}</h2>
      <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Teacher name" className="w-full rounded border px-3 py-2 text-sm" />
      <input required={!editing} disabled={!!editing} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} placeholder="Username" className="w-full rounded border px-3 py-2 text-sm disabled:bg-gray-100" />
      <PasswordInput required={!editing} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editing ? 'New password (optional)' : 'Password'} className="w-full rounded border px-3 py-2 text-sm" />
      <div><div className="mb-2 flex items-center gap-2"><p className="text-sm font-medium">Assigned batches</p><button type="button" onClick={createBatch} className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white" title="Create new batch">+</button></div><div className="space-y-1 max-h-48 overflow-auto">{batches.map((batch) => <label key={batch._id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.assignedBatches.includes(batch.name)} onChange={() => toggleBatch(batch.name)} /> {batch.name}</label>)}</div></div>
      <button className="w-full rounded bg-indigo-600 py-2 text-sm font-medium text-white">{editing ? 'Save teacher' : 'Create teacher'}</button>{editing && <button type="button" onClick={() => { setEditing(null); setForm(emptyForm); }} className="w-full text-sm text-gray-600">Cancel</button>}{message && <p className="text-sm text-gray-700">{message}</p>}</form>
      <section className="lg:col-span-2 rounded-xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-semibold">Teachers</h2><div className="divide-y">{teachers.map((teacher) => <div key={teacher.user_id} className="flex items-center justify-between gap-4 py-3"><div><p className="font-medium">{teacher.name} {teacher.role === 'admin' && <span className="ml-2 text-xs text-indigo-700">Admin</span>}</p><p className="text-sm text-gray-500">{teacher.user_id} · {(teacher.assignedBatches || []).join(', ') || 'No batches assigned'}</p></div>{teacher.role === 'faculty' && <button onClick={() => edit(teacher)} className="rounded border px-3 py-1.5 text-sm text-indigo-700">Edit</button>}</div>)}</div></section></main></div>;
}
