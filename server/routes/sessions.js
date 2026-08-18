import express from 'express';
import mongoose from 'mongoose';
import Session from '../models/Session.js';
import { CNModule } from '../models/Module.js';
import User from '../models/User.js';
import Course from '../models/Course.js';
import LabAssignment from '../models/LabAssignment.js';
import TestAttempt from '../models/TestAttempt.js';
import EvaluationRun from '../models/EvaluationRun.js';
import { protect, authorize } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { ensureSessionContainer, stopSessionContainer } from '../controllers/sshController.js';
import {
  buildQuestionSchedule,
  isQuestionAvailable,
} from '../utils/labSession.js';

const router = express.Router();

function getAttemptTotalSeconds(attempt) {
  const baseSeconds = attempt.baseEndsAt && attempt.startedAt
    ? Math.floor((attempt.baseEndsAt.getTime() - attempt.startedAt.getTime()) / 1000)
    : 1;
  return Math.max(1, baseSeconds + (Number(attempt.extraMinutes || 0) * 60));
}

async function expireEndedAssignments(now = new Date()) {
  await LabAssignment.updateMany(
    {
      status: 'active',
      endsAt: { $lte: now },
    },
    {
      $set: {
        status: 'ended',
        endedAt: now,
      },
    }
  );
}

async function getStudentUpcomingAssignments(student, now = new Date()) {
  await expireEndedAssignments(now);
  const assignments = await LabAssignment.find({
    status: 'active',
    activeModule: { $ne: null },
    startsAt: { $gt: now },
    $or: [
      { endsAt: null },
      { endsAt: { $gt: now } },
    ],
    $and: [
      {
        $or: [
          { targetBatch: { $in: [null, ''] } },
          { targetBatch: student.batch || '' },
        ],
      },
    ],
  })
    .populate('activeModule', 'name startTime endTime date')
    .sort({ startsAt: 1 })
    .lean();

  return assignments;
}

async function getStudentVisibleAssignments(student, now = new Date()) {
  await expireEndedAssignments(now);
  const assignments = await LabAssignment.find({
    status: 'active',
    activeModule: { $ne: null },
    $and: [
      {
        $or: [
          { endsAt: null },
          { endsAt: { $gt: now } },
        ],
      },
      {
        $or: [
          { targetBatch: { $in: [null, ''] } },
          { targetBatch: student.batch || '' },
        ],
      },
    ],
  }).populate({
    path: 'activeModule',
    populate: { path: 'questions', model: 'Question' },
  }).sort({ assignedAt: -1 }).lean();

  const visible = [];
  for (const assignment of assignments) {
    const moduleId = assignment.activeModule?._id?.toString();
    if (!moduleId) continue;

    const existingAttempt = await TestAttempt.findOne({
      userId: student.user_id,
      moduleId,
      slotKey: assignment.slotKey,
    }).lean();

    const assignmentStillAvailable = !assignment.endsAt || new Date(assignment.endsAt) > now;
    const assignmentHasStarted = !assignment.startsAt || new Date(assignment.startsAt) <= now;
    const attemptHasTime =
      existingAttempt?.status === 'active' &&
      existingAttempt.endsAt &&
      new Date(existingAttempt.endsAt) > now;
    const attemptExpired = !!existingAttempt && !attemptHasTime;

    if (!attemptExpired && assignmentHasStarted && (assignmentStillAvailable || attemptHasTime)) {
      visible.push(assignment);
    }
  }

  return visible;
}

// Student self-service login: spin up (or reuse) the container for this
// userId and record the studentName, no password required for now.
router.post('/init', requireAuth, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const studentName = req.user.name;

    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Only students can start lab sessions' });
    }

    const requestedSessionId = req.body?.mode === 'free'
      ? 'FREE_CODING'
      : req.body?.sessionId || req.body?.slotKey || null;
    const { sessionId, containerName, sshPort } = await ensureSessionContainer(userId, requestedSessionId);

    // Persist the student's display name against the session record.
    await Session.updateOne(
      { userId, sessionId },
      { $set: { studentName } }
    );

    res.status(200).json({
      success: true,
      sessionId,
      containerName,
      sshPort,
      userId,
      studentName,
    });
  } catch (err) {
    console.error('[API] /sessions/init error:', err);
    res.status(500).json({ error: err.message || 'Failed to start lab session' });
  }
});

router.post('/close', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Only students can close their lab session' });
    }

    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const result = await stopSessionContainer(req.user.user_id, sessionId);
    res.json(result);
  } catch (err) {
    console.error('[sessions] close session error:', err);
    res.status(500).json({ error: err.message || 'Failed to close lab session' });
  }
});

router.get('/student-dashboard', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Only students can view this dashboard' });
    }
    const student = await User.findOne({
      role: 'student',
      user_id: req.user.user_id,
    }).select('name user_id roll_number batch mustChangePassword').lean();

    if (!student) return res.status(404).json({ error: 'Student not found.' });

    const now = new Date();
    const visibleAssignments = await getStudentVisibleAssignments(student, now);
    const upcomingAssignments = await getStudentUpcomingAssignments(student, now);

    const runs = await EvaluationRun.aggregate([
      { $match: { userId: student.user_id, runType: 'submit' } },
      {
        $group: {
          _id: { moduleId: '$moduleId', sessionId: '$sessionId', slotKey: '$slotKey' },
          lastSubmittedAt: { $max: '$createdAt' },
          questionCount: { $addToSet: '$questionId' },
        },
      },
      { $sort: { lastSubmittedAt: -1 } },
      { $limit: 20 },
    ]);

    const moduleIds = runs.map((r) => r._id.moduleId).filter(Boolean);
    const modules = await CNModule.find({ _id: { $in: moduleIds } }).select('name targetBatch startTime endTime').lean();
    const moduleById = new Map(modules.map((m) => [m._id.toString(), m]));

    res.json({
      student,
      activeSessions: visibleAssignments.map((assignment) => ({
            assignmentId: assignment._id,
            module: assignment.activeModule,
            slotKey: assignment.slotKey,
            assignedAt: assignment.assignedAt,
            startsAt: assignment.startsAt,
            endsAt: assignment.endsAt,
            startTime: assignment.startTime || assignment.activeModule?.startTime || '',
            endTime: assignment.endTime || assignment.activeModule?.endTime || '',
            targetBatch: assignment.targetBatch,
            canEnter: !assignment.startsAt || new Date(assignment.startsAt) <= now,
          })),
      upcomingSessions: upcomingAssignments.map((assignment) => ({
        assignmentId: assignment._id,
        module: assignment.activeModule,
        slotKey: assignment.slotKey,
        startsAt: assignment.startsAt,
        endsAt: assignment.endsAt,
        startTime: assignment.startTime || assignment.activeModule?.startTime || '',
        endTime: assignment.endTime || assignment.activeModule?.endTime || '',
        targetBatch: assignment.targetBatch,
      })),
      previousTests: runs.map((r) => ({
        moduleId: r._id.moduleId,
        moduleName: moduleById.get(r._id.moduleId)?.name || 'CN Lab',
        sessionId: r._id.sessionId,
        slotKey: r._id.slotKey,
        questionCount: r.questionCount.length,
        lastSubmittedAt: r.lastSubmittedAt,
      })),
    });
  } catch (err) {
    console.error('[sessions] student-dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/test-attempts/start', requireAuth, async (req, res) => {
  try {
    await expireEndedAssignments();
    const { moduleId, sessionId, slotKey } = req.body;
    const userId = req.user.user_id;
    if (!moduleId) {
      return res.status(400).json({ error: 'moduleId is required.' });
    }

    const student = await User.findOne({ user_id: userId, role: 'student' }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    const assignment = await LabAssignment.findOne({
      activeModule: moduleId,
      status: 'active',
      ...(slotKey ? { slotKey } : {}),
      $or: [
        { targetBatch: { $in: [null, ''] } },
        { targetBatch: student.batch || '' },
      ],
    }).populate('activeModule').lean();

    if (!assignment || !assignment.activeModule) {
      return res.status(404).json({ error: 'No active assignment found for this module.' });
    }
    if (assignment.targetBatch && assignment.targetBatch !== student.batch) {
      return res.status(403).json({ error: 'This module is not assigned to your batch.' });
    }
    const now = new Date();
    const existingAttempt = await TestAttempt.findOne({
      userId: student.user_id,
      moduleId,
      slotKey: assignment.slotKey,
    });

    if (existingAttempt) {
      if (existingAttempt.endsAt <= now) {
        if (existingAttempt.status !== 'expired') {
          existingAttempt.status = 'expired';
          await existingAttempt.save();
        }
        return res.status(410).json({
          error: 'Your test time is over. You can re-enter only if staff adds extra time.',
        });
      }

      if (existingAttempt.status !== 'active') {
        existingAttempt.status = 'active';
        await existingAttempt.save();
      }

      const responseNow = new Date();
      return res.json({
        attempt: existingAttempt,
        serverTime: responseNow.toISOString(),
        remainingSeconds: Math.max(0, Math.floor((existingAttempt.endsAt.getTime() - responseNow.getTime()) / 1000)),
        totalSeconds: getAttemptTotalSeconds(existingAttempt),
      });
    }

    if (assignment.startsAt && new Date(assignment.startsAt) > now) {
      return res.status(403).json({
        error: `This lab session has not started yet. It opens at ${assignment.startTime || new Date(assignment.startsAt).toLocaleTimeString()}.`,
        startsAt: assignment.startsAt,
      });
    }

    if (assignment.endsAt && new Date(assignment.endsAt) <= now) {
      return res.status(410).json({ error: 'This lab session is no longer available.' });
    }

    const startedAt = now;
    const baseEndsAt = new Date(assignment.endsAt);

    const attempt = await TestAttempt.findOneAndUpdate(
      { userId: student.user_id, moduleId, slotKey: assignment.slotKey },
      {
        $setOnInsert: {
          userId: student.user_id,
          studentName: student.name,
          batch: student.batch || '',
          moduleId,
          slotKey: assignment.slotKey,
          sessionId: sessionId || '',
          startedAt,
          baseEndsAt,
          endsAt: baseEndsAt,
          status: 'active',
        },
      },
      { upsert: true, new: true }
    );

    if (attempt.endsAt <= new Date() && attempt.status === 'active') {
      attempt.status = 'expired';
      await attempt.save();
      return res.status(410).json({
        error: 'Your test time is over. You can re-enter only if staff adds extra time.',
      });
    }

    const responseNow = new Date();
    res.json({
      attempt,
      serverTime: responseNow.toISOString(),
      remainingSeconds: Math.max(0, Math.floor((attempt.endsAt.getTime() - responseNow.getTime()) / 1000)),
      totalSeconds: getAttemptTotalSeconds(attempt),
    });
  } catch (err) {
    console.error('[sessions] start test attempt error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/test-attempts', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { moduleId, slotKey, batch } = req.query;
    const filter = {};
    if (moduleId) filter.moduleId = moduleId;
    if (slotKey) filter.slotKey = slotKey;
    if (batch) filter.batch = batch;

    const attempts = await TestAttempt.find(filter).sort({ batch: 1, userId: 1 }).lean();
    res.json(attempts);
  } catch (err) {
    console.error('[sessions] list test attempts error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/test-attempts/extend', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { moduleId, slotKey, batch, userIds, extraMinutes } = req.body;
    const minutes = Number(extraMinutes);
    if (!moduleId || !slotKey || !Number.isFinite(minutes) || minutes <= 0) {
      return res.status(400).json({ error: 'moduleId, slotKey, and positive extraMinutes are required.' });
    }

    const filter = { moduleId, slotKey };
    const ids = Array.isArray(userIds)
      ? userIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (ids.length) filter.userId = { $in: ids };
    if (!ids.length && batch) filter.batch = batch;

    const attempts = await TestAttempt.find(filter);
    const now = new Date();
    for (const attempt of attempts) {
      attempt.extraMinutes = (attempt.extraMinutes || 0) + minutes;
      const extensionBase = attempt.endsAt && attempt.endsAt > now ? attempt.endsAt : now;
      attempt.endsAt = new Date(extensionBase.getTime() + minutes * 60 * 1000);
      if (attempt.status === 'expired' && attempt.endsAt > new Date()) {
        attempt.status = 'active';
      }
      await attempt.save();
    }

    res.json({ success: true, updatedCount: attempts.length });
  } catch (err) {
    console.error('[sessions] extend attempts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all active sessions
router.get('/active', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    // Find sessions created within the last 24 hours
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const sessions = await Session.aggregate([
      { $match: { createdAt: { $gte: oneDayAgo } } },
      { $group: {
          _id: "$sessionId",
          name: { $first: "$sessionId" },
          createdAt: { $first: "$createdAt" },
          studentCount: { $sum: 1 }
        }
      },
      { $sort: { createdAt: -1 } }
    ]);
    
    res.status(200).json(sessions);
  } catch (err) {
    console.error('Error fetching active sessions:', err);
    res.status(500).json({ error: err.message });
  }
});

// Assign a module to a session - compatible with LabEvaluationSystem's auth
router.post('/:sessionId/assign-module', protect, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { moduleId } = req.body;
    
    if (!moduleId) {
      return res.status(400).json({ error: 'Module ID is required' });
    }
    
    if (!mongoose.Types.ObjectId.isValid(moduleId)) {
      return res.status(400).json({ error: 'Invalid module ID format' });
    }
    
    // Check if the module exists
    const module = await CNModule.findById(moduleId)
      .populate('questions');
      
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }
    
    // Check if the session exists
    const sessions = await Session.find({ sessionId });
    if (sessions.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Update all sessions with this sessionId to have the active module
    const updateResult = await Session.updateMany(
      { sessionId },
      { 
        $set: { 
          activeModule: moduleId,
          moduleAssignedAt: new Date() 
        } 
      }
    );
    
    // Return success with update information
    res.status(200).json({ 
      success: true,
      message: 'Module assigned successfully',
      sessionId,
      moduleId,
      moduleName: module.name,
      studentCount: sessions.length
    });
  } catch (err) {
    console.error('Error assigning module to session:', err);
    res.status(500).json({ error: err.message });
  }
});

// Quick update module and propagate to active sessions - with auth
router.patch('/modules/:id/quick-update', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid module ID format' });
    }
    
    // If user info is available, log who made the change
    if (req.user) {
      console.log(`Module ${id} quick-updated by user ${req.user.name} (${req.user.user_id})`);
    }
    
    // Validate allowed update fields
    const allowedUpdates = ['name', 'description', 'maxMarks'];
    const updateKeys = Object.keys(updates);
    const isValidOperation = updateKeys.every(key => allowedUpdates.includes(key));
    
    if (!isValidOperation) {
      return res.status(400).json({ error: 'Invalid updates. Only name, description, and maxMarks can be quick-updated.' });
    }
    
    // Update the module
    const updatedModule = await CNModule.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    );
    
    if (!updatedModule) {
      return res.status(404).json({ error: 'Module not found' });
    }
    
    // In a real implementation, here you would:
    // 1. Find all active sessions using this module
    // 2. Push updates to connected students
    
    /* Example implementation:
    const sessionsWithModule = await Session.find({ activeModule: id });
    // Push updates to these sessions
    */
    
    res.status(200).json({ 
      message: 'Module updated and changes propagated',
      module: updatedModule
    });
  } catch (err) {
    console.error('Error quick-updating module:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get the currently assigned module (global, slot-aware — see labSession.js).
// :sessionId is accepted for URL/back-compat but no longer used to look up
// the assignment, since it's now a single global record rather than
// per-session.
router.get('/:sessionId/current-module', requireAuth, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { moduleId } = req.query;
    const student = await User.findOne({ user_id: userId, role: 'student' }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const visibleAssignments = await getStudentVisibleAssignments(student);
    const assignment = moduleId
      ? visibleAssignments.find((item) => item.activeModule?._id?.toString() === moduleId)
      : visibleAssignments[0];
    if (!assignment || !assignment.activeModule) {
      return res.status(404).json({ error: 'No module is currently assigned' });
    }

    const response = typeof assignment.activeModule.toObject === 'function'
      ? assignment.activeModule.toObject()
      : { ...assignment.activeModule };
    response.assignment = {
      assignmentId: assignment._id,
      slotKey: assignment.slotKey,
      targetBatch: assignment.targetBatch,
      startTime: assignment.startTime || assignment.activeModule?.startTime || '',
      endTime: assignment.endTime || assignment.activeModule?.endTime || '',
      startsAt: assignment.startsAt,
      assignedAt: assignment.assignedAt,
      endsAt: assignment.endsAt,
    };

    const questionIds = (response.questions || []).map((q) => q._id || q);
    const schedule = buildQuestionSchedule(response, questionIds);
    const scheduleById = new Map(schedule.map((s) => [s.question, s]));
    const now = new Date();

    if (Array.isArray(response.questions)) {
      response.questions = response.questions.map((q) => {
        const obj = typeof q.toObject === 'function' ? q.toObject() : { ...q };
        const entry = scheduleById.get((obj._id || obj).toString());
        const availableAt = entry?.availableAt || response.startTime || '09:00';
        const availableAtDate = entry?.availableAtDate;
        return {
          ...obj,
          availableAt,
          isAvailable: isQuestionAvailable({ availableAtDate }, now),
        };
      });
    }

    res.status(200).json(response);
  } catch (err) {
    console.error('Error fetching current module:', err);
    res.status(500).json({ error: err.message });
  }
});

// Check if the globally-assigned module has changed (or expired out of the
// current slot) since the client last loaded it.
router.get('/:sessionId/check-module-update', requireAuth, async (req, res) => {
  try {
    const { currentModuleId } = req.query;

    if (!currentModuleId) {
      return res.status(400).json({ error: 'Current module ID is required' });
    }

    const student = await User.findOne({ user_id: req.user.user_id, role: 'student' }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const assignment = (await getStudentVisibleAssignments(student))[0];
    const activeModuleId = assignment?.activeModule?._id?.toString() || null;
    const hasUpdate = activeModuleId !== currentModuleId;

    res.status(200).json({
      hasUpdate,
      currentModuleId: activeModuleId
    });
  } catch (err) {
    console.error('Error checking for module update:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
