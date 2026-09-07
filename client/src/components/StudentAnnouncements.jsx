import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';

export default function StudentAnnouncements() {
  const [announcements, setAnnouncements] = useState([]);
  const [isStudent, setIsStudent] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await axios.get(`${API_BASE}/api/auth/me`);
      if (me.data?.user?.role !== 'student') return setIsStudent(false);
      setIsStudent(true);
      const result = await axios.get(`${API_BASE}/api/announcements/mine`);
      setAnnouncements(result.data || []);
    } catch {
      setIsStudent(false);
      setAnnouncements([]);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const dismiss = async (id) => {
    setAnnouncements((items) => items.filter((item) => item._id !== id));
    try { await axios.post(`${API_BASE}/api/announcements/${id}/dismiss`); } catch { load(); }
  };

  const alerts = useMemo(() => announcements.filter((item) => item.type === 'alert'), [announcements]);
  const notifications = useMemo(() => announcements.filter((item) => item.type === 'notification').slice(0, 3), [announcements]);
  const activeAlert = alerts[0];
  if (!isStudent) return null;

  return <>
    <div className="fixed right-4 top-4 z-[10000] w-[min(24rem,calc(100vw-2rem))] space-y-3">
      {notifications.map((item) => <section key={item._id} className="rounded-xl border border-indigo-200 bg-white p-4 shadow-xl" role="status">
        <div className="flex items-start gap-3"><span className="mt-0.5 text-indigo-600">●</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-gray-900">Message from your teacher</p><p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{item.message}</p></div><button onClick={() => dismiss(item._id)} className="text-lg leading-none text-gray-400 hover:text-gray-700" aria-label="Dismiss notification">×</button></div>
      </section>)}
    </div>
    {activeAlert && <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-slate-950/45 p-4" role="alertdialog" aria-modal="true" aria-labelledby="teacher-alert-title">
      <section className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Teacher alert</p>
        <h2 id="teacher-alert-title" className="mt-2 text-lg font-semibold text-gray-900">Please read this message</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700">{activeAlert.message}</p>
        <div className="mt-6 flex justify-end"><button onClick={() => dismiss(activeAlert._id)} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Acknowledge</button></div>
      </section>
    </div>}
  </>;
}
