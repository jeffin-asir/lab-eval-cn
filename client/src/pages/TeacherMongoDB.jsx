import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { API_BASE } from '../config';
import {
  ArrowDownTrayIcon, ArrowPathIcon, ChevronLeftIcon, ChevronRightIcon,
  CircleStackIcon, CodeBracketSquareIcon, DocumentPlusIcon, MagnifyingGlassIcon,
  PencilSquareIcon, PlusIcon, TrashIcon,
} from '@heroicons/react/24/outline';

const PAGE_SIZE = 25;

function prettyDocument(document) {
  return JSON.stringify(document, null, 2);
}

function documentPreview(document) {
  const copy = { ...document };
  delete copy._id;
  const text = JSON.stringify(copy);
  return text.length > 170 ? `${text.slice(0, 170)}…` : text;
}

export default function TeacherMongoDB() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [selected, setSelected] = useState('');
  const [documents, setDocuments] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState(null); // { mode, id, text }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get(`${API_BASE}/api/auth/me`, { params: { role: 'teacher' } })
      .then((res) => {
        if (!['faculty', 'admin'].includes(res.data.user.role)) navigate('/teacher-login');
      })
      .catch((err) => { if (err.response?.status === 401) navigate('/teacher-login'); });
  }, [navigate]);

  const loadCollections = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/mongodb/collections`);
      const next = res.data || [];
      setCollections(next);
      setSelected((current) => next.some((item) => item.name === current) ? current : (next[0]?.name || ''));
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to load MongoDB collections.');
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await axios.get(`${API_BASE}/api/mongodb/collections/${encodeURIComponent(selected)}/documents`, {
        params: { page, limit: PAGE_SIZE },
      });
      setDocuments(res.data.documents || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to load collection documents.');
    } finally {
      setLoading(false);
    }
  }, [selected, page]);

  useEffect(() => { loadCollections(); }, [loadCollections]);
  useEffect(() => { setPage(1); setSearch(''); }, [selected]);
  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  const visibleDocuments = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? documents.filter((doc) => JSON.stringify(doc).toLowerCase().includes(term)) : documents;
  }, [documents, search]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedCollection = collections.find((item) => item.name === selected);

  const chooseCollection = (name) => {
    setSelected(name);
    setEditor(null);
    setMessage('');
  };

  const openNew = () => setEditor({ mode: 'create', text: '{\n  \n}' });
  const openEdit = (doc) => {
    const { _id, ...body } = doc;
    setEditor({ mode: 'edit', id: JSON.stringify(_id), text: prettyDocument(body) });
  };

  const saveDocument = async () => {
    if (!editor) return;
    setSaving(true);
    setMessage('');
    try {
      const path = `${API_BASE}/api/mongodb/collections/${encodeURIComponent(selected)}/documents`;
      if (editor.mode === 'create') {
        await axios.post(path, { document: editor.text });
        setMessage('Document created.');
      } else {
        await axios.put(path, { id: editor.id, document: editor.text });
        setMessage('Document updated.');
      }
      setEditor(null);
      await Promise.all([loadDocuments(), loadCollections()]);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Could not save the document. Check the JSON and try again.');
    } finally {
      setSaving(false);
    }
  };

  const deleteDocument = async (doc) => {
    if (!confirm('Delete this document permanently? This cannot be undone.')) return;
    try {
      await axios.delete(`${API_BASE}/api/mongodb/collections/${encodeURIComponent(selected)}/documents`, {
        data: { id: JSON.stringify(doc._id) },
      });
      setMessage('Document deleted.');
      if (documents.length === 1 && page > 1) setPage(page - 1);
      else await Promise.all([loadDocuments(), loadCollections()]);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Could not delete the document.');
    }
  };

  const exportCollection = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/mongodb/collections/${encodeURIComponent(selected)}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selected}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Could not export this collection.');
    }
  };

  const handleLogout = async () => {
    await axios.post(`${API_BASE}/api/auth/logout`, { role: 'teacher' }).catch(() => {});
    navigate('/teacher-login');
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <Header title="MongoDB Manager" isTeacherPage={true} backLink="/teacher-dashboard" backText="Back to Dashboard" onLogout={handleLogout} />
      <main className="max-w-7xl mx-auto px-4 py-6">
        {message && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}
        <div className="rounded-xl border border-slate-300 bg-white shadow-sm overflow-hidden min-h-[650px] flex flex-col">
          <div className="flex items-center gap-3 bg-slate-900 px-5 py-3 text-slate-100">
            <CircleStackIcon className="h-5 w-5 text-emerald-400" />
            <span className="font-semibold">Lab Database</span>
            <span className="text-xs text-slate-400">MongoDB data explorer</span>
            <button onClick={() => { loadCollections(); loadDocuments(); }} className="ml-auto inline-flex items-center gap-1 rounded border border-slate-600 px-2.5 py-1.5 text-xs hover:bg-slate-800">
              <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          <div className="flex flex-1 min-h-0">
            <aside className="w-64 shrink-0 border-r border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Collections</p>
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{collections.length}</span>
              </div>
              <div className="py-2">
                {collections.map((collection) => <button key={collection.name} onClick={() => chooseCollection(collection.name)} className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm ${selected === collection.name ? 'bg-emerald-50 text-emerald-800 border-r-2 border-emerald-500 font-medium' : 'text-slate-700 hover:bg-slate-100'}`}>
                  <CircleStackIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{collection.name}</span><span className="ml-auto text-xs text-slate-400">{collection.count}</span>
                </button>)}
                {!collections.length && <p className="px-4 py-6 text-sm text-slate-400">No collections found.</p>}
              </div>
            </aside>
            <section className="min-w-0 flex-1 flex flex-col">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-xs text-slate-500">DATABASE / {selected || '—'}</p><h1 className="text-lg font-semibold text-slate-900">{selected || 'Select a collection'}</h1></div>
                  {selected && <div className="flex flex-wrap gap-2">
                    <button onClick={exportCollection} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><ArrowDownTrayIcon className="h-4 w-4" /> Export JSON</button>
                    <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"><PlusIcon className="h-4 w-4" /> Add Data</button>
                  </div>}
                </div>
                {selected && <div className="mt-3 flex items-center gap-3 text-xs text-slate-500"><CodeBracketSquareIcon className="h-4 w-4" /> {selectedCollection?.count ?? total} document{(selectedCollection?.count ?? total) === 1 ? '' : 's'} <span>•</span> BSON-aware JSON editor</div>}
              </div>
              {selected && <div className="border-b border-slate-200 bg-slate-50 px-5 py-3"><div className="relative max-w-md"><MagnifyingGlassIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter loaded documents…" className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500" /></div></div>}
              <div className="flex-1 overflow-auto bg-slate-50 p-4">
                {selected && <div className="space-y-3">
                  {visibleDocuments.map((doc) => <article key={JSON.stringify(doc._id)} className="rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5"><span className="font-mono text-xs text-slate-500 break-all">_id: {typeof doc._id === 'object' ? JSON.stringify(doc._id) : String(doc._id)}</span><div className="flex gap-2"><button onClick={() => openEdit(doc)} className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:text-indigo-900"><PencilSquareIcon className="h-4 w-4" /> Edit</button><button onClick={() => deleteDocument(doc)} className="inline-flex items-center gap-1 text-sm text-red-700 hover:text-red-900"><TrashIcon className="h-4 w-4" /> Delete</button></div></div>
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-xs leading-5 text-slate-700">{documentPreview(doc)}</pre>
                  </article>)}
                  {!visibleDocuments.length && <div className="py-16 text-center text-sm text-slate-500">{loading ? 'Loading documents…' : documents.length ? 'No loaded documents match this filter.' : 'This collection has no documents yet.'}</div>}
                </div>}
              </div>
              {selected && <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm text-slate-600"><span>Page {page} of {pageCount} · {total} total</span><div className="flex gap-2"><button disabled={page === 1 || loading} onClick={() => setPage(page - 1)} className="rounded border border-slate-300 p-1.5 disabled:opacity-40"><ChevronLeftIcon className="h-4 w-4" /></button><button disabled={page >= pageCount || loading} onClick={() => setPage(page + 1)} className="rounded border border-slate-300 p-1.5 disabled:opacity-40"><ChevronRightIcon className="h-4 w-4" /></button></div></div>}
            </section>
          </div>
        </div>
      </main>
      {editor && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-semibold text-slate-900">{editor.mode === 'create' ? 'Add Document' : 'Edit Document'}</h2><p className="text-xs text-slate-500">Use Extended JSON for MongoDB values, e.g. {`{ "$oid": "…" }`}.</p></div><button onClick={() => setEditor(null)} className="text-sm text-slate-500 hover:text-slate-800">Cancel</button></div><div className="p-5"><textarea value={editor.text} onChange={(event) => setEditor({ ...editor, text: event.target.value })} spellCheck="false" className="h-96 w-full rounded-lg border border-slate-300 bg-slate-950 p-4 font-mono text-sm leading-6 text-emerald-100 outline-none focus:ring-2 focus:ring-emerald-500" /><div className="mt-4 flex justify-end gap-3"><button onClick={() => setEditor(null)} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Cancel</button><button disabled={saving} onClick={saveDocument} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><DocumentPlusIcon className="h-4 w-4" /> {saving ? 'Saving…' : 'Save Document'}</button></div></div></div></div>}
    </div>
  );
}
