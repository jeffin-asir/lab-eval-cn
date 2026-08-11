import dotenv from 'dotenv';
import express from 'express';
import User from '../models/User.js';
import PasswordResetRequest from '../models/PasswordResetRequest.js';
import { authorize, clearAuthCookie, getUserFromRequest, requireAuth, setAuthCookie, signUserToken } from '../middleware/auth.js';
import StudentConnection from '../models/StudentConnection.js';
import StudentLoginAudit from '../models/StudentLoginAudit.js';
import LabAssignment from '../models/LabAssignment.js';
import SessionDisconnectRequest from '../models/SessionDisconnectRequest.js';
import { activeConnectionFilter, createStudentConnection, revokeStudentConnection } from '../utils/studentConnections.js';

dotenv.config();

const router = express.Router();

export function getTeacherAuthConfig(env = process.env) {
  const teacherUserId = env.TEACHER_USER_ID?.trim();
  const teacherPassword = env.TEACHER_PASSWORD?.trim();

  if (!teacherUserId || !teacherPassword) {
    throw new Error('TEACHER_USER_ID and TEACHER_PASSWORD must be set in server/.env');
  }

  return {
    teacherUserId,
    teacherPassword,
  };
}

const { teacherUserId: TEACHER_USER_ID, teacherPassword: TEACHER_PASSWORD } = getTeacherAuthConfig();

function validateStudentPassword(password) {
  if (String(password || '').length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[^A-Za-z0-9]/.test(String(password))) {
    return 'Password must include at least one special symbol.';
  }
  return null;
}

async function ensureTeacherUser() {
  const existing = await User.findOne({ user_id: TEACHER_USER_ID });
  if (existing) {
    let changed = false;
    if (!['faculty', 'admin'].includes(existing.role)) {
      existing.role = 'faculty';
      changed = true;
    }
    if (existing.name !== 'Network Lab Teacher') {
      existing.name = 'Network Lab Teacher';
      changed = true;
    }
    if (existing.user_id !== TEACHER_USER_ID) {
      existing.user_id = TEACHER_USER_ID;
      changed = true;
    }
    if (existing.roll_number !== TEACHER_USER_ID) {
      existing.roll_number = TEACHER_USER_ID;
      changed = true;
    }
    if (existing.password !== TEACHER_PASSWORD) {
      existing.password = TEACHER_PASSWORD;
      changed = true;
    }
    if (existing.mustChangePassword) {
      existing.mustChangePassword = false;
      changed = true;
    }
    if (changed) await existing.save();
    return existing;
  }

  return User.create({
    name: 'Network Lab Teacher',
    user_id: TEACHER_USER_ID,
    roll_number: TEACHER_USER_ID,
    password: TEACHER_PASSWORD,
    role: 'faculty',
    mustChangePassword: false,
  });
}

router.post('/teacher-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const teacher = await ensureTeacherUser();

    const passwordMatches = password === teacher.password;

    if (username !== TEACHER_USER_ID || !passwordMatches) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    setAuthCookie(res, signUserToken(teacher), 'teacher');
    res.json({
      success: true,
      teacher: {
        user_id: teacher.user_id,
        name: teacher.name,
        role: teacher.role,
      },
    });
  } catch (err) {
    console.error('[auth] teacher-login error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/student-login', async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) {
      return res.status(400).json({ error: 'Student ID and password are required.' });
    }

    const student = await User.findOne({
      role: 'student',
      $or: [{ user_id: userId.trim() }, { roll_number: userId.trim() }],
    });

    if (!student || student.password !== password) {
      return res.status(401).json({ error: 'Invalid student ID or password.' });
    }

    const connection = await createStudentConnection(req, student);
    setAuthCookie(res, signUserToken(student, connection.sessionId), 'student');
    res.json({
      success: true,
      student: {
        user_id: student.user_id,
        name: student.name,
        roll_number: student.roll_number,
        batch: student.batch,
        mustChangePassword: student.mustChangePassword,
      },
    });
  } catch (err) {
    console.error('[auth] student-login error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: {
      user_id: req.user.user_id,
      name: req.user.name,
      roll_number: req.user.roll_number,
      batch: req.user.batch,
      role: req.user.role,
      mustChangePassword: req.user.mustChangePassword,
    },
  });
});

router.post('/logout', async (req, res) => {
  const role = req.body?.role || req.query?.role || 'all';
  if (role === 'student' || role === 'all') {
    try {
      const user = await getUserFromRequest(req).catch(() => null);
      if (user?.role === 'student' && req.studentConnection?.sessionId) {
        await revokeStudentConnection(req.studentConnection.sessionId, 'student logged out');
      }
    } catch (_) {
      // Clearing the browser cookie is still useful when the connection has
      // already expired or was revoked by a teacher.
    }
  }
  clearAuthCookie(res, role);
  res.json({ success: true });
});

router.post('/heartbeat', requireAuth, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student session required.' });
  res.json({ success: true, expiresAt: req.studentConnection.expiresAt });
});

// This endpoint checks the password again so somebody cannot use a roll number
// alone to make a teacher disconnect another student's session.
router.post('/session-disconnect-request', async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) return res.status(400).json({ error: 'Student ID and password are required.' });
    const student = await User.findOne({
      role: 'student',
      $or: [{ user_id: userId.trim() }, { roll_number: userId.trim() }],
    });
    if (!student || student.password !== password) return res.status(401).json({ error: 'Invalid student ID or password.' });

    const request = await SessionDisconnectRequest.findOneAndUpdate(
      { userId: student.user_id },
      { $set: { studentName: student.name, batch: student.batch || '', status: 'pending', approvedAt: null } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, request });
  } catch (err) {
    console.error('[auth] session disconnect request error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/active-students', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const now = new Date();
    const [connections, liveAssignments] = await Promise.all([
      StudentConnection.find({ revokedAt: null, expiresAt: { $gt: now } })
        .populate('user', 'name batch roll_number').sort({ lastSeenAt: -1 }).lean(),
      LabAssignment.find({
        status: 'active',
        activeModule: { $ne: null },
        $and: [
          { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
        ],
      }).select('_id').lean(),
    ]);
    const assignmentIds = liveAssignments.map((assignment) => assignment._id);
    const audits = assignmentIds.length
      ? await StudentLoginAudit.find({ assignmentId: { $in: assignmentIds } })
        .populate('moduleId', 'name').lean()
      : [];

    const signalsByUser = new Map();
    const auditsByAssignment = new Map();
    for (const audit of audits) {
      const key = audit.assignmentId.toString();
      if (!auditsByAssignment.has(key)) auditsByAssignment.set(key, []);
      auditsByAssignment.get(key).push(audit);
    }
    for (const assignmentAudits of auditsByAssignment.values()) {
      const devicesByUser = new Map();
      const usersByDevice = new Map();
      for (const audit of assignmentAudits) {
        if (!devicesByUser.has(audit.userId)) devicesByUser.set(audit.userId, new Set());
        devicesByUser.get(audit.userId).add(audit.deviceKey);
        if (!usersByDevice.has(audit.deviceKey)) usersByDevice.set(audit.deviceKey, new Set());
        usersByDevice.get(audit.deviceKey).add(audit.userId);
      }
      for (const audit of assignmentAudits) {
        const scope = audit.moduleId?.name || audit.slotKey || 'Active lab';
        const deviceLabel = audit.deviceSource === 'browser'
          ? `Browser device …${audit.deviceId.slice(-8)}`
          : `Network/browser signature (${audit.ipAddress})`;
        const userDevices = devicesByUser.get(audit.userId);
        const deviceUsers = usersByDevice.get(audit.deviceKey);
        if (!signalsByUser.has(audit.userId)) signalsByUser.set(audit.userId, { multiDeviceScopes: [], sharedDeviceScopes: [] });
        const signals = signalsByUser.get(audit.userId);
        if (userDevices.size > 1 && !signals.multiDeviceScopes.some((item) => item.scope === scope)) {
          signals.multiDeviceScopes.push({ scope, deviceCount: userDevices.size });
        }
        if (deviceUsers.size > 1 && !signals.sharedDeviceScopes.some((item) => item.scope === scope && item.deviceLabel === deviceLabel)) {
          signals.sharedDeviceScopes.push({ scope, deviceLabel, userIds: [...deviceUsers].sort() });
        }
      }
    }

    const students = connections.map((connection) => ({
      connectionId: connection.sessionId,
      userId: connection.userId,
      name: connection.user?.name || connection.userId,
      batch: connection.user?.batch || '',
      ipAddress: connection.ipAddress,
      userAgent: connection.userAgent,
      connectedAt: connection.createdAt,
      lastSeenAt: connection.lastSeenAt,
      expiresAt: connection.expiresAt,
      malpractice: signalsByUser.get(connection.userId) || { multiDeviceScopes: [], sharedDeviceScopes: [] },
    }));
    const flaggedStudents = students.filter((student) => (
      student.malpractice.multiDeviceScopes.length || student.malpractice.sharedDeviceScopes.length
    ));
    res.json({
      students,
      integritySummary: {
        trackedAssignments: assignmentIds.length,
        flaggedStudents: flaggedStudents.length,
        sharedDeviceStudents: flaggedStudents.filter((student) => student.malpractice.sharedDeviceScopes.length).length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/active-students/:sessionId/disconnect', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const connection = await revokeStudentConnection(req.params.sessionId, 'disconnected by teacher');
    if (!connection) return res.status(404).json({ error: 'Active student connection not found.' });
    const { closeStudentSocketsForConnection } = await import('../controllers/sshController.js');
    closeStudentSocketsForConnection(connection.sessionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/change-password', async (req, res) => {
  try {
    const { userId, currentPassword, newPassword, resetRequestId } = req.body;
    const tokenUser = await getUserFromRequest(req).catch(() => null);
    const targetUserId = tokenUser?.role === 'student' ? tokenUser.user_id : userId;

    if (!targetUserId || !newPassword) {
      return res.status(400).json({ error: 'Student ID and new password are required.' });
    }
    const passwordError = validateStudentPassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const student = await User.findOne({ user_id: targetUserId, role: 'student' });
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    let allowed = false;
    let resetRequest = null;

    if (resetRequestId) {
      resetRequest = await PasswordResetRequest.findOne({
        _id: resetRequestId,
        userId: targetUserId,
        status: 'approved',
      });
      allowed = !!resetRequest;
    } else {
      if (!tokenUser || tokenUser.user_id !== student.user_id) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      allowed = student.mustChangePassword || currentPassword === student.password;
    }

    if (!allowed) {
      return res.status(403).json({ error: 'Password change is not permitted.' });
    }

    student.password = newPassword;
    student.mustChangePassword = false;
    await student.save();

    if (resetRequest) {
      resetRequest.status = 'completed';
      resetRequest.completedAt = new Date();
      await resetRequest.save();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[auth] change-password error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/password-reset-request', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Student ID is required.' });

    const student = await User.findOne({
      role: 'student',
      $or: [{ user_id: userId.trim() }, { roll_number: userId.trim() }],
    });
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    const request = await PasswordResetRequest.findOneAndUpdate(
      { userId: student.user_id, status: { $in: ['pending', 'approved'] } },
      {
        $set: {
          userId: student.user_id,
          studentName: student.name,
          batch: student.batch || '',
        },
        $setOnInsert: { status: 'pending' },
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, request });
  } catch (err) {
    console.error('[auth] password-reset-request error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/password-reset-request/:userId', async (req, res) => {
  try {
    const request = await PasswordResetRequest.findOne({
      userId: req.params.userId,
      status: 'approved',
    }).sort({ approvedAt: -1 });

    res.json({ approved: !!request, request });
  } catch (err) {
    console.error('[auth] password-reset-request status error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
