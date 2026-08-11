import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Panel, PanelGroup } from 'react-resizable-panels';
import axios from 'axios';
import Header from '../components/Header';
import EditorPane from '../components/EditorPane';
import QuestionPane from '../components/QuestionPane';
import TerminalPane from '../components/TerminalPane';
import FileSelectorModal from '../components/EditorPane/fileSelectorModal';
import ResizeHandle from '../components/shared/ResizeHandle';
import { useIsMobile } from '../components/utils/useIsMobile';
import { summarizeResults } from '../components/utils/testcaseHelper';
import { fetchWithRetry } from '../components/utils/fetchWithRetry';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { API_BASE } from '../config';
import StudentConnectionHeartbeat from '../components/StudentConnectionHeartbeat';

// Helper function to get current lab session ID
const getCurrentLabSession = () => window.__labSessionId || '';
const LABUSER_HOME = '/home/labuser';
const getCurrentDateTime = () =>
  new Date().toISOString();


const MobileTabs = ({ activeTab, setActiveTab, tabs }) => (
  <div className="flex bg-white border-b border-gray-200 shadow-sm">
    {tabs.map(tab => (
      <button
        key={tab.id}
        className={`flex-1 py-3 px-4 text-sm font-medium transition-all duration-200 ${
          activeTab === tab.id 
            ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' 
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
        }`}
        onClick={() => setActiveTab(tab.id)}
      >
        <span className="flex items-center justify-center">
          {tab.icon && <tab.icon className="w-4 h-4 mr-2" />}
          {tab.label}
        </span>
      </button>
    ))}
  </div>
);

const EvaluationOverlay = ({ overlay, logBoxRef, onClose }) => {
  if (!overlay.open) return null;

  const ansiToHtml = (text) => {
    const escapeHtml = (value) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Foreground codes (30-37 normal, 90-97 bright)
    const fgMap = {
      30: '#111827',
      31: '#ff5f56',
      32: '#27c93f',
      33: '#ffbd2e',
      34: '#5e9cff',
      35: '#d670d6',
      36: '#56d4dd',
      37: '#f8f8f2',
      90: '#6b7280',
      91: '#ff7b72',
      92: '#7ee787',
      93: '#f2cc60',
      94: '#79c0ff',
      95: '#d2a8ff',
      96: '#a5f3fc',
      97: '#ffffff',
    };

    // Background codes (40-47 normal, 100-107 bright) — this is what
    // evaluation.py's print_c() actually uses: \033[42m (green bg) for
    // "Passed" and \033[41m (red bg) for "Failed". These were previously
    // missing entirely, so those escapes matched nothing and got silently
    // dropped, leaving plain white text.
    const bgMap = {
      40: '#111827',
      41: '#ff5f56',
      42: '#27c93f',
      43: '#ffbd2e',
      44: '#5e9cff',
      45: '#d670d6',
      46: '#56d4dd',
      47: '#f8f8f2',
      100: '#374151',
      101: '#ff7b72',
      102: '#7ee787',
      103: '#f2cc60',
      104: '#79c0ff',
      105: '#d2a8ff',
      106: '#a5f3fc',
      107: '#ffffff',
    };

    // Real terminals keep fg/bg/bold/underline as *persistent* state until
    // explicitly changed or reset — not "reset on every escape sequence",
    // which is what the previous implementation did. That distinction
    // matters here because nice.sh/evaluation.py commonly emit a color
    // escape, some text, then another color escape for the *next* piece
    // of text without resetting in between (e.g. two consecutive
    // print_c() calls) — the old logic would drop the first span's style
    // the moment a second escape appeared, even if that escape only
    // changed one attribute.
    let state = { fg: null, bg: null, bold: false, underline: false };
    let spanOpen = false;
    let html = '';

    const isDefault = (s) => !s.fg && !s.bg && !s.bold && !s.underline;
    const styleFor = (s) => {
      const styles = [];
      if (s.fg) styles.push(`color:${s.fg}`);
      if (s.bg) styles.push(`background-color:${s.bg}`);
      if (s.bold) styles.push('font-weight:700');
      if (s.underline) styles.push('text-decoration:underline');
      return styles.join(';');
    };
    const closeSpan = () => {
      if (spanOpen) {
        html += '</span>';
        spanOpen = false;
      }
    };
    const openSpanIfStyled = () => {
      if (!isDefault(state)) {
        html += `<span style="${styleFor(state)}">`;
        spanOpen = true;
      }
    };

    const parts = escapeHtml(text).split(/(\x1b\[[0-9;]*m)/g);
    for (const part of parts) {
      const match = part.match(/^\x1b\[([0-9;]*)m$/);
      if (!match) {
        html += part;
        continue;
      }

      const codes = match[1].split(';').filter(Boolean).map(Number);
      const effectiveCodes = codes.length ? codes : [0]; // bare "\x1b[m" == reset

      closeSpan();

      for (const code of effectiveCodes) {
        if (code === 0) {
          state = { fg: null, bg: null, bold: false, underline: false };
        } else if (code === 1) {
          state.bold = true;
        } else if (code === 22) {
          state.bold = false;
        } else if (code === 4) {
          state.underline = true;
        } else if (code === 24) {
          state.underline = false;
        } else if (code === 39) {
          state.fg = null; // default foreground
        } else if (code === 49) {
          state.bg = null; // default background
        } else if (fgMap[code] !== undefined) {
          state.fg = fgMap[code];
        } else if (bgMap[code] !== undefined) {
          state.bg = bgMap[code];
        }
      }

      openSpanIfStyled();
    }

    closeSpan();
    return html;
  };

  const logText = overlay.logs.join('');

  return (
    <div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-[#101010] rounded-lg shadow-2xl border border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between bg-[#181818]">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">{overlay.title}</h2>
            <p className="text-xs text-gray-400">
              {overlay.running ? 'Evaluation is running. Please wait.' : 'Evaluation complete.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={overlay.running}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-800 text-gray-100 border border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Close
          </button>
        </div>
        <div
          ref={logBoxRef}
          className="evaluation-terminal h-96 overflow-auto text-[13px] leading-5 p-4 whitespace-pre-wrap font-mono"
          style={{ fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", monospace' }}
          dangerouslySetInnerHTML={{ __html: ansiToHtml(logText) }}
        />
      </div>
    </div>
  );
};

const TimeUpDialog = ({ state, onExit, onReview }) => {
  if (!state.open) return null;

  const message = state.submitting
    ? 'Time is up. We are auto-submitting your answers now. Please wait.'
    : state.autoSubmitted
      ? 'Time is up. Auto-submit is complete. You can review the testcase results now, then exit.'
      : state.alreadySubmitted
        ? 'Time is up. Your latest submission is already recorded.'
        : 'Time is up. This attempt cannot be continued.';

  return (
    <div className="fixed inset-0 z-[1100] bg-black/45 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg bg-white border border-gray-200 shadow-2xl p-5">
        <h2 className="text-lg font-semibold text-gray-900">Time is up</h2>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        {state.error && (
          <p className="mt-3 text-sm text-red-600">{state.error}</p>
        )}
        <div className="mt-5 flex justify-end gap-3">
          {state.autoSubmitted && !state.submitting && (
            <button
              type="button"
              onClick={onReview}
              className="px-4 py-2 rounded-md border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50"
            >
              Review Results
            </button>
          )}
          <button
            type="button"
            onClick={onExit}
            disabled={state.submitting}
            className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state.submitting ? 'Submitting...' : 'Exit'}
          </button>
        </div>
      </div>
    </div>
  );
};

const TimeLockedExit = ({ show, onExit }) => {
  if (!show) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[900] rounded-lg border border-red-200 bg-white shadow-xl p-3 flex items-center gap-3">
      <span className="text-sm font-medium text-gray-700">Time is up. Editing is locked.</span>
      <button
        type="button"
        onClick={onExit}
        className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium"
      >
        Exit
      </button>
    </div>
  );
};

const WorkspaceLoading = ({ message = 'Preparing your lab workspace...' }) => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
    <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white shadow-sm p-6 text-center">
      <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
      <h1 className="text-base font-semibold text-gray-900">CN Lab</h1>
      <p className="mt-2 text-sm text-gray-600">{message}</p>
    </div>
  </div>
);


// Helper functions
const getCurrentUser = () => window.__authUser?.user_id || '';
const getStudentName = () => window.__authUser?.name || getCurrentUser();

// Formats the lab time window for the header from start/end times or slotKey.
const getSessionLabel = (startTime, endTime, slotKey) => {
  if (startTime && endTime) return `${startTime} – ${endTime}`;
  if (slotKey) {
    const parts = slotKey.split('_');
    // moduleId_YYYY-MM-DD_HHMM_HHMM
    if (parts.length >= 4 && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
      return `${parts[2].slice(0, 2)}:${parts[2].slice(2)} – ${parts[3].slice(0, 2)}:${parts[3].slice(2)}`;
    }
    // legacy YYYY-MM-DD_HHMM_HHMM
    if (parts.length === 3 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
      return `${parts[1].slice(0, 2)}:${parts[1].slice(2)} – ${parts[2].slice(0, 2)}:${parts[2].slice(2)}`;
    }
    if (parts.length === 2 && /^(FN|AN)$/i.test(parts[1])) return parts[1].toUpperCase();
  }
  return 'Not specified';
};

function parseAvailableAtOnDate(availableAt, moduleDate) {
  if (!availableAt) return null;
  const base = moduleDate ? new Date(moduleDate) : new Date();
  const [h, m] = availableAt.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

function isQuestionUnlocked(question, now = new Date()) {
  if (question.isAvailable === false) return false;
  if (question.availableAtDate) return new Date(question.availableAtDate) <= now;
  if (question.availableAt) {
    const unlockAt = parseAvailableAtOnDate(question.availableAt, question.moduleDate);
    return !unlockAt || unlockAt <= now;
  }
  return true;
}

// Real-time module handling will be implemented with WebSockets


export default function CNLabWorkspace() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const forceFreeCoding = searchParams.get('free') === '1';
  const requestedModuleId = searchParams.get('moduleId') || '';
  const requestedSessionId = searchParams.get('sessionId') || '';
  const isMobile = useIsMobile();
  const [authReady, setAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState('question');
  const [language, setLanguage] = useState('c');
  const [showQuestion, setShowQuestion] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0);
  const [files, setFiles] = useState([]);
  const [newFileCreated, setNewFileCreated] = useState(true);
  const [fileNo, setFileNo] = useState(1);
  const [tagToFileMap, setTagToFileMap] = useState({}); // Example: { 'server1': 'server_file.c', 'client2': 'client_impl.c' }
  const [currentWorkingDir, setCurrentWorkingDir] = useState('/home/labuser'); // Track current directory
  const [saveStatus, setSaveStatus] = useState('idle'); //track autosave status
  const [activeFileId, setActiveFileId] = useState(null);
  const [showFileModal, setShowFileModal] = useState(false);
  const [availableFiles, setAvailableFiles] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testCaseResults, setTestCaseResults] = useState({});
  // Question ids that already have at least one submission where every test
  // case passed — drives the Submit -> Re-submit button label and the
  // resubmission confirmation dialog. Once a question is in here it stays
  // (an accepted submission doesn't get un-accepted), so this only ever
  // grows during a session.
  const [passedQuestionIds, setPassedQuestionIds] = useState(new Set());
  const checkedPassedQuestionIdsRef = useRef(new Set());
  const [questionPaneTab, setQuestionPaneTab] = useState('description');
  const [evalMessage, setEvalMessage] = useState(null);
  const [submissionRefreshTrigger, setSubmissionRefreshTrigger] = useState(0);
  const [attemptInfo, setAttemptInfo] = useState(null);
  const [evaluationOverlay, setEvaluationOverlay] = useState({
    open: false,
    title: '',
    running: false,
    logs: [],
  });
  const [timeUpDialog, setTimeUpDialog] = useState({
    open: false,
    submitting: false,
    autoSubmitted: false,
    alreadySubmitted: false,
    error: '',
  });
  const [timeLocked, setTimeLocked] = useState(false);
  const [closingSession, setClosingSession] = useState(false);
  const panelRef = useRef(null);
  const logBoxRef = useRef(null);
  const dirtyFileIdsRef = useRef(new Set());
  const fileHydrationRequestRef = useRef(0);

  // Per-question memory of which files were open (the question's own
  // defaults plus anything the student opened/created beyond them) so that
  // switching to another question and back restores the exact working set
  // instead of resetting to just the default files. Keyed by question id.
  const questionFileMemoryRef = useRef({});
  const lastHydratedQuestionIdRef = useRef(null);
  // Mirrors of `files`/`activeFileId` for use inside the hydration effect
  // below, which intentionally does NOT depend on `files` itself (that
  // would re-run it — and wipe the open tabs — on every keystroke).
  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);
  const activeFileIdRef = useRef(activeFileId);
  useEffect(() => { activeFileIdRef.current = activeFileId; }, [activeFileId]);
  const lastLoadedModuleIdRef = useRef(null);
  const autoSubmitStartedRef = useRef(false);
  const closeSentRef = useRef(false);
  // const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    async function loadAuth() {
      try {
        const meRes = await axios.get(`${API_BASE}/api/auth/me`, { params: { role: 'student' } });
        if (meRes.data.user.role !== 'student') {
          navigate('/login');
          return;
        }
        window.__authUser = meRes.data.user;
        if (requestedSessionId) {
          window.__labSessionId = requestedSessionId;
        } else {
          // Ensure /api/sessions/init is only called once even if this
          // component mounts multiple times or other parts of the app
          // try to initialize concurrently. Use a global promise slot.
          if (!window.__labSessionInitPromise) {
            window.__labSessionInitPromise = axios.post(`${API_BASE}/api/sessions/init`, {
              mode: forceFreeCoding ? 'free' : 'lab',
            }).then((res) => {
              window.__labSessionId = res.data.sessionId;
              return res;
            }).catch((err) => {
              // Reset promise on failure so callers can retry
              window.__labSessionInitPromise = null;
              throw err;
            });
          }

          await window.__labSessionInitPromise;
        }
        setAuthReady(true);
      } catch {
        navigate('/login');
      }
    }
    loadAuth();
  }, [navigate, forceFreeCoding, requestedSessionId]);

  useEffect(() => {
    console.log(currentWorkingDir);
  }, [currentWorkingDir]);

  // Load questions from the assigned module
  const [questions, setQuestions] = useState([]);
  const [moduleInfo, setModuleInfo] = useState(null);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [moduleError, setModuleError] = useState(null);
  
  useEffect(() => {
    const fetchModuleData = async () => {
      setLoadingQuestions(true);
      setModuleError(null);
      
      try {
        // Ask the server which module is assigned to THIS session, rather
        // than relying on localStorage (which only exists on whichever
        // browser the teacher happened to click "Send to Students" from).
        const sessionId = getCurrentLabSession();

        let moduleData = null;
        if (!forceFreeCoding) {
          try {
            const currentModuleRes = await axios.get(
              `${API_BASE}/api/sessions/${sessionId}/current-module`,
              { params: { moduleId: requestedModuleId || undefined } }
            );
            moduleData = currentModuleRes.data;
          } catch (moduleLookupErr) {
            // 404 just means "no module assigned to this session yet" —
            // expected before a teacher has sent one.
            if (moduleLookupErr.response?.status !== 404) throw moduleLookupErr;
          }
        }

        if (moduleData) {
          console.log('Loaded active module from server:', moduleData._id);

          // A new module must never inherit tabs from the previous module.
          // Reset the selected question as modules can have different counts.
          if (lastLoadedModuleIdRef.current !== moduleData._id) {
            questionFileMemoryRef.current = {};
            lastHydratedQuestionIdRef.current = null;
            setActiveQuestionIdx(0);
          }

          // Set module info
          setModuleInfo({
            _id: moduleData._id,
            name: moduleData.name,
            description: moduleData.description,
            maxMarks: moduleData.maxMarks,
            time: getSessionLabel(
              moduleData.assignment?.startTime || moduleData.startTime,
              moduleData.assignment?.endTime || moduleData.endTime,
              moduleData.assignment?.slotKey
            ),
            date: moduleData.date,
            startTime: moduleData.assignment?.startTime || moduleData.startTime || '',
            endTime: moduleData.assignment?.endTime || moduleData.endTime || '',
            slotKey: moduleData.assignment?.slotKey || '',
            startsAt: moduleData.assignment?.startsAt || null,
            endsAt: moduleData.assignment?.endsAt || null,
            targetBatch: moduleData.assignment?.targetBatch || moduleData.targetBatch || '',
          });

          // Fetch questions for this module if not already included
          let questionsData = moduleData.questions;

          // If questions are just IDs, fetch the full question data
          if (moduleData.questions.length > 0 && typeof moduleData.questions[0] === 'string') {
            const questionsResponse = await axios.get(`${API_BASE}/api/modules/${moduleData._id}/questions`);
            questionsData = questionsResponse.data;
          }

          // Format questions for the question pane
          const formattedQuestions = questionsData.map(q => ({
            id: q._id,
            title: q.title,
            description: q.description,
            questionKey: q.questionKey || 'q1',
            files: q.files || [],
            testcases: q.testcases || {},
            input: q.input || '',
            evalScript: q.evalScript || '',
            maxMarks: q.maxMarks,
            availableAt: q.availableAt || moduleData.startTime || '09:00',
            availableAtDate: q.availableAtDate || null,
            moduleDate: moduleData.date,
            isAvailable: q.isAvailable !== false,
          }));

          setQuestions(formattedQuestions);
          lastLoadedModuleIdRef.current = moduleData._id;
          startOrRefreshAttempt(moduleData._id).catch((err) => {
            console.error('Failed to start/refresh test attempt:', err);
            setModuleError(err.response?.data?.error || 'Could not start your test timer.');
          });
        } else {
          // No module currently assigned (teacher hasn't sent one, or
          // explicitly cleared it) — give students an open editor instead
          // of canned demo content.
          console.log('No module assigned to this session, enabling free-coding mode');
          setModuleInfo({
            _id: "free_coding",
            name: "Free Coding",
            description: "No lab module has been assigned right now. Feel free to write and run any C program you'd like using the editor below.",
            maxMarks: null,
            time: null,
            date: new Date().toISOString()
          });
          setAttemptInfo(null);
          if (lastLoadedModuleIdRef.current !== 'free_coding') {
            questionFileMemoryRef.current = {};
            lastHydratedQuestionIdRef.current = null;
            setActiveQuestionIdx(0);
          }
          lastLoadedModuleIdRef.current = 'free_coding';

          setQuestions([buildFreeCodingQuestion()]);
        }
      } catch (error) {
        console.error('Error loading module data:', error);
        setModuleError(error.response?.data?.error || error.message || 'Failed to load questions');
        
        // Something actually went wrong (not just "no module assigned") —
        // still don't leave the student with a broken editor.
        setModuleInfo({
          _id: "free_coding",
          name: "Free Coding",
          description: "Couldn't reach the lab server just now. Feel free to write and run any C program you'd like using the editor below.",
          maxMarks: null,
          time: null,
          date: new Date().toISOString()
        });
        setAttemptInfo(null);
        if (lastLoadedModuleIdRef.current !== 'free_coding') {
          questionFileMemoryRef.current = {};
          lastHydratedQuestionIdRef.current = null;
          setActiveQuestionIdx(0);
        }
        lastLoadedModuleIdRef.current = 'free_coding';
        setQuestions([buildFreeCodingQuestion()]);
      } finally {
        setLoadingQuestions(false);
      }
    };
    
    if (authReady) fetchModuleData();
    
    // Set up event listener for module changes
    const handleModuleChange = () => {
      if (forceFreeCoding) return;
      console.log('Module change detected, refreshing...');
      fetchModuleData();
      
      // Show notification to user
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Module Updated", {
          body: "The teacher has updated the module. Loading new content...",
        });
      }
    };
    
    window.addEventListener('module-change', handleModuleChange);
    
    // Check for module changes periodically by asking the server, rather
    // than watching a localStorage value that only exists on the teacher's
    // own browser.
    const checkModuleInterval = setInterval(async () => {
      if (forceFreeCoding) return;
      try {
        const sessionId = getCurrentLabSession();
        const res = await axios.get(`${API_BASE}/api/sessions/${sessionId}/current-module`, {
          params: { moduleId: requestedModuleId || undefined },
        });
        const activeModuleId = res.data?._id;
        if (activeModuleId && activeModuleId !== lastLoadedModuleIdRef.current) {
          console.log('New module detected on server:', activeModuleId);
          handleModuleChange();
        }
      } catch (err) {
        // 404 just means no module assigned yet — try again next tick.
      }
    }, 5000);
    
    return () => {
      window.removeEventListener('module-change', handleModuleChange);
      clearInterval(checkModuleInterval);
    };
  }, [authReady, forceFreeCoding, requestedModuleId]);

  const getBoilerplateForLanguage = (precode, targetLanguage = 'c') => {
    if (typeof precode === 'string') {
      return targetLanguage === 'c' ? precode : '';
    }
    if (!precode || typeof precode !== 'object') {
      return '';
    }

    if (precode[targetLanguage]) {
      return precode[targetLanguage];
    }

    if (targetLanguage === 'java') {
      return precode.java || precode.c || '';
    }

    return precode.c || precode.java || '';
  };

  const findQuestionFileForDescriptor = (question, descriptor) => {
    if (!question?.files?.length || !descriptor) return null;

    const descriptorName = String(descriptor.name || '');
    const descriptorBase = descriptorName.replace(/\.(c|java)$/i, '');
    const descriptorTag = descriptor.tag;

    return question.files.find((candidate) => {
      const candidateName = String(candidate.name || '');
      const candidateBase = candidateName.replace(/\.(c|java)$/i, '');
      return (
        (descriptorTag && candidate.tag === descriptorTag) ||
        candidateName === descriptorName ||
        candidateBase === descriptorBase
      );
    });
  };

  const buildFreeCodingQuestion = () => {
    const cStarter = `#include <stdio.h>\n\nint main() {\n    // Write your code here\n    return 0;\n}\n`;
    const javaStarter = `public class Main {\n    public static void main(String[] args) {\n        // Write your code here\n    }\n}\n`;

    return {
      id: 'free_coding',
      title: 'Free Coding',
      description: 'No lab module has been assigned right now. Write, run, and experiment with any C or Java program you’d like — nothing here is graded.',
      questionKey: 'free',
      files: [
        { name: 'Main.c', tag: 'main', precode: { c: cStarter, java: javaStarter } }
      ],
      testcases: {},
      input: '',
      evalScript: '',
      maxMarks: null,
    };
  };

  useEffect(() => {
    if (!moduleInfo?._id || moduleInfo._id === 'free_coding') return undefined;

    const interval = setInterval(() => {
      startOrRefreshAttempt(moduleInfo._id).catch((err) => {
        console.error('Failed to refresh test attempt:', err);
      });
    }, 15000);

    return () => clearInterval(interval);
  }, [moduleInfo?._id]);


  function getTagsFromQuestion(question) {
    if (!question?.files?.length) return [];
    return question.files.map(f => f.tag).filter(Boolean);
  }
  const tags = useMemo(() => {
  if (
    !Array.isArray(questions) ||
    questions.length === 0 ||
    !questions[activeQuestionIdx]
  ) return [];

  return getTagsFromQuestion(questions[activeQuestionIdx]);
}, [questions, activeQuestionIdx]);

  const getTagAssignmentError = (currentTags = tags, currentMap = tagToFileMap, currentFiles = files) => {
    if (!currentTags.length) {
      return 'This question has no tags configured. Please ask the teacher to set file tags before submitting.';
    }

    const missingTags = currentTags.filter((tag) => !currentMap[tag]);
    if (missingTags.length) {
      return `Please specify files for: ${missingTags.join(', ')}.`;
    }

    const openPaths = new Set(currentFiles.map((file) => file.path));
    const staleTags = currentTags.filter((tag) => !openPaths.has(currentMap[tag]));
    if (staleTags.length) {
      return `The selected file for ${staleTags.join(', ')} is no longer open. Please specify tags again.`;
    }

    return '';
  };


  // NOTE: this component used to also fetch a static /codeFiles.json demo
  // file here and dump it straight into `files` on every mount. That was
  // leftover scaffolding from early development, fully superseded by the
  // real per-question hydration effect below — and since both ran
  // concurrently on mount, whichever one finished second "won", so on some
  // loads the unrelated demo server.c/client.c content would flash into the
  // editor for a moment before the real question's files replaced it.
  // Removed entirely; nothing else in this file depends on it.


  useEffect(() => {
    const onEval = (e) => {
      const { results, questionId } = e.detail || {};
      if (!questionId || !results) return;

      setTestCaseResults(prev => ({
        ...prev,
        [questionId]: results,
      }));
    };

    window.addEventListener('evaluation-complete', onEval);
    return () => window.removeEventListener('evaluation-complete', onEval);
  }, []);


  useEffect(() => {
    if (questions?.length > 0 && questions[activeQuestionIdx]) {
      const activeQuestion = questions[activeQuestionIdx];
      const requestId = fileHydrationRequestRef.current + 1;
      fileHydrationRequestRef.current = requestId;

      // Snapshot whatever was open for the question we're navigating away
      // from — the default files AND any extra ones the student opened via
      // "New File"/"Open" — so coming back later restores that exact set
      // instead of resetting to just the question's defaults.
      const previousQuestionId = lastHydratedQuestionIdRef.current;
      if (previousQuestionId && filesRef.current.length) {
        const activeFile = filesRef.current.find(f => f.id === activeFileIdRef.current);
        questionFileMemoryRef.current[previousQuestionId] = {
          descriptors: filesRef.current.map(f => ({
            // Include the current editor content, not just file metadata.
            // An autosave can still be pending when a student clicks another
            // question, so re-reading only from disk could otherwise reopen
            // the tab with stale/empty content.
            id: f.id, name: f.name, tag: f.tag, path: f.path,
            language: f.language, code: f.code,
            starterCodeByLanguage: f.starterCodeByLanguage,
          })),
          activeFileName: activeFile?.name ?? null,
        };
      }

      const remembered = questionFileMemoryRef.current[activeQuestion.id];
      const rememberedDescriptors = remembered?.descriptors || [];
      // If the teacher added a new default file to this question after the
      // student's last visit, make sure it still shows up alongside
      // whatever was remembered, instead of being silently missed.
      const rememberedTags = new Set(rememberedDescriptors.map(d => d.tag).filter(Boolean));
      const newDefaultsSinceLastVisit = (activeQuestion.files || [])
        .filter(qf => qf.tag && !rememberedTags.has(qf.tag))
        .map(qf => ({ name: qf.name, tag: qf.tag }));

      const baseDescriptors = remembered
        ? [...rememberedDescriptors, ...newDefaultsSinceLastVisit]
        : (activeQuestion.files || []).map(f => ({ name: f.name, tag: f.tag }));

      const loadFilesForQuestion = async () => {
        const filesFromQuestion = await Promise.all(baseDescriptors.map(async (f) => {
        // Files remembered from an earlier hydration already carry a
        // resolved language and a name with its extension baked in. A file
        // straight from the question definition doesn't (teachers now only
        // give a base name, e.g. "server") — default those to C, matching
        // the workspace's overall default language.
        let lang = f.language;
        if (!lang) {
          lang = f.name?.endsWith('.java') ? 'java' : f.name?.endsWith('.c') ? 'c' : 'c';
        }

        const hasExtension = /\.(c|java)$/i.test(f.name || '');
        const effectiveName = hasExtension ? f.name : `${f.name}.${lang}`;
        const dir = f.path ? f.path.split('/').slice(0, -1).join('/') : LABUSER_HOME;
        const filePath = f.path || `${LABUSER_HOME}/${effectiveName}`;

        const questionFile = findQuestionFileForDescriptor(activeQuestion, f);
        const precode = questionFile?.precode;
        let code = f.code ?? getBoilerplateForLanguage(precode, lang);
        const starterCodeByLanguage = f.starterCodeByLanguage || {
          c: getBoilerplateForLanguage(precode, 'c'),
          java: getBoilerplateForLanguage(precode, 'java'),
        };

        // A remembered file already has the in-memory editor content above.
        // Only fresh/default files need disk hydration.
        if (f.code === undefined) {
          try {
            const response = await axios.get(`${API_BASE}/api/file/read-file`, {
              params: {
                cwd: dir,
                filename: effectiveName,
                sessionId: getCurrentLabSession(),
              },
            });
            if (response.data?.exists) {
              code = response.data.code ?? code;
            }
          } catch {
            // Network/server error — fall back to starter code.
          }
        }

        return {
          id: f.id || f.tag || effectiveName.replace(/\.[^/.]+$/, ''),
          name: effectiveName,
          tag: f.tag,
          path: filePath,
          language: lang,
          code,
          starterCodeByLanguage,
        };
      }));

      if (fileHydrationRequestRef.current !== requestId) return;

      setFiles(filesFromQuestion);
      dirtyFileIdsRef.current = new Set();

      const restoredActiveFile = remembered?.activeFileName
        ? filesFromQuestion.find(f => f.name === remembered.activeFileName)
        : null;
      const nextActiveId = restoredActiveFile?.id ?? filesFromQuestion[0]?.id;
      if (nextActiveId) {
        setActiveFileId(nextActiveId);
      }

      const autoMap = {};
      filesFromQuestion.forEach(f => {
        if (f.tag) autoMap[f.tag] = f.path;
      });
      setTagToFileMap(autoMap);

      lastHydratedQuestionIdRef.current = activeQuestion.id;
      };

      loadFilesForQuestion();
    }
  }, [questions, activeQuestionIdx]);


  // Handle file operations
  const updateCode = (newCode) => {
    if (activeFileId) {
      dirtyFileIdsRef.current.add(activeFileId);
    }
    setFiles(prevFiles => 
      prevFiles.map(f => 
        f.id === activeFileId ? {...f, code: newCode} : f
      )
    );
  };


  //track changes and auto-save
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const activeFile = files.find(f => f.id === activeFileId);
      if (activeFile && activeFile.code?.trim() && dirtyFileIdsRef.current.has(activeFile.id)) {
        saveFile(activeFile).then(() => {
          dirtyFileIdsRef.current.delete(activeFile.id);
        });
      }
    }, 1000); // Debounce: wait 1 second after user stops typing

    return () => clearTimeout(timeoutId);
  }, [files, activeFileId]);


  const addNewFile = () => {
    if (timeLocked || !newFileCreated){
      return;
    }

    setNewFileCreated(false);

    try{
      const fileName = `${language === 'java' ? 'Main' : 'new_file'}_${fileNo}.${language === 'java' ? 'java' : 'c'}`;
      
      const confirmCreate = window.confirm(
        `📁 This new file will be created in:\n\n  ${currentWorkingDir}\n\nFilename: ${fileName}\n\nIf you'd like to save it elsewhere, please change the directory in your terminal first.\n\nContinue?`
      );

      if (!confirmCreate) return;
      setFileNo(prev => prev + 1);

      const timestamp = Date.now();
      const newId = `file_${timestamp}`;
      const className = fileName.replace(/\.java$/, '');
      const template = language === 'java'
        ? `// New Java File\n// Author: ${getCurrentUser()}\n// Created: ${getCurrentDateTime()} UTC\n\npublic class ${className} {\n    public static void main(String[] args) {\n        // Write your code here\n    }\n}\n`
        : `// New C File\n// Author: ${getCurrentUser()}\n// Created: ${getCurrentDateTime()} UTC\n\n#include <stdio.h>\n\nint main() {\n    // Write your code here\n    return 0;\n}\n`;

      setFiles(prevFiles => [
        ...prevFiles, 
        {
          id: newId,
          name: fileName,
          path: `${currentWorkingDir}/${fileName}`,
          code: template,
          language
        }
      ]);
      dirtyFileIdsRef.current.add(newId);
      setActiveFileId(newId);
    } catch(err){
      console.error("Error creating new file:", err);
      alert("Failed to create new file.");
    } finally {
      setTimeout(() => {
        setNewFileCreated(true);
      }, 1000);
    }
  };


  const openFile = async () => {
    if (timeLocked) return;
    try {
      const response = await axios.get(`${API_BASE}/api/file/list-files`, {
        params: { cwd: currentWorkingDir, sessionId: getCurrentLabSession() }
      });
      setAvailableFiles(response.data.files);
      setShowFileModal(true); // show modal
    } catch (err) {
      console.error("Failed to open file:", err);
      alert("Could not load file list.");
    }
  };


  const handleFileSelect = async (selected) => {
    setShowFileModal(false);
    if (!selected) return;

    const alreadyOpen = files.some(f => f.name === selected && f.path === `${currentWorkingDir}/${selected}`);
    if (alreadyOpen) {
      alert(`⚠️ File "${selected}" is already open in the editor.\n\nPlease choose a different file.`);
      return;
    }

    try {
      const res = await axios.get(`${API_BASE}/api/file/read-file`, {
        params: { filename: selected, cwd: currentWorkingDir, sessionId: getCurrentLabSession() }
      });

      if (!res.data?.exists) {
        alert(`File "${selected}" could not be found.`);
        return;
      }

      const code = res.data.code;
      const newId = `file_${Date.now()}`;
      setFiles(prev => [
        ...prev,
        {
          id: newId,
          name: selected,
          path: `${currentWorkingDir}/${selected}`,
          code,
          language: selected.endsWith('.java') ? 'java' : 'c'
        }
      ]);
      setActiveFileId(newId);
    } catch (err) {
      console.error("Error loading file content:", err);
      alert("Failed to load file content.");
    }
  };


  const handleCloseFile = (fileId) => {
    setFiles(prevFiles => prevFiles.filter(f => f.id !== fileId));
    // set a new active file if the closed one was active
    if (activeFileId === fileId && files.length > 1) {
      const idx = files.findIndex(f => f.id === fileId);
      const nextFile = files[idx + 1] || files[idx - 1];
      setActiveFileId(nextFile?.id || null);
    }
  };  // Handle execution


  // Handle execution
  const handleRun = () => {
    if (timeLocked) return;
    if (activeQuestionLocked) {
      alert(`This question is not available yet. It opens at ${questions[activeQuestionIdx]?.availableAt || 'the scheduled time'}.`);
      return;
    }
    setIsRunning(true);
    setShowTerminal(true);
    setActiveTab('terminal');
    const activeFile = files.find(f => f.id === activeFileId);
    if (!activeFile) {
      window.dispatchEvent(new CustomEvent('terminal-error', { detail: "No file selected" }));
      setIsRunning(false);
      return;
    }
    // If we're in a subdirectory, update the file's path to include the current directory
    const fullPath = currentWorkingDir 
      ? `${currentWorkingDir}/${activeFile.name}` 
      : activeFile.path;
    
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-run-terminal', {
        detail: {
          code: activeFile.code,
          filename: activeFile.name,
          filePath: fullPath,
          language: activeFile.language || language,
          sessionId: getCurrentLabSession(),
        }
      }));
      setIsRunning(false);
    }, 100);
  };


  const saveFile = async (file) => {
    if (timeLocked) return;
    if (!file) return;
    try {
      setSaveStatus('saving');
      const payload = {
        filename: file.name,
        filePath: file.path,
        code: file.code,
        sessionId: getCurrentLabSession(),
      };

      await fetch(`${API_BASE}/api/save-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000); // Reset to idle after 2 seconds
    } catch (err) {
      console.error(`[AutoSave] Failed to save ${file.path}:`, err);
      setSaveStatus('idle');
    }
  };

  const saveActiveFile = async () => {
    if (timeLocked) return;
    const file = files.find(f => f.id === activeFileId);
    if (!file) return;
    await saveFile(file);
    dirtyFileIdsRef.current.delete(file.id);
  };

  const appendEvaluationLog = (line) => {
    const text = line.endsWith('\n') ? line : `${line}\n`;
    setEvaluationOverlay((prev) => ({
      ...prev,
      logs: [...prev.logs, text],
    }));
  };

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [evaluationOverlay.logs]);

  const runEvaluationWithLogs = async ({ endpoint, payload, title }) => {
    setEvaluationOverlay({
      open: true,
      title,
      running: true,
      logs: [`${title} started...`],
    });

    const response = await fetch(`${API_BASE}/api/evaluation/${endpoint}?stream=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => '');
      throw new Error(body || `Evaluation failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.event === 'log') {
          appendEvaluationLog(event.message || '');
        } else if (event.event === 'done') {
          finalResult = event.result;
          appendEvaluationLog('Evaluation finished.');
        } else if (event.event === 'error') {
          throw new Error(event.error || 'Evaluation failed.');
        }
      }
    }

    setEvaluationOverlay((prev) => ({ ...prev, running: false }));
    return finalResult || {};
  };

  const startOrRefreshAttempt = async (moduleId) => {
    if (!moduleId || moduleId === 'free_coding') return null;

    let res;
    try {
      res = await axios.post(`${API_BASE}/api/sessions/test-attempts/start`, {
        moduleId,
        sessionId: getCurrentLabSession(),
        slotKey: moduleInfo?.slotKey || undefined,
      });
    } catch (err) {
      if (err.response?.status === 410) {
        const message = err.response?.data?.error || 'Your test time is over.';
        setAttemptInfo((prev) => ({ ...prev, remainingSeconds: 0 }));
        setModuleError(message);
        setTimeLocked(true);
        setTimeUpDialog({
          open: true,
          submitting: false,
          autoSubmitted: false,
          alreadySubmitted: false,
          error: '',
        });
      } else if (err.response?.status === 403) {
        setModuleError(err.response?.data?.error || 'This lab session is not open yet.');
      }
      throw err;
    }

    setAttemptInfo(res.data);
    return res.data;
  };

  useEffect(() => {
    const handleSaveShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        if (timeLocked) return;
        saveActiveFile();
      }
    };

    window.addEventListener('keydown', handleSaveShortcut, true);
    return () => window.removeEventListener('keydown', handleSaveShortcut, true);
  }, [files, activeFileId, timeLocked]);

  useEffect(() => {
    if (!timeLocked) return undefined;
    const blockKeys = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', blockKeys, true);
    return () => window.removeEventListener('keydown', blockKeys, true);
  }, [timeLocked]);

  useEffect(() => {
    if (!evaluationOverlay.running) return;

    const blockKeys = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', blockKeys, true);
    return () => window.removeEventListener('keydown', blockKeys, true);
  }, [evaluationOverlay.running]);

  // Checks whether `filename` already exists in `dir` inside the student's
  // container. Returns its content if so, otherwise null. Used before any
  // rename/language-switch that could otherwise clobber a pre-existing file
  // via the backend's `mv oldPath newPath`, which overwrites silently.
  const fetchExistingFileIfPresent = async (dir, filename) => {
    try {
      const res = await axios.get(`${API_BASE}/api/file/read-file`, {
        params: { cwd: dir, filename, sessionId: getCurrentLabSession() },
      });
      if (!res.data?.exists) return null;
      return typeof res.data.code === 'string' ? res.data.code : '';
    } catch {
      return null; // 404 or any other failure => no conflicting file
    }
  };

  // If `newName` already exists in `dir`, walks the student through a two-step
  // confirmation before allowing the rename/language-switch to proceed —
  // since the backend does a plain `mv oldPath newPath`, which silently
  // overwrites whatever's already at newPath. Step 1 lets them back out to
  // pick a different name instead; step 2 is a final "this permanently
  // deletes the old contents" check, since this is a destructive, unrecoverable
  // action. Returns true only if it's safe to proceed (no conflict, or the
  // student explicitly confirmed the overwrite twice).
  const confirmOverwriteIfNeeded = async (dir, newName, currentFileName) => {
    const existingCode = await fetchExistingFileIfPresent(dir, newName);
    if (existingCode === null) return true; // no conflict

    const wantsToOverwrite = window.confirm(
      `"${newName}" already exists in ${dir || currentWorkingDir}.\n\n` +
      `Choose OK to overwrite "${newName}" with the contents of "${currentFileName}", ` +
      `or Cancel to pick a different name instead.`
    );
    if (!wantsToOverwrite) return false;

    return window.confirm(
      `This will permanently replace the contents of "${newName}" with "${currentFileName}". ` +
      `This cannot be undone.\n\nOverwrite "${newName}"?`
    );
  };

  //handle rename and code language change
  const renameFile = async (fileId, newName) => {
    if (timeLocked) return;
    const extension = newName.split('.').pop().toLowerCase();

    let detectedLanguage = 'plaintext';
    if (extension === 'java') detectedLanguage = 'java';
    else if (extension === 'c') detectedLanguage = 'c';

    const file = files.find(f => f.id === fileId);
    if (!file) return;

    const oldPath = file.path;
    const dir = file.path ? file.path.split('/').slice(0, -1).join('/') : currentWorkingDir;
    const newPath = file.path
      ? file.path.split('/').slice(0, -1).concat(newName).join('/')
      : newName;

    if (newPath === oldPath) return;

    // A file with this exact name may already exist in the container. The
    // backend's rename is a plain `mv`, which would silently overwrite it —
    // so walk the student through confirming that's actually what they want.
    const canProceed = await confirmOverwriteIfNeeded(dir, newName, file.name);
    if (!canProceed) return;

    setFiles(prevFiles =>
      prevFiles.map(f =>
        f.id === fileId
          ? { ...f, name: newName, path: newPath, language: detectedLanguage }
          : f
      )
    );
    setTagToFileMap((prev) => {
      const next = { ...prev };
      if (file.tag) next[file.tag] = newPath;
      for (const [tag, mappedPath] of Object.entries(next)) {
        if (mappedPath === oldPath) next[tag] = newPath;
      }
      return next;
    });

    setLanguage(detectedLanguage);

    try {
      await fetch(`${API_BASE}/api/rename-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldPath,
          newPath,
          sessionId: getCurrentLabSession(),
        }),
        credentials: 'include',
      });
    } catch (err) {
      console.error('Failed to rename file in container:', err);
    }
  };


  const getFileBoilerplate = (file, targetLanguage = file?.language) => {
    const questionFile = findQuestionFileForDescriptor(questions[activeQuestionIdx], file);
    const precode = questionFile?.precode;
    return getBoilerplateForLanguage(precode, targetLanguage) || file?.starterCodeByLanguage?.[targetLanguage] || '';
  };

  const updateFileLanguage = async (fileId, newLang) => {
    if (timeLocked) return;
    const file = files.find(f => f.id === fileId);
    if (!file || file.language === newLang) return;

    // Language selection is deliberately NOT a file rename. Renaming moves
    // C source into a .java file (or vice versa), which is both misleading
    // and destructive after a student has started work. Instead, C and Java
    // keep independent files/drafts with the same base name.
    const newExt = newLang === 'java' ? 'java' : 'c';
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const newName = `${baseName}.${newExt}`;
    const dir = file.path ? file.path.split('/').slice(0, -1).join('/') : currentWorkingDir;
    const newPath = file.path
      ? file.path.split('/').slice(0, -1).concat(newName).join('/')
      : newName;

    // Persist the source-language draft before loading the target language.
    // This makes C → Java → C restore the student's C edits exactly.
    await saveFile(file);

    const existingTargetCode = await fetchExistingFileIfPresent(dir, newName);
    const nextCode = existingTargetCode ?? getFileBoilerplate(file, newLang);
    const nextFile = {
      ...file,
      language: newLang,
      name: newName,
      path: newPath,
      code: nextCode,
      starterCodeByLanguage: {
        ...(file.starterCodeByLanguage || {}),
        c: getFileBoilerplate(file, 'c'),
        java: getFileBoilerplate(file, 'java'),
      },
    };

    setFiles(prevFiles =>
      prevFiles.map(f =>
        f.id === fileId
          ? nextFile
          : f
      )
    );
    setTagToFileMap((prev) => {
      const next = { ...prev };
      if (file.tag) next[file.tag] = newPath;
      return next;
    });
    setLanguage(newLang);

    // Create/update the target-language file immediately, so its boilerplate
    // is durable even if the student switches back before autosave fires.
    await saveFile(nextFile);
  };

  const resetFileToBoilerplate = async (fileId) => {
    if (timeLocked) return;
    const file = files.find((candidate) => candidate.id === fileId);
    const boilerplate = getFileBoilerplate(file);
    if (!file || typeof boilerplate !== 'string') {
      alert('No boilerplate is available for this file and language.');
      return;
    }
    if (!window.confirm(`Reset ${file.name} to the teacher-provided ${file.language === 'java' ? 'Java' : 'C'} boilerplate? Your current ${file.language} code will be replaced.`)) return;

    const resetFile = { ...file, code: boilerplate };
    setFiles((previous) => previous.map((candidate) => candidate.id === fileId ? resetFile : candidate));
    dirtyFileIdsRef.current.delete(fileId);
    await saveFile(resetFile);
  };

  const activeFile = files.find(f => f.id === activeFileId) || files[0];
  const isFreeCoding = moduleInfo?._id === 'free_coding';

  const handleEvaluate = async () => {
    if (timeLocked) return;
    if (activeQuestionLocked) {
      alert(`This question is not available yet. It opens at ${questions[activeQuestionIdx]?.availableAt || 'the scheduled time'}.`);
      return;
    }
    const currentQuestion = questions[activeQuestionIdx];
    if (!currentQuestion) return;

    const tagError = getTagAssignmentError();
    if (tagError) {
      alert(tagError);
      return;
    }

    setIsEvaluating(true);

    try {
      const requiredPaths = Object.values(tagToFileMap);
      const filteredFiles = files.filter(f => requiredPaths.includes(f.path));

      for (const file of filteredFiles) {
        await axios.post(`${API_BASE}/api/save-file`, {
          filename: file.name,
          filePath: file.path,
          code: file.code,
          sessionId: getCurrentLabSession(),
        });
      }

      const tagPaths = { ...tagToFileMap };
      const sourceFiles = Object.fromEntries(filteredFiles.map(f => [f.name, f.code]));

      const response = await runEvaluationWithLogs({
        endpoint: 'run',
        title: `Evaluating ${currentQuestion.questionKey || currentQuestion.title}`,
        payload: {
        sessionId: getCurrentLabSession(),
        moduleId: moduleInfo?._id,
        questionId: currentQuestion.id,
        tagPaths,
        sourceFiles,
        },
      });

      const results = response?.results ?? [];
      setTestCaseResults((prev) => ({
        ...prev,
        [currentQuestion.id]: results,
      }));
      setEvalMessage(null);
      setQuestionPaneTab('testcases');
      setShowQuestion(true);

      const { total } = summarizeResults(results);
      if (total === 0) {
        const hint = response?.stderr?.trim() || 'Evaluation finished but no test results were produced. Check that your code compiles.';
        setEvalMessage(hint);
      }

      window.dispatchEvent(new CustomEvent('evaluation-complete', {
        detail: { results, questionId: currentQuestion.id },
      }));
    } catch (error) {
      console.error('Evaluation failed:', error);
      setEvaluationOverlay((prev) => ({
        ...prev,
        running: false,
        logs: [...prev.logs, error.message || 'Evaluation failed.'],
      }));
      alert(error.response?.data?.error || 'Evaluation failed');
    } finally {
      setIsEvaluating(false);
    }
  };


  // Handle stopping all processes
  const handleStopAll = () => {
    if (timeLocked) return;
    setShowTerminal(true);
    window.dispatchEvent(new CustomEvent('stop-all-processes'));
  };

  const handleExitWorkspace = async ({ confirmExit = true } = {}) => {
    if (closingSession) return;
    if (confirmExit && !window.confirm('Exit this lab now? Your current container will be stopped.')) {
      return;
    }

    try {
      setClosingSession(true);
      // Instruct terminals to stop and avoid reconnecting
      window.dispatchEvent(new CustomEvent('close-session'));
      window.dispatchEvent(new CustomEvent('stop-all-processes'));
      const sessionId = getCurrentLabSession();
      if (sessionId) {
        closeSentRef.current = true;
        const closeRes = await axios.post(`${API_BASE}/api/sessions/close`, { sessionId });
        console.log('Closed lab session:', closeRes.data);
        if (closeRes.data?.stopped === false) {
          alert(`Lab container was not stopped: ${closeRes.data.reason || 'unknown reason'}`);
        }
      }
      navigate('/student-dashboard');
    } catch (err) {
      console.error('Failed to close lab session:', err);
      alert(err.response?.data?.error || 'Failed to stop the lab container. Please try Exit Lab again.');
      setClosingSession(false);
    }
  };

  useEffect(() => {
    if (!authReady) return undefined;

    const closeOnLeave = () => {
      const sessionId = getCurrentLabSession();
      if (!sessionId || closeSentRef.current) return;
      closeSentRef.current = true;
      // Ensure terminal clients don't reconnect while we're closing server-side
      try { window.dispatchEvent(new CustomEvent('close-session')); } catch (_) {}
      window.dispatchEvent(new CustomEvent('stop-all-processes'));

      const body = JSON.stringify({ sessionId });
      fetch(`${API_BASE}/api/sessions/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        credentials: 'include',
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener('pagehide', closeOnLeave);
    window.addEventListener('beforeunload', closeOnLeave);

    return () => {
      window.removeEventListener('pagehide', closeOnLeave);
      window.removeEventListener('beforeunload', closeOnLeave);
    };
  }, [authReady]);


  useEffect(() => {
    const activeQuestion = questions?.[activeQuestionIdx];
    if (!activeQuestion || activeQuestion.id === 'free_coding') return;
    if (checkedPassedQuestionIdsRef.current.has(activeQuestion.id)) return;
    checkedPassedQuestionIdsRef.current.add(activeQuestion.id);

    axios.get(`${API_BASE}/api/submission/fetch`, {
      params: { questionId: activeQuestion.id, sessionId: getCurrentLabSession() },
    }).then((res) => {
      const hasAcceptedSubmission = Array.isArray(res.data) && res.data.some(s => s.status === 'Accepted');
      if (hasAcceptedSubmission) {
        setPassedQuestionIds((prev) => (
          prev.has(activeQuestion.id) ? prev : new Set(prev).add(activeQuestion.id)
        ));
      }
    }).catch(() => {
      // Non-fatal — worst case the button just doesn't show "Re-submit" yet;
      // it'll self-correct the next time this question becomes active.
      checkedPassedQuestionIdsRef.current.delete(activeQuestion.id);
    });
  }, [questions, activeQuestionIdx]);

  // Re-check per-question unlock times as the lab progresses.
  useEffect(() => {
    if (!questions.length || moduleInfo?._id === 'free_coding') return undefined;
    const refreshAvailability = () => {
      setQuestions((prev) => prev.map((q) => ({
        ...q,
        isAvailable: isQuestionUnlocked(q),
      })));
    };
    refreshAvailability();
    const interval = setInterval(refreshAvailability, 15000);
    return () => clearInterval(interval);
  }, [moduleInfo?._id, questions.length]);

  const activeQuestionLocked = questions[activeQuestionIdx]
    ? !isQuestionUnlocked(questions[activeQuestionIdx])
    : false;

  const handleSubmit = async () => {
    if (timeLocked) return null;
    if (activeQuestionLocked) {
      alert(`This question is not available yet. It opens at ${questions[activeQuestionIdx]?.availableAt || 'the scheduled time'}.`);
      return null;
    }
    const activeQuestion = questions[activeQuestionIdx];
    if (activeQuestion && passedQuestionIds.has(activeQuestion.id)) {
      const proceed = window.confirm(
        "You've already passed all test cases for this question. Submit again anyway?"
      );
      if (!proceed) return null;
    }
    return submitQuestion(activeQuestion, { autoSubmitted: false, useActiveFiles: true });
  };

  const submitQuestion = async (question, { autoSubmitted = false, useActiveFiles = false } = {}) => {
    if (!question || question.id === 'free_coding') return null;

    // One key per submit attempt (not per HTTP retry) — lets the server
    // recognize a retried save as the same attempt instead of recording it
    // as a second submission if an earlier response got lost in transit.
    const clientRequestId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const expectedTags = useActiveFiles ? tags : getTagsFromQuestion(question);
    const tagError = useActiveFiles
      ? getTagAssignmentError(expectedTags, tagToFileMap, files)
      : expectedTags.length
        ? ''
        : 'This question has no tags configured. Please ask the teacher to set file tags before submitting.';
    if (tagError) {
      if (autoSubmitted) return null;
      alert(tagError);
      return;
    }

    setIsSubmitting(true);

    try {
      let effectiveTagMap = tagToFileMap;
      let filteredFiles = files.filter(f => Object.values(effectiveTagMap).includes(f.path));

      if (!useActiveFiles) {
        effectiveTagMap = {};
        filteredFiles = await Promise.all((question.files || []).map(async (f) => {
          const lang = f.name?.endsWith('.java') ? 'java' : 'c';
          const effectiveName = /\.(c|java)$/i.test(f.name || '') ? f.name : `${f.name}.${lang}`;
          const filePath = `${LABUSER_HOME}/${effectiveName}`;
          const precode = f.precode;
          let code = typeof precode === 'string' ? precode : (precode?.[lang] || precode?.c || '');
          try {
            const response = await axios.get(`${API_BASE}/api/file/read-file`, {
              params: { cwd: LABUSER_HOME, filename: effectiveName, sessionId: getCurrentLabSession() },
            });
            if (response.data?.exists) {
              code = response.data.code ?? code;
            }
          } catch {
            // Use starter code if no saved file exists for this question.
          }
          if (f.tag) effectiveTagMap[f.tag] = filePath;
          return {
            id: f.tag || effectiveName,
            name: effectiveName,
            path: filePath,
            language: lang,
            code,
          };
        }));
      }

      for (const file of filteredFiles) {
        await axios.post(`${API_BASE}/api/save-file`, {
          filename: file.name,
          filePath: file.path,
          code: file.code,
          sessionId: getCurrentLabSession(),
        });
      }

      const tagPaths = { ...effectiveTagMap };
      const sourceFiles = Object.fromEntries(filteredFiles.map(f => [f.name, f.code]));

      const evalRes = await runEvaluationWithLogs({
        endpoint: 'submit',
        title: autoSubmitted
          ? `Auto-submitting ${question.questionKey || question.title}`
          : `Submitting ${question.questionKey || question.title}`,
        payload: {
        sessionId: getCurrentLabSession(),
        moduleId: moduleInfo?._id,
        questionId: question.id,
        tagPaths,
        sourceFiles,
        },
      });

      if (evalRes?.results) {
        setTestCaseResults((prev) => ({
          ...prev,
          [question.id]: evalRes.results,
        }));
      }

      const results = evalRes?.results ?? [];
      const testcaseCount = Object.keys(question.testcases || {}).length;
      const { passed: passedFromResults } = summarizeResults(results);
      const correctCount = results.length > 0 ? passedFromResults : 0;
      const totalCount = results.length > 0 ? results.length : testcaseCount;

      const submitDbRes = await fetchWithRetry(`${API_BASE}/api/submission/db`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: question.id,
          sessionId: getCurrentLabSession(),
          moduleId: moduleInfo?._id,
          module: moduleInfo?.name || 'CN Lab',
          sourceCode: sourceFiles,
          language: filteredFiles[0]?.language || 'c',
          passedCount: correctCount,
          totalTestCases: totalCount,
          evaluationResults: results,
          evalError: results.length === 0 ? (evalRes?.stderr?.trim() || null) : null,
          autoSubmitted,
          clientRequestId,
        }),
        credentials: 'include',
      });

      if (!submitDbRes.ok) {
        const body = await submitDbRes.json().catch(() => ({}));
        throw new Error(body.error || `Failed to save submission (status ${submitDbRes.status})`);
      }

      const statusLabel = totalCount > 0 && correctCount === totalCount ? 'All test cases passed' : `${correctCount}/${totalCount} test cases passed`;
      if (totalCount > 0 && correctCount === totalCount) {
        setPassedQuestionIds((prev) => (
          prev.has(question.id) ? prev : new Set(prev).add(question.id)
        ));
      }
      setSubmissionRefreshTrigger((n) => n + 1);
      if (!autoSubmitted) alert(`Submitted successfully. ${statusLabel}`);
      return { questionId: question.id, statusLabel };
    } catch (err) {
      console.error('[Frontend] Submission error:', err);
      setEvaluationOverlay((prev) => ({
        ...prev,
        running: false,
        logs: [...prev.logs, err.message || 'Submission failed.'],
      }));
      if (!autoSubmitted) alert(err.response?.data?.error || 'Failed to submit.');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };


  const handleTimeUp = async () => {
    if (autoSubmitStartedRef.current || isFreeCoding || !moduleInfo?._id) return;
    autoSubmitStartedRef.current = true;
    setTimeLocked(true);
    setTimeUpDialog({
      open: true,
      submitting: false,
      autoSubmitted: false,
      alreadySubmitted: false,
      error: '',
    });

    try {
      const res = await axios.get(`${API_BASE}/api/submission/has-submission`, {
        params: {
          sessionId: getCurrentLabSession(),
          moduleId: moduleInfo._id,
        },
      });

      if (!res.data?.hasSubmission) {
        setTimeUpDialog({
          open: true,
          submitting: true,
          autoSubmitted: false,
          alreadySubmitted: false,
          error: '',
        });
        for (const q of questions) {
          await submitQuestion(q, {
            autoSubmitted: true,
            useActiveFiles: q.id === questions[activeQuestionIdx]?.id,
          });
        }
        setQuestionPaneTab('testcases');
        setShowQuestion(true);
        setTimeUpDialog({
          open: true,
          submitting: false,
          autoSubmitted: true,
          alreadySubmitted: false,
          error: '',
        });
      } else {
        setTimeUpDialog({
          open: true,
          submitting: false,
          autoSubmitted: false,
          alreadySubmitted: true,
          error: '',
        });
      }
    } catch (err) {
      setTimeUpDialog({
        open: true,
        submitting: false,
        autoSubmitted: false,
        alreadySubmitted: false,
        error: err.response?.data?.error || err.message || 'Auto-submit could not finish.',
      });
    }
  };


  const question = questions && questions.length > 0 ? questions[activeQuestionIdx] : undefined;
  const remainingSeconds = attemptInfo?.remainingSeconds ?? (
    moduleInfo?.endsAt
      ? Math.max(0, Math.floor((new Date(moduleInfo.endsAt).getTime() - Date.now()) / 1000))
      : 3600
  );
  const totalSeconds = attemptInfo?.totalSeconds ?? remainingSeconds;


  // Keep window.questions and window.activeQuestionIdx in sync for evaluation
  useEffect(() => {
    window.questions = questions;
    window.activeQuestionIdx = activeQuestionIdx;
  }, [questions, activeQuestionIdx]);


  //handle resize for terminal open and close
  useEffect(() => {
    if (!panelRef.current) return;
    if (showTerminal) {
      // Only force the default open size if the panel is still actually
      // collapsed (e.g. opened via the Run/Show Terminal button). If
      // showTerminal became true because the user is mid-drag (see
      // handleTerminalPanelResize below), the panel is already sized to
      // wherever their cursor is — forcing resize(45) here would yank it
      // to 45% out from under them mid-drag, then have it snap back as the
      // library kept tracking the real cursor position.
      if (panelRef.current.getSize() < 1) {
        panelRef.current.resize(45); // Show with size 45%
      }
    } else {
      panelRef.current.resize(0); // Collapse to 0%
    }
  }, [showTerminal]);

  // Dragging the resize handle directly (instead of using the Show/Hide
  // Terminal button) changes the panel's size but never touched showTerminal
  // — so the "x" close button, which only ever does setShowTerminal(false),
  // looked broken when the terminal was already false but visually dragged
  // open. This keeps the two in sync regardless of how the panel was resized.
  const handleTerminalPanelResize = useCallback((size) => {
    const isOpen = size > 1; // ignore floating-point noise around 0
    setShowTerminal((prev) => (prev === isOpen ? prev : isOpen));
  }, []);

  // One-time cleanup: earlier versions persisted the terminal panel's open/
  // closed size to localStorage (see PanelGroup below), which is what caused
  // this bug. Remove any leftover entry so it doesn't linger in the browser
  // storage on shared lab machines.
  useEffect(() => {
    try {
      window.localStorage.removeItem('react-resizable-panels:cnlab-vertical-panels');
    } catch (_) {
      // localStorage may be unavailable (e.g. disabled/private mode); safe to ignore
    }
  }, []);

  // Request notification permissions on component load
  useEffect(() => {
    // Check if browser supports notifications
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
      Notification.requestPermission();
    }
  }, []);

  if (!authReady || loadingQuestions || !moduleInfo || !questions.length || closingSession) {
    return (
      <WorkspaceLoading
        message={closingSession ? 'Closing your lab container...' : 'Preparing your lab workspace...'}
      />
    );
  }

  // Mobile layout

  // Mobile layout
  if (isMobile) {
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <StudentConnectionHeartbeat />
        <EvaluationOverlay
          overlay={evaluationOverlay}
          logBoxRef={logBoxRef}
          onClose={() => setEvaluationOverlay((prev) => ({ ...prev, open: false }))}
        />
        <TimeUpDialog
          state={timeUpDialog}
          onExit={() => handleExitWorkspace({ confirmExit: false })}
          onReview={() => setTimeUpDialog((prev) => ({ ...prev, open: false }))}
        />
        <TimeLockedExit
          show={timeLocked && !timeUpDialog.open}
          onExit={() => handleExitWorkspace({ confirmExit: false })}
        />
        <Header
          title={question ? question.title : 'No questions available'}
          onTimeUp={handleTimeUp}
          timeLimit={isFreeCoding ? null : remainingSeconds}
          totalTimeLimit={isFreeCoding ? null : totalSeconds}
          onExitLab={() => handleExitWorkspace()}
          studentId={getCurrentUser()}
        />
        <MobileTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          tabs={[
            { id: 'question', label: 'Problem', icon: null },
            { id: 'editor', label: 'Code', icon: null },
            { id: 'terminal', label: 'Output', icon: null }
          ]}
        />
        <div className="flex-1 overflow-hidden">
          {activeTab === 'question' && (
            <QuestionPane 
              questions={questions}
              activeQuestionIdx={activeQuestionIdx}
              setActiveQuestionIdx={setActiveQuestionIdx}
              testCaseResults={testCaseResults[questions[activeQuestionIdx]?.id] || []}
              activeTab={questionPaneTab}
              setActiveTab={setQuestionPaneTab}
              evalMessage={evalMessage}
              submissionRefreshTrigger={submissionRefreshTrigger}
              sessionId={getCurrentLabSession()}
            />
          )}
          {activeTab === 'editor' && (
            <EditorPane 
              language={language}
              setLanguage={setLanguage}
              files={files}
              activeFileId={activeFileId}
              setActiveFileId={setActiveFileId}
              questionId={question?.id}
              updateCode={updateCode}
              addNewFile={addNewFile}
              onRun={handleRun}
              onSubmit={handleSubmit}
              onStopAll={handleStopAll}
              isRunning={isRunning}
              isSubmitting={isSubmitting}
              saveStatus={saveStatus}
              renameFile={renameFile}
              updateFileLanguage={updateFileLanguage}
              resetFileToBoilerplate={resetFileToBoilerplate}
              alreadyPassed={question && passedQuestionIds.has(question.id)}
              onSave={saveActiveFile}
            />
          )}
          {activeTab === 'terminal' && (
            <TerminalPane
              onClose={() => setActiveTab('editor')}
              sessionId={getCurrentLabSession()}
            />
          )}
        </div>
      </div>
    );
  }

  // Desktop layout

  // Desktop layout
  return (
    <div className="flex flex-col h-screen bg-white">
      <StudentConnectionHeartbeat />
      <EvaluationOverlay
        overlay={evaluationOverlay}
        logBoxRef={logBoxRef}
        onClose={() => setEvaluationOverlay((prev) => ({ ...prev, open: false }))}
      />
      <TimeUpDialog
        state={timeUpDialog}
        onExit={() => handleExitWorkspace({ confirmExit: false })}
        onReview={() => setTimeUpDialog((prev) => ({ ...prev, open: false }))}
      />
      <TimeLockedExit
        show={timeLocked && !timeUpDialog.open}
        onExit={() => handleExitWorkspace({ confirmExit: false })}
      />
      <Header
        title={moduleInfo ? moduleInfo.name : (question ? question.title : 'No questions available')}
        onTimeUp={handleTimeUp}
        timeLimit={isFreeCoding ? null : remainingSeconds}
        totalTimeLimit={isFreeCoding ? null : totalSeconds}
        showQuestion={showQuestion}
        onToggleQuestion={() => setShowQuestion(!showQuestion)}
        moduleInfo={moduleInfo}
        loadingQuestions={loadingQuestions}
        onExitLab={() => handleExitWorkspace()}
        studentId={getCurrentUser()}
      />
      
      <div className="flex-1 overflow-hidden">
        {/* No autoSaveId here on purpose: react-resizable-panels persists panel
            sizes to localStorage keyed by autoSaveId, globally per-browser.
            On shared lab machines, that meant whichever student last opened/
            closed the terminal left its size saved, and the *next* student to
            open this page would have that leftover layout restored on mount
            (before our showTerminal effect could correct it) — independent of
            their own showTerminal=false starting state. That's what caused the
            terminal to look "randomly" open. Layout here is driven entirely by
            the showTerminal/defaultSize props below instead. */}
        <PanelGroup direction="vertical" className="h-full">
          <Panel defaultSize={showTerminal ? 70 : 100} minSize={30} id="main-panel" order={1}>
            <PanelGroup direction="horizontal" className="h-full" autoSaveId="cnlab-horizontal-panels">
              {showQuestion && (
                <>
                  <Panel defaultSize={35} minSize={25} maxSize={60} id="question-panel" order={1}>
                    {loadingQuestions ? (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                          <p className="mt-2 text-gray-600">Loading questions...</p>
                        </div>
                      </div>
                    ) : moduleError ? (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center text-red-500 max-w-md mx-auto p-4">
                          <InformationCircleIcon className="h-8 w-8 mx-auto mb-2" />
                          <p>{moduleError}</p>
                          <p className="text-sm mt-2 text-gray-600">
                            Using fallback questions if available.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <QuestionPane
                        questions={questions}
                        activeQuestionIdx={activeQuestionIdx}
                        setActiveQuestionIdx={setActiveQuestionIdx}
                        onClose={() => setShowQuestion(false)}
                        testCaseResults={testCaseResults[questions[activeQuestionIdx]?.id] || []}
                        activeTab={questionPaneTab}
                        setActiveTab={setQuestionPaneTab}
                        evalMessage={evalMessage}
                        submissionRefreshTrigger={submissionRefreshTrigger}
                        sessionId={getCurrentLabSession()}
                      />
                    )}
                  </Panel>
                  <ResizeHandle />
                </>
              )}
              <Panel minSize={40} id="editor-panel" order={2}>                
                <EditorPane 
                  language={language}
                  setLanguage={setLanguage}
                  files={files}
                  setFiles={setFiles}
                  activeFileId={activeFileId}
                  setActiveFileId={setActiveFileId}
                  activeFile={activeFile}
                  questionId={question?.id}
                  updateCode={updateCode}
                  addNewFile={addNewFile}
                  openFile={openFile}
                  onRun={handleRun}
                  onEvaluate={handleEvaluate}
                  onSubmit={handleSubmit}
                  onStopAll={handleStopAll}
                  isRunning={isRunning}
                  isEvaluating={isEvaluating}
                  isSubmitting={isSubmitting}
                  showQuestion={showQuestion}
                  onToggleQuestion={() => setShowQuestion(true)}
                  showTerminal={showTerminal}
                  setShowTerminal={setShowTerminal}
                  onCloseFile={handleCloseFile}
                  saveStatus={saveStatus}
                  renameFile={renameFile}
                  updateFileLanguage={updateFileLanguage}
                  resetFileToBoilerplate={resetFileToBoilerplate}
                  tags={tags}
                  tagToFileMap={tagToFileMap}
                  setTagToFileMap={setTagToFileMap}
                  isFreeCoding={isFreeCoding}
                  alreadyPassed={question && passedQuestionIds.has(question.id)}
                  onSave={saveActiveFile}
                />
              </Panel>
            </PanelGroup>
          </Panel>
          {/* Always render TerminalPane panel, but hide with CSS if not visible */}
          <ResizeHandle orientation="horizontal" style={{ display: showTerminal ? undefined : 'none' }} />
          <Panel
            ref={panelRef}
            defaultSize={showTerminal ? 45 : 0}
            minSize={0}
            maxSize={100}
            id="terminal-panel"
            order={3}
            onResize={handleTerminalPanelResize}
          >
            <TerminalPane 
              onClose={() => setShowTerminal(false)} 
              termVisible={showTerminal} 
              setCurrentWorkingDir={setCurrentWorkingDir} 
              sessionId={getCurrentLabSession()}
            />
          </Panel>
        </PanelGroup>

        {showFileModal && (
          <FileSelectorModal
            files={availableFiles}
            onSelect={handleFileSelect}
            onClose={() => setShowFileModal(false)}
          />
        )}
      </div>
    </div>
  );
}