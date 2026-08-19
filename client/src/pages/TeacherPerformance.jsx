import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { API_BASE } from '../config';
import {
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ChartBarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';

const CONN_LABELS = ['Listen', 'Established', 'Closed'];

const toDateKey = (date) => {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
const monthLabel = (date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function VerdictPill({ value }) {
  if (!value) return <span className="text-gray-300">—</span>;
  const isCorrect = value === 'Correct';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
        isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {value}
    </span>
  );
}

export default function TeacherPerformance() {
  const navigate = useNavigate();

  const [sessions, setSessions] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState('');

  const [tableSearch, setTableSearch] = useState('');
  const [classReport, setClassReport] = useState(null);
  const [isClassLoading, setIsClassLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
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

  const loadFilters = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/performance/session-catalog`);
      const catalog = response.data.sessions || [];
      setSessions(catalog);
    } catch (err) {
      console.error('Error loading performance filters:', err);
      setMessage('Failed to load lab session calendar.');
    }
  }, []);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  const sessionsForDate = useMemo(() => sessions.filter((session) => session.date === selectedDate), [sessions, selectedDate]);
  const selectedSession = useMemo(() => sessions.find((session) => session.id === selectedSessionId) || null, [sessions, selectedSessionId]);
  const needsBatchChoice = Boolean(selectedSession && (selectedSession.allBatches || selectedSession.batches.length > 1));
  const filtersReady = Boolean(selectedBatch && selectedSession?.moduleId);

  const selectDate = (date) => {
    setSelectedDate(date);
    setSelectedSessionId('');
    setSelectedBatch('');
    setCalendarOpen(false);
  };

  const selectSession = (id) => {
    const session = sessions.find((item) => item.id === id);
    setSelectedSessionId(id);
    setSelectedBatch(session?.batches?.length === 1 ? session.batches[0] : '');
  };

  useEffect(() => {
    setTableSearch('');

    if (!filtersReady) {
      setClassReport(null);
      return;
    }

    let cancelled = false;
    setIsClassLoading(true);
    setMessage('');
    axios.get(`${API_BASE}/api/performance/class-report`, {
      params: {
        batch: selectedBatch,
        moduleId: selectedSession.moduleId,
        slot: selectedSession.slotKey || undefined,
      },
    })
      .then((res) => {
        if (!cancelled) setClassReport(res.data);
      })
      .catch((err) => {
        if (!cancelled) {
          setClassReport(null);
          setMessage(err.response?.data?.error || 'Failed to load class report.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsClassLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBatch, selectedSession, filtersReady]);

  // Filters the already-fetched pool of students for this session/batch/module
  // — no extra request per keystroke, and nothing to search until that pool exists.
  const visibleRows = useMemo(() => {
    const rows = classReport?.rows || [];
    const term = tableSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => (
      row.student.name?.toLowerCase().includes(term)
      || row.student.user_id?.toLowerCase().includes(term)
      || row.student.roll_number?.toLowerCase().includes(term)
    ));
  }, [classReport, tableSearch]);

  const handleDownloadCsv = async () => {
    if (!selectedBatch) {
      setMessage('Please select a class/batch first.');
      return;
    }
    if (!selectedSession?.moduleId) {
      setMessage('Please select a lab session first.');
      return;
    }

    setIsDownloading(true);
    setMessage('');

    try {
      const res = await axios.get(`${API_BASE}/api/performance/class-csv`, {
        params: { batch: selectedBatch, moduleId: selectedSession.moduleId, slot: selectedSession.slotKey || undefined },
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      const slotPart = selectedSession.slotKey || selectedSession.date;
      link.setAttribute('download', `performance_${selectedBatch}_${slotPart}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading CSV:', err);
      setMessage(
        err.response?.data?.error
          ? err.response.data.error
          : 'Failed to download the class report.'
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const summary = classReport?.summary;
  const sessionDates = useMemo(() => new Set(sessions.map((session) => session.date)), [sessions]);
  const firstCalendarDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const calendarStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1 - firstCalendarDay.getDay());
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(calendarStart.getFullYear(), calendarStart.getMonth(), calendarStart.getDate() + index);
    return { date: toDateKey(day), day, inMonth: day.getMonth() === calendarMonth.getMonth() };
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        title="Student Performances"
        isTeacherPage={true}
        backLink="/teacher-dashboard"
        backText="Back to Dashboard"
        onLogout={handleLogout}
      />

      <div className="container mx-auto py-8 px-4">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Find a lab session</h2>
            <p className="mb-4 text-xs text-gray-500">Choose a date, then its lab session. Batch is requested only when that session reached more than one batch.</p>
            <div className="grid grid-cols-1 lg:grid-cols-[11rem_minmax(16rem,1fr)] gap-5">
              <div>
                <button type="button" onClick={() => setCalendarOpen((open) => !open)} className="flex w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"><span className="flex items-center gap-2"><CalendarDaysIcon className="h-4 w-4 text-indigo-600" />{new Date(`${selectedDate}T00:00:00`).toLocaleDateString()}</span><span className="text-xs text-gray-500">Change</span></button>
                {calendarOpen && <div className="mt-2 rounded-md border border-gray-200 bg-white p-2 shadow-lg">
                  <div className="mb-1 flex items-center justify-between"><button type="button" aria-label="Previous month" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="rounded p-0.5 text-gray-600 hover:bg-gray-100"><ChevronLeftIcon className="h-3.5 w-3.5" /></button><p className="text-xs font-medium text-gray-800">{monthLabel(calendarMonth)}</p><button type="button" aria-label="Next month" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="rounded p-0.5 text-gray-600 hover:bg-gray-100"><ChevronRightIcon className="h-3.5 w-3.5" /></button></div>
                  <div className="grid grid-cols-7 gap-0.5 text-center text-[9px] text-gray-400">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
                  <div className="mt-0.5 grid grid-cols-7 gap-0.5">{calendarDays.map(({ date, day, inMonth }) => { const hasSession = sessionDates.has(date); return <button type="button" key={date} onClick={() => selectDate(date)} className={`h-5 rounded text-[10px] ${selectedDate === date ? 'ring-1 ring-indigo-600' : ''} ${hasSession ? 'bg-green-100 font-semibold text-green-800' : inMonth ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-300'}`}>{day.getDate()}</button>; })}</div>
                  <p className="mt-1 text-[9px] text-green-700">Green = lab session</p>
                </div>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Lab / module on {selectedDate || 'selected date'}</label>
                <select
                  value={selectedSessionId}
                  onChange={(e) => selectSession(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={!selectedDate || !sessionsForDate.length}
                >
                  <option value="">{!selectedDate ? 'Choose a date first' : sessionsForDate.length ? 'Select lab/module' : 'No lab sessions on this date'}</option>
                  {sessionsForDate.map((session) => <option key={session.id} value={session.id}>{session.moduleName} · {session.deliveryMode === 'exam' ? 'Lab exam' : 'Lab session'}{session.startTime && session.endTime ? ` · ${session.startTime} – ${session.endTime}` : ''}</option>)}
                </select>
                {selectedSession && needsBatchChoice && <div className="mt-4"><label className="block text-xs font-medium text-gray-500 mb-1">Class / Batch</label><select value={selectedBatch} onChange={(e) => setSelectedBatch(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"><option value="">Select batch</option>{selectedSession.batches.map((batch) => <option key={batch} value={batch}>{batch}</option>)}</select></div>}
                {selectedSession && !needsBatchChoice && <p className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">Batch: <b>{selectedSession.batches[0] || 'No enrolled batch'}</b></p>}
              </div>
            </div>
          </div>

          {/* Search — sits right below the filters, and only searches the
              pool of students the filters above just fetched. Disabled until
              that pool exists so it can't be mistaken for a global lookup. */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                disabled={!filtersReady}
                placeholder={filtersReady ? 'Search this session by name, roll number, or student ID…' : 'Select a date and lab session above to search'}
                className="w-full pl-9 pr-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
            {filtersReady && classReport?.rows && (
              <p className="mt-2 text-xs text-gray-500">
                Showing {visibleRows.length} of {classReport.rows.length} students
              </p>
            )}
          </div>

          {message && (
            <div className="p-3 rounded-md bg-yellow-50 text-yellow-800 border-l-4 border-yellow-400 text-sm">
              {message}
            </div>
          )}

          {/* Session status boxes — quick monitoring snapshot for the
              currently selected batch/module/slot (covers the whole batch,
              independent of the search filter above). */}
          {summary && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <ChartBarIcon className="w-4 h-4 text-indigo-500" />
                Session Status
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Students in Batch</p>
                  <p className="text-2xl font-semibold text-gray-900">{summary.totalStudents}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Not Started</p>
                  <p className="text-2xl font-semibold text-red-700">{summary.studentsNotStarted}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Completed All Questions</p>
                  <p className="text-2xl font-semibold text-green-700">{summary.studentsCompletedAll}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500">Total Questions</p>
                  <p className="text-2xl font-semibold text-indigo-700">{summary.totalQuestions}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    Students by questions fully solved
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {summary.completionDistribution.map((count, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-100 px-2.5 py-1 text-xs text-indigo-700"
                      >
                        {i}/{summary.totalQuestions} solved: <span className="font-semibold">{count}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Per-question progress</p>
                  <div className="space-y-1">
                    {summary.perQuestion.map((q) => (
                      <div key={q.questionId} className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 rounded-md px-3 py-1.5">
                        <span className="truncate pr-2">{q.questionKey}</span>
                        <span className="whitespace-nowrap">
                          {q.correctCount} solved · {q.attemptedCount} attempted / {summary.totalStudents}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Class Report</h2>
            {!filtersReady ? (
              <p className="text-sm text-gray-500">Select a date and lab session to show all student reports.</p>
            ) : isClassLoading ? (
              <p className="text-sm text-gray-500">Loading class report...</p>
            ) : visibleRows.length ? (
              <div className="overflow-x-auto border rounded-md">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="text-left px-3 py-2">Student</th>
                      {visibleRows[0]?.questions?.map((q) => (
                        <th key={q.questionId} className="text-left px-3 py-2">
                          {q.questionKey || q.title || 'Question'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {visibleRows.map((row) => (
                      <tr key={row.student.user_id}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900">{row.student.roll_number || row.student.user_id}</p>
                          <p className="text-xs text-gray-500">{row.student.name}</p>
                        </td>
                        {row.questions.map((q) => (
                          <td key={q.questionId} className="px-3 py-2 align-top">
                            {q.attempted ? (
                              <div className="space-y-1">
                                {q.tcGroups.map((group, testcaseIndex) => group.verdicts.length > 0 && <div key={testcaseIndex} className="flex flex-wrap items-center gap-1 text-xs"><span className="font-medium text-gray-600">TC{testcaseIndex + 1}:</span>{group.verdicts.map((value, communicationIndex) => <VerdictPill key={communicationIndex} value={value} />)}</div>)}
                                {q.persistence && <p className="text-xs text-gray-500">Persistence: {q.persistence}</p>}
                                {CONN_LABELS.filter((label) => q[label]).map((label) => <p key={label} className="text-xs text-gray-500">{label}: <VerdictPill value={q[label]} /></p>)}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">Not attempted</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {classReport?.rows?.length ? 'No students match your search.' : 'No students found for this selection.'}
              </p>
            )}
          </div>

          {/* Collective CSV download */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">
              Collective Class Report
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Downloads one CSV row per student in the selected batch, with each
              question's test-case verdicts, persistence, and connection checks
              laid out as columns — matching the per-student evaluated/status/conn
              CSVs produced during evaluation.
            </p>
            <button
              onClick={handleDownloadCsv}
              disabled={isDownloading || !filtersReady}
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-md text-sm font-medium hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 flex items-center gap-2"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              {isDownloading ? 'Preparing CSV…' : 'Download Class CSV'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
