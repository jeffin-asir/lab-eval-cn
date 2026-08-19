import dotenv from 'dotenv';
import express from 'express';
import User from '../models/User.js';
import PasswordResetRequest from '../models/PasswordResetRequest.js';
import { authorize, clearAuthCookie, getUserFromRequest, requireAuth, setAuthCookie, signUserToken } from '../middleware/auth.js';
import StudentConnection from '../models/StudentConnection.js';
import StudentLoginAudit from '../models/StudentLoginAudit.js';
import LabAssignment from '../models/LabAssignment.js';
import Submission from '../models/Submission.js';
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
    if (existing.role !== 'admin') {
      existing.role = 'admin';
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
    role: 'admin',
    mustChangePassword: false,
  });
}

router.post('/teacher-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    await ensureTeacherUser();
    const teacher = await User.findOne({ user_id: String(username || '').trim(), role: { $in: ['faculty', 'admin'] } });
    if (!teacher || password !== teacher.password) {
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
        .populate('user', 'name batch roll_number').lean(),
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

    // A device is attributed to the first account that used it in an
    // assignment.  A later account on that device is a password-sharing
    // signal for that account; the device owner gets the multiple-login
    // signal.  This deliberately avoids showing the identical alert on both
    // students' rows.
    const signalsByUser = new Map();
    const passwordSharing = [];
    const multipleLogin = [];
    const auditsByAssignment = new Map();
    for (const audit of audits) {
      const key = audit.assignmentId.toString();
      if (!auditsByAssignment.has(key)) auditsByAssignment.set(key, []);
      auditsByAssignment.get(key).push(audit);
    }
    for (const assignmentAudits of auditsByAssignment.values()) {
      const usersByDevice = new Map();
      for (const audit of assignmentAudits) {
        if (!usersByDevice.has(audit.deviceKey)) usersByDevice.set(audit.deviceKey, []);
        usersByDevice.get(audit.deviceKey).push(audit);
      }
      for (const deviceAudits of usersByDevice.values()) {
        const firstAuditForUser = new Map();
        for (const audit of deviceAudits.sort((a, b) => new Date(a.loggedInAt) - new Date(b.loggedInAt))) {
          if (!firstAuditForUser.has(audit.userId)) firstAuditForUser.set(audit.userId, audit);
        }
        if (firstAuditForUser.size < 2) continue;

        const [ownerUserId, ownerAudit] = firstAuditForUser.entries().next().value;
        const scope = ownerAudit.moduleId?.name || ownerAudit.slotKey || 'Active lab';
        const deviceLabel = ownerAudit.deviceSource === 'browser'
          ? `Browser device …${ownerAudit.deviceId.slice(-8)}`
          : `Network/browser signature (${ownerAudit.ipAddress})`;
        const otherAudits = [...firstAuditForUser.entries()]
          .filter(([userId]) => userId !== ownerUserId)
          .map(([, audit]) => audit);
        const counterpartIds = otherAudits.map((audit) => audit.userId).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const multiEvent = {
          type: 'multiple-login', userId: ownerUserId, studentName: ownerAudit.studentName,
          counterpartIds, scope, deviceLabel, occurredAt: otherAudits[0].loggedInAt,
          moduleId: ownerAudit.moduleId?._id?.toString() || ownerAudit.moduleId?.toString() || '',
        };
        multipleLogin.push(multiEvent);
        if (!signalsByUser.has(ownerUserId)) signalsByUser.set(ownerUserId, { passwordSharing: [], multipleLogin: [] });
        signalsByUser.get(ownerUserId).multipleLogin.push(multiEvent);

        for (const audit of otherAudits) {
          const shareEvent = {
            type: 'password-sharing', userId: audit.userId, studentName: audit.studentName,
            counterpartIds: [ownerUserId], scope, deviceLabel, occurredAt: audit.loggedInAt,
            moduleId: audit.moduleId?._id?.toString() || audit.moduleId?.toString() || '',
          };
          passwordSharing.push(shareEvent);
          if (!signalsByUser.has(audit.userId)) signalsByUser.set(audit.userId, { passwordSharing: [], multipleLogin: [] });
          signalsByUser.get(audit.userId).passwordSharing.push(shareEvent);
        }
      }
    }

    const allSignals = [...passwordSharing, ...multipleLogin];
    const earliestReviewAt = allSignals.length
      ? new Date(Math.min(...allSignals.map((signal) => new Date(signal.occurredAt).getTime())) + (5 * 60 * 1000))
      : null;
    const submissionUsers = [...new Set(allSignals.flatMap((signal) => [signal.userId, ...signal.counterpartIds]))];
    const moduleIds = [...new Set(allSignals.map((signal) => signal.moduleId).filter(Boolean))];
    const submissions = earliestReviewAt && submissionUsers.length && moduleIds.length
      ? await Submission.find({
        userId: { $in: submissionUsers }, moduleId: { $in: moduleIds }, createdAt: { $gte: earliestReviewAt },
      }).select('userId moduleId questionId passedCount totalTestCases evaluationResults createdAt').sort({ createdAt: 1 }).lean()
      : [];

    const passedTestcaseSignature = (submission) => {
      if (!Array.isArray(submission.evaluationResults)) return '';
      return submission.evaluationResults
        .filter((result) => result?.passed === true)
        .map((result) => result.name || result.fullName || result.testcaseId || result.id || '')
        .filter(Boolean)
        .sort()
        .join('|');
    };

    const addCopyingAssessment = (signal) => {
      const reviewAt = new Date(new Date(signal.occurredAt).getTime() + (5 * 60 * 1000));
      if (now < reviewAt) {
        return { status: 'pending', reviewAt, message: 'Submission comparison becomes available five minutes after the signal.' };
      }
      const related = submissions.filter((submission) => (
        submission.moduleId === signal.moduleId
        && [signal.userId, ...signal.counterpartIds].includes(submission.userId)
        && new Date(submission.createdAt) >= reviewAt
        && Number(submission.passedCount || 0) > 0
      ));
      for (let i = 0; i < related.length; i += 1) {
        for (let j = i + 1; j < related.length; j += 1) {
          const earlier = related[i];
          const later = related[j];
          if (earlier.userId !== later.userId
            && earlier.questionId === later.questionId
            && Number(earlier.passedCount) === Number(later.passedCount)
            && Number(earlier.totalTestCases || 0) === Number(later.totalTestCases || 0)
            && passedTestcaseSignature(earlier)
            && passedTestcaseSignature(earlier) === passedTestcaseSignature(later)) {
            return {
              status: 'match', sharedBy: earlier.userId, copiedBy: later.userId,
              questionId: earlier.questionId, passedCount: earlier.passedCount, totalTestCases: earlier.totalTestCases,
              sharedAt: earlier.createdAt, copiedAt: later.createdAt,
            };
          }
        }
      }
      return { status: 'no-match', reviewAt, message: 'No matching later testcase result has been found yet.' };
    };
    for (const signal of allSignals) signal.copyingAssessment = addCopyingAssessment(signal);

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
      integrity: signalsByUser.get(connection.userId) || { passwordSharing: [], multipleLogin: [] },
    })).sort((a, b) => a.userId.localeCompare(b.userId, undefined, { numeric: true, sensitivity: 'base' }));
    const flaggedStudents = students.filter((student) => student.integrity.passwordSharing.length || student.integrity.multipleLogin.length);
    res.json({
      students,
      integritySummary: {
        trackedAssignments: assignmentIds.length,
        flaggedStudents: flaggedStudents.length,
        passwordSharing,
        multipleLogin,
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
