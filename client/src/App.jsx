import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import CNLabWorkspace from './pages/CNLabWorkspace';
import TeacherUpload from './pages/TeacherUpload';
import TeacherLogin from './pages/TeacherLogin';
import TeacherDashboard from './pages/TeacherDashboard';
import TeacherPerformance from './pages/TeacherPerformance';
import TeacherDocker from './pages/TeacherDocker';
import TeacherMongoDB from './pages/TeacherMongoDB';
import TeacherBatches from './pages/TeacherBatches';
import StudentDashboard from './pages/StudentDashboard';
import TeacherTimeControl from './pages/TeacherTimeControl';
import TeacherActiveStudents from './pages/TeacherActiveStudents';
import Home from './pages/Home';
import Login from './pages/Login';
import './App.css';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50">
        <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
        <div className="relative z-10">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/workspace" element={<CNLabWorkspace />} />
            <Route path="/student-dashboard" element={<StudentDashboard />} />
            <Route path="/teacher-login" element={<TeacherLogin />} />
            <Route path="/teacher-dashboard" element={<TeacherDashboard />} />
            <Route path="/teacher-upload" element={<TeacherUpload />} />
            <Route path="/teacher-performance" element={<TeacherPerformance />} />
            <Route path="/teacher-docker" element={<TeacherDocker />} />
            <Route path="/teacher-mongodb" element={<TeacherMongoDB />} />
            <Route path="/teacher-batches" element={<TeacherBatches />} />
            <Route path="/teacher-time" element={<TeacherTimeControl />} />
            <Route path="/teacher-active-students" element={<TeacherActiveStudents />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
