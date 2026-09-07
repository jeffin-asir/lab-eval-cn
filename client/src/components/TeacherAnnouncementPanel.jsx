import { useMemo, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';

export default function TeacherAnnouncementPanel({ batches, students, onMessage }) {
  const [message, setMessage] = useState('');
  const [type, setType] = useState('notification');
  const [target, setTarget] = useState('all');
  const [batch, setBatch] = useState('');
  const [studentIds, setStudentIds] = useState([]);
  const [sending, setSending] = useState(false);
  const visibleStudents = useMemo(() => batch ? students.filter((student) => student.batch === batch) : students, [students, batch]);

  const send = async (event) => {
    event.preventDefault();
    setSending(true);
    try {
      const response = await axios.post(`${API_BASE}/api/announcements`, { message, type, target, batch, studentIds });
      onMessage?.(`${type === 'alert' ? 'Alert' : 'Notification'} sent to ${response.data.recipientCount} student${response.data.recipientCount === 1 ? '' : 's'}.`);
      setMessage(''); setStudentIds([]);
    } catch (err) { onMessage?.(err.response?.data?.error || 'Could not send message.'); }
    finally { setSending(false); }
  };

  return <form onSubmit={send} className="bg-white border border-indigo-200 rounded-lg p-5 shadow-sm space-y-3">
    <div><h2 className="text-base font-semibold text-gray-900">Message Students</h2><p className="mt-1 text-xs text-gray-500">Notifications appear as a banner. Alerts require acknowledgement.</p></div>
    <textarea required maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write a message for students…" className="h-24 w-full rounded-md border px-3 py-2 text-sm" />
    <div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium text-gray-600">Display<select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded border px-2 py-2 text-sm"><option value="notification">Notification</option><option value="alert">Alert dialog</option></select></label><label className="text-xs font-medium text-gray-600">Recipients<select value={target} onChange={(e) => { setTarget(e.target.value); setStudentIds([]); }} className="mt-1 w-full rounded border px-2 py-2 text-sm"><option value="all">All available</option><option value="batch">One batch</option><option value="students">Student(s)</option></select></label></div>
    {(target === 'batch' || target === 'students') && <label className="block text-xs font-medium text-gray-600">Batch filter<select value={batch} onChange={(e) => setBatch(e.target.value)} className="mt-1 w-full rounded border px-2 py-2 text-sm"><option value="">All available batches</option>{batches.map((item) => <option key={item._id || item.name} value={item.name}>{item.name}</option>)}</select></label>}
    {target === 'students' && <label className="block text-xs font-medium text-gray-600">Choose one or more students<select multiple required value={studentIds} onChange={(e) => setStudentIds([...e.target.selectedOptions].map((option) => option.value))} className="mt-1 h-28 w-full rounded border px-2 py-2 text-sm">{visibleStudents.map((student) => <option key={student.user_id} value={student.user_id}>{student.user_id} — {student.name} ({student.batch || '-'})</option>)}</select></label>}
    <button disabled={sending} className="w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-50">{sending ? 'Sending…' : `Send ${type === 'alert' ? 'alert' : 'notification'}`}</button>
  </form>;
}
