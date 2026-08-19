import Timer from './Timer';
import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';
import { 
  QuestionMarkCircleIcon, 
  BeakerIcon,
  ClockIcon,
  EyeIcon,
  EyeSlashIcon,
  SparklesIcon,
  ArrowLeftIcon,
  AcademicCapIcon,
  InformationCircleIcon,
  ArrowRightOnRectangleIcon
} from '@heroicons/react/24/outline';

export default function Header({ 
  title, 
  timeLimit, 
  totalTimeLimit,
  endsAt,
  serverTime,
  onTimeUp, 
  showQuestion = true, 
  onToggleQuestion,
  isTeacherPage = false,
  backLink,
  backText,
  moduleInfo,
  loadingQuestions,
  onLogout,
  onExitLab,
  studentId
}) {
  const [pendingRequests, setPendingRequests] = useState({ passwordResets: [], sessionDisconnects: [] });
  const [notificationsOpen, setNotificationsOpen] = useState(true);
  const [notificationError, setNotificationError] = useState('');

  const loadPendingRequests = useCallback(async () => {
    if (!isTeacherPage) return;
    try {
      const response = await axios.get(`${API_BASE}/api/batches/pending-requests`);
      setPendingRequests(response.data || { passwordResets: [], sessionDisconnects: [] });
      setNotificationError('');
    } catch {
      // A notification failure should never prevent the page itself loading.
    }
  }, [isTeacherPage]);

  useEffect(() => {
    loadPendingRequests();
    if (!isTeacherPage) return undefined;
    const timer = window.setInterval(loadPendingRequests, 15_000);
    return () => window.clearInterval(timer);
  }, [isTeacherPage, loadPendingRequests]);

  const approveRequest = async (kind, id) => {
    try {
      const endpoint = kind === 'password'
        ? `/api/batches/password-reset-requests/${id}`
        : `/api/batches/session-disconnect-requests/${id}`;
      await axios.patch(`${API_BASE}${endpoint}`, { status: 'approved' });
      await loadPendingRequests();
    } catch (error) {
      setNotificationError(error.response?.data?.error || 'Could not approve the request.');
    }
  };

  const notifications = [
    ...pendingRequests.passwordResets.map((request) => ({ ...request, kind: 'password', title: 'Password change request' })),
    ...pendingRequests.sessionDisconnects.map((request) => ({ ...request, kind: 'disconnect', title: 'Session disconnect request' })),
  ];

  const handleLogoutClick = () => {
    if (window.confirm('Are you sure you want to log out?')) {
      onLogout();
    }
  };

  return (
    <header className="bg-white/80 backdrop-blur-lg border-b border-gray-200/50 shadow-lg">
      <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-purple-500/5 to-cyan-500/5"></div>
      <div className="relative flex items-center justify-between px-6 py-4 max-h-16">
        {/* Left section */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3 group">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg group-hover:shadow-xl transition-all duration-300">
              <BeakerIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                CN Lab
              </h1>
              <div className="flex items-center space-x-1 text-xs text-gray-500">
                <SparklesIcon className="w-3 h-3" />
                <span>{isTeacherPage ? 'Teacher Dashboard' : 'Interactive Learning'}</span>
              </div>
            </div>
          </div>
          
          <div className="hidden md:flex items-center space-x-2 text-gray-500">
            <div className="w-px h-8 bg-gradient-to-b from-transparent via-gray-300 to-transparent"></div>
            {isTeacherPage ? (
              <AcademicCapIcon className="w-4 h-4 text-indigo-500" />
            ) : (
              <QuestionMarkCircleIcon className="w-4 h-4 text-indigo-500" />
            )}
            <h2 className="text-md font-medium text-gray-700 bg-gray-50 px-3 py-1 rounded-full">
              {title}
            </h2>
            
            {/* Module info pill in header */}
            {moduleInfo && (
              <div className="ml-2 flex items-center bg-indigo-50 rounded-full px-3 py-1 text-xs text-indigo-700 border border-indigo-100">
                <InformationCircleIcon className="w-4 h-4 mr-1" />
                {!isTeacherPage && studentId && (
                  <div className="ml-2 flex items-center bg-gray-50 rounded-full px-3 py-1 text-xs text-gray-600 border border-gray-200">
                    <span className="font-medium">{studentId}</span>
                  </div>
                )}
                {moduleInfo.workspaceMode !== 'practice' && moduleInfo.workspaceMode !== 'free' && <>
                  <span className="mr-2 font-medium">{moduleInfo.time}</span>
                  <span className="font-medium">{moduleInfo.maxMarks || 'N/A'} Marks</span>
                </>}
                {moduleInfo.workspaceMode === 'practice' && <span className="font-medium">Practice</span>}
                {moduleInfo.workspaceMode === 'free' && <span className="font-medium">Free coding</span>}
              </div>
            )}
            
            {/* Loading indicator */}
            {loadingQuestions && (
              <div className="ml-2 flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-700"></div>
                <span className="ml-2 text-xs text-gray-600">Loading...</span>
              </div>
            )}
          </div>
        </div>

        {/* Center section - Mobile title with module info */}
        <div className="md:hidden flex flex-col items-center">
          <h2 className="text-lg font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent truncate max-w-xs">
            {title}
          </h2>
          {moduleInfo && (
            <div className="text-xs text-gray-500">
              {!isTeacherPage && studentId && (
                <div className="text-xs text-gray-400">{studentId}</div>
              )}
              {moduleInfo.workspaceMode === 'practice' ? 'Practice' : moduleInfo.workspaceMode === 'free' ? 'Free coding' : `${moduleInfo.time} · ${moduleInfo.maxMarks || 'N/A'} Marks`}
            </div>
          )}
        </div>

        {/* Right section */}
        <div className="flex items-center space-x-4">
          {/* Back button for teacher pages */}
          {isTeacherPage && backLink && (
            <Link 
              to={backLink}
              className="hidden md:flex items-center space-x-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-indigo-600 bg-white/50 hover:bg-indigo-50 backdrop-blur-sm rounded-xl border border-gray-200/50 shadow-sm hover:shadow-md transition-all duration-300"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              <span className="hidden lg:inline">{backText || 'Back'}</span>
            </Link>
          )}
          {/* Logout button for teacher pages */}
          {isTeacherPage && onLogout && (
            <button
              onClick={handleLogoutClick}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-red-600 hover:text-white bg-red-50 hover:bg-red-600 backdrop-blur-sm rounded-xl border border-red-200/50 shadow-sm hover:shadow-md transition-all duration-300"
            >
              <ArrowRightOnRectangleIcon className="w-4 h-4" />
              <span className="hidden lg:inline">Logout</span>
            </button>
          )}
          
          {/* Question toggle (desktop only) */}
          {onToggleQuestion && (
            <button
              onClick={onToggleQuestion}
              className="hidden md:flex items-center space-x-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-indigo-600 bg-white/50 hover:bg-indigo-50 backdrop-blur-sm rounded-xl border border-gray-200/50 shadow-sm hover:shadow-md transition-all duration-300"
              title={showQuestion ? "Hide instructions" : "Show instructions"}
            >
              {showQuestion ? (
                <EyeSlashIcon className="w-4 h-4" />
              ) : (
                <EyeIcon className="w-4 h-4" />
              )}
              <span className="hidden lg:inline">
                {showQuestion ? 'Hide' : 'Show'} Instructions
              </span>
            </button>
          )}

          {/* Timer - Only show for student pages */}
          {!isTeacherPage && timeLimit != null && (
            <div className="flex items-center space-x-3 bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-2 rounded-xl border border-gray-200/50 shadow-sm backdrop-blur-sm">
              <div className="p-1 bg-gradient-to-br from-orange-400 to-red-500 rounded-lg">
                <ClockIcon className="w-5 h-5 text-white" />
              </div>
              <Timer
                duration={timeLimit}
                totalDuration={totalTimeLimit}
                endsAt={endsAt}
                serverTime={serverTime}
                onExpire={onTimeUp}
              />
            </div>
          )}
          {!isTeacherPage && onExitLab && (
            <button
              onClick={onExitLab}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-red-600 hover:text-white bg-red-50 hover:bg-red-600 backdrop-blur-sm rounded-xl border border-red-200/50 shadow-sm hover:shadow-md transition-all duration-300"
            >
              <ArrowRightOnRectangleIcon className="w-4 h-4" />
              <span className="hidden lg:inline">Exit Lab</span>
            </button>
          )}
        </div>
      </div>
      {isTeacherPage && notifications.length > 0 && notificationsOpen && (
        <aside className="fixed left-4 top-20 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xl" role="status">
          <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50 px-4 py-3">
            <div><p className="text-sm font-semibold text-amber-900">Teacher notifications</p><p className="text-xs text-amber-700">{notifications.length} request{notifications.length === 1 ? '' : 's'} awaiting review</p></div>
            <button type="button" onClick={() => setNotificationsOpen(false)} className="text-xs font-medium text-amber-800 hover:underline">Dismiss</button>
          </div>
          <div className="max-h-80 divide-y divide-gray-100 overflow-y-auto">
            {notifications.map((request) => <div key={`${request.kind}-${request._id}`} className="p-3 text-sm">
              <p className="font-medium text-gray-900">{request.title}</p>
              <p className="text-gray-600">{request.studentName || request.userId} <span className="text-xs text-gray-400">({request.userId})</span></p>
              <p className="text-xs text-gray-500">{new Date(request.createdAt).toLocaleString()}</p>
              <div className="mt-2 flex items-center gap-3"><button type="button" onClick={() => approveRequest(request.kind, request._id)} className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700">Approve</button><Link to="/teacher-batches" className="text-xs font-medium text-indigo-700 hover:underline">Review later</Link></div>
            </div>)}
          </div>
          {notificationError && <p className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{notificationError}</p>}
        </aside>
      )}
    </header>
  );
}
