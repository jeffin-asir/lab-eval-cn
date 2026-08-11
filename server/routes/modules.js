import express from 'express';
import { CNModule } from '../models/Module.js';
import Course from '../models/Course.js';
import LabAssignment from '../models/LabAssignment.js';
import {
  parseTimeHHMM,
  resolveModuleTimes,
  buildQuestionSchedule,
  buildSlotKey,
} from '../utils/labSession.js';
import mongoose from 'mongoose';
import { protect, authorize, requireAuth } from '../middleware/auth.js';

const router = express.Router();

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

function normalizeQuestionSchedule(body, questionIds, defaultStartTime) {
  const raw = Array.isArray(body.questionSchedule) ? body.questionSchedule : [];
  const byId = new Map(
    raw.map((entry) => [
      String(entry.question || entry.questionId || ''),
      entry.availableAt || defaultStartTime,
    ])
  );

  return questionIds.map((qId) => ({
    question: qId,
    availableAt: parseTimeHHMM(byId.get(String(qId)) || defaultStartTime)?.display || defaultStartTime,
  }));
}

function buildModulePayload(body, questionIds) {
  const startTime = parseTimeHHMM(body.startTime)?.display || '09:00';
  const endTime = parseTimeHHMM(body.endTime)?.display || '12:00';

  return {
    name: body.name,
    description: body.description,
    lab: body.lab,
    course: body.course,
    questions: questionIds,
    creator: body.creator,
    creatorId: body.creatorId,
    maxMarks: body.maxMarks,
    date: body.date || new Date(),
    startTime,
    endTime,
    time: `${startTime} – ${endTime}`,
    questionSchedule: normalizeQuestionSchedule(body, questionIds, startTime),
    targetBatch: body.targetBatch || '',
    envSettings: body.envSettings || {
      allowTabSwitch: false,
      allowExternalCopyPaste: false,
      allowInternalCopyPaste: true,
      enforceFullscreen: false,
    },
    moduleType: 'CNModule',
  };
}

// Create a module - with auth
router.post('/', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { questions } = req.body;

    if (!questions || questions.length === 0) {
      return res.status(400).json({ error: 'At least one question must be selected.' });
    }

    try {
      const startTime = parseTimeHHMM(req.body.startTime)?.display || '09:00';
      const endTime = parseTimeHHMM(req.body.endTime)?.display || '12:00';
      buildSlotKey(req.body.date || new Date(), startTime, endTime, '000000000000000000000000');
    } catch (timeErr) {
      return res.status(400).json({ error: timeErr.message });
    }

    const moduleData = buildModulePayload(req.body, questions);
    const newModule = await CNModule.create(moduleData);
    res.status(201).json(newModule);
  } catch (err) {
    console.error('Module creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all modules - with auth protection
router.get('/', protect, async (req, res) => {
  try {
    const { course } = req.query;
    const filter = course ? { course: mongoose.Types.ObjectId(course) } : {};

    const modules = await CNModule.find(filter)
      .populate('questions')
      .populate('course', 'name code semester');

    res.status(200).json(modules);
  } catch (err) {
    console.error('Error fetching modules:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/active-assignments', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    await expireEndedAssignments();
    const assignments = await LabAssignment.find({
      status: 'active',
      activeModule: { $ne: null },
      $or: [{ endsAt: null }, { endsAt: { $gt: new Date() } }],
    })
      .populate('activeModule', 'name date startTime endTime targetBatch maxMarks')
      .sort({ assignedAt: -1 })
      .lean();

    res.json(assignments.map((assignment) => ({
      _id: assignment._id,
      key: assignment.key,
      moduleId: assignment.activeModule?._id,
      moduleName: assignment.activeModule?.name || 'Module',
      slotKey: assignment.slotKey,
      targetBatch: assignment.targetBatch || '',
      startTime: assignment.startTime || assignment.activeModule?.startTime || '',
      endTime: assignment.endTime || assignment.activeModule?.endTime || '',
      startsAt: assignment.startsAt,
      assignedAt: assignment.assignedAt,
      endsAt: assignment.endsAt,
      status: assignment.status,
    })));
  } catch (err) {
    console.error('Error fetching active assignments:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid module ID' });
    }

    const module = await CNModule.findById(id)
      .populate('questions')
      .populate('course', 'name code semester');

    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    res.status(200).json(module);
  } catch (err) {
    console.error('Error fetching module:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, lab, questions, maxMarks, date, targetBatch, startTime, endTime, questionSchedule } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid module ID' });
    }

    if (!questions || questions.length === 0) {
      return res.status(400).json({ error: 'At least one question must be selected.' });
    }

    const resolvedStart = parseTimeHHMM(startTime)?.display || '09:00';
    const resolvedEnd = parseTimeHHMM(endTime)?.display || '12:00';

    try {
      resolveModuleTimes({
        date: date || new Date(),
        _id: id,
        startTime: resolvedStart,
        endTime: resolvedEnd,
        questions,
      });
    } catch (timeErr) {
      return res.status(400).json({ error: timeErr.message });
    }

    const updatedModule = await CNModule.findByIdAndUpdate(
      id,
      {
        name,
        description,
        lab,
        questions,
        maxMarks,
        date: date || new Date(),
        startTime: resolvedStart,
        endTime: resolvedEnd,
        time: `${resolvedStart} – ${resolvedEnd}`,
        questionSchedule: normalizeQuestionSchedule({ questionSchedule }, questions, resolvedStart),
        targetBatch: targetBatch || '',
      },
      { new: true, runValidators: true }
    );

    if (!updatedModule) {
      return res.status(404).json({ error: 'Module not found' });
    }

    res.status(200).json(updatedModule);
  } catch (err) {
    console.error('Module update error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid module ID' });
    }

    const deletedModule = await CNModule.findByIdAndDelete(id);

    if (!deletedModule) {
      return res.status(404).json({ error: 'Module not found' });
    }

    res.status(200).json({ message: 'Module deleted successfully' });
  } catch (err) {
    console.error('Module deletion error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/quick-update', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid module ID' });
    }

    const allowedUpdates = ['name', 'description', 'maxMarks'];
    const updateKeys = Object.keys(updates);
    const isValidOperation = updateKeys.every((key) => allowedUpdates.includes(key));

    if (!isValidOperation) {
      return res.status(400).json({
        error: 'Invalid updates. Only name, description, and maxMarks can be quick-updated during a lab session.',
      });
    }

    const updatedModule = await CNModule.findByIdAndUpdate(id, updates, { new: true, runValidators: true });

    if (!updatedModule) {
      return res.status(404).json({ error: 'Module not found' });
    }

    res.status(200).json({
      message: 'Module updated successfully',
      module: updatedModule,
    });
  } catch (err) {
    console.error('Quick module update error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:moduleId/assign-to-test-session', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    await expireEndedAssignments();
    const { moduleId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(moduleId)) {
      return res.status(400).json({ error: 'Invalid module ID format' });
    }

    const module = await CNModule.findById(moduleId);
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    const targetBatch = req.body.targetBatch ?? module.targetBatch ?? '';
    const assignedAt = new Date();

    let times;
    try {
      times = resolveModuleTimes({
        ...module.toObject(),
        _id: moduleId,
        startTime: req.body.startTime ?? module.startTime,
        endTime: req.body.endTime ?? module.endTime,
        date: module.date,
      });
    } catch (timeErr) {
      return res.status(400).json({ error: timeErr.message });
    }

    const { startTime, endTime, startsAt, endsAt, slotKey } = times;
    const assignmentKey = `${moduleId}_${slotKey}_${targetBatch || 'all'}`;

    await LabAssignment.findOneAndUpdate(
      { key: assignmentKey },
      {
        key: assignmentKey,
        activeModule: moduleId,
        slotKey,
        targetBatch,
        startTime,
        endTime,
        startsAt,
        endsAt,
        assignedAt,
        status: 'active',
      },
      { upsert: true, new: true }
    );

    res.status(200).json({
      success: true,
      message: `Module assigned for ${startTime} – ${endTime} on ${times.moduleDate.toLocaleDateString()}`,
      moduleId,
      moduleName: module.name,
      slot: slotKey,
      targetBatch,
      startTime,
      endTime,
      startsAt,
      endsAt,
    });
  } catch (err) {
    console.error('Error assigning module for testing:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/active-assignment/clear', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { assignmentId, all } = req.body || {};
    if (all) {
      await LabAssignment.updateMany({ status: 'active' }, { $set: { status: 'ended' } });
    } else if (assignmentId) {
      await LabAssignment.findByIdAndUpdate(assignmentId, { $set: { status: 'ended' } });
    } else {
      await LabAssignment.findOneAndUpdate({ key: 'global' }, { $set: { status: 'ended' } });
    }
    res.status(200).json({ success: true, message: 'Active module assignment cleared' });
  } catch (err) {
    console.error('Error clearing active assignment:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:moduleId/questions', async (req, res) => {
  try {
    const { moduleId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(moduleId)) {
      return res.status(400).json({ error: 'Invalid module ID format' });
    }

    const module = await CNModule.findById(moduleId).populate('questions');

    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    const schedule = buildQuestionSchedule(
      module.toObject(),
      module.questions.map((q) => q._id)
    );
    const scheduleById = new Map(schedule.map((s) => [s.question, s]));

    const questionsWithSchedule = module.questions.map((q) => {
      const obj = typeof q.toObject === 'function' ? q.toObject() : q;
      const entry = scheduleById.get(obj._id.toString());
      return {
        ...obj,
        availableAt: entry?.availableAt || module.startTime || '09:00',
      };
    });

    res.status(200).json(questionsWithSchedule);
  } catch (err) {
    console.error('Error fetching module questions:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
