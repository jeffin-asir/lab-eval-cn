import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { API_BASE } from '../config';
import {
  DocumentPlusIcon,
  PaperAirplaneIcon,
  ChartBarIcon,
  CubeIcon,
  CircleStackIcon,
  ClipboardDocumentListIcon,
  UsersIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

const actions = [
  {
    key: 'create-questions',
    title: 'Create Questions',
    description: 'Author new CN lab questions, test cases, and eval scripts.',
    icon: DocumentPlusIcon,
    to: '/teacher-upload?tab=upload',
    color: 'from-indigo-500 to-purple-600',
  },
  {
    key: 'manage-modules',
    title: 'Manage Modules',
    description: 'Group questions into modules and manage the module bank.',
    icon: ClipboardDocumentListIcon,
    to: '/teacher-upload?tab=modules',
    color: 'from-emerald-500 to-teal-600',
  },
  {
    key: 'send-module',
    title: 'Send Module',
    description: 'Broadcast a module to every active student session.',
    icon: PaperAirplaneIcon,
    to: '/teacher-upload?tab=modules&labSession=1',
    color: 'from-cyan-500 to-blue-600',
  },
  {
    key: 'batches',
    title: 'Batches & Students',
    description: 'Create batches, enroll students, and approve password reset requests.',
    icon: UsersIcon,
    to: '/teacher-batches',
    color: 'from-sky-500 to-indigo-600',
  },
  {
    key: 'add-time',
    title: 'Add Test Time',
    description: 'Extend time for one student, a batch, or all active attempts.',
    icon: ClockIcon,
    to: '/teacher-time',
    color: 'from-violet-500 to-fuchsia-600',
  },
  {
    key: 'active-students',
    title: 'Active Students',
    description: 'Monitor active student connections and disconnect suspicious or stuck sessions.',
    icon: UsersIcon,
    to: '/teacher-active-students',
    color: 'from-rose-500 to-red-600',
  },
  {
    key: 'student-performances',
    title: 'Student Performances',
    description: 'Look up an individual student, or download a class-wide CSV report.',
    icon: ChartBarIcon,
    to: '/teacher-performance',
    color: 'from-orange-500 to-red-500',
  },
  {
    key: 'docker-manager',
    title: 'Docker Manager',
    description: 'Clean up old/unused student containers.',
    icon: CubeIcon,
    to: '/teacher-docker',
    color: 'from-slate-500 to-gray-700',
  },
  {
    key: 'mongodb-manager',
    title: 'MongoDB Manager',
    description: 'Browse, edit, delete, add, and export lab database records.',
    icon: CircleStackIcon,
    to: '/teacher-mongodb',
    color: 'from-emerald-500 to-green-700',
  },
];

export default function TeacherDashboard() {
  const navigate = useNavigate();

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

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        title="Teacher Dashboard"
        isTeacherPage={true}
        backLink="/"
        backText="Back to Home"
        onLogout={handleLogout}
      />

      <div className="container mx-auto py-10 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-lg font-medium text-gray-900 mb-6">What would you like to do?</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {actions.map(({ key, title, description, icon: Icon, to, color }) => (
              <button
                key={key}
                onClick={() => navigate(to)}
                className="group text-left bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-lg transition-all duration-300 p-6 flex flex-col"
              >
                <div className={`p-3 mb-4 rounded-xl bg-gradient-to-br ${color} w-fit shadow-md`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
                  {title}
                </h3>
                <p className="text-sm text-gray-500 mt-1">{description}</p>
              </button>
            ))}

          </div>
        </div>
      </div>
    </div>
  );
}
