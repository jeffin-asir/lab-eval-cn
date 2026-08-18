import express from 'express';
import Batch from '../models/Batch.js';
import User from '../models/User.js';
import PasswordResetRequest from '../models/PasswordResetRequest.js';
import SessionDisconnectRequest from '../models/SessionDisconnectRequest.js';
import StudentConnection from '../models/StudentConnection.js';
import { revokeStudentConnection } from '../utils/studentConnections.js';
import { authorize, requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth, authorize('faculty', 'admin'));

function parseStudents(value) {
  if (Array.isArray(value)) {
    return value
      .map((student) => {
        if (typeof student === 'object' && student) {
          const id = String(student.id || student.user_id || '').trim();
          return id ? { id, name: String(student.name || id).trim() } : null;
        }
        const id = String(student).trim();
        return id ? { id, name: id } : null;
      })
      .filter(Boolean);
  }

  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const students = [];
  for (const line of lines) {
    if (line.includes(',')) {
      const [rawId, ...nameParts] = line.split(',');
      const id = rawId.trim();
      const name = nameParts.join(',').trim() || id;
      if (id) students.push({ id, name });
      continue;
    }

    line.split(/\s+/)
      .map((id) => id.trim())
      .filter(Boolean)
      .forEach((id) => students.push({ id, name: id }));
  }

  return students;
}

router.get('/', async (req, res) => {
  try {
    const batches = await Batch.find({}).sort({ name: 1 }).lean();
    res.json(batches);
  } catch (err) {
    console.error('[batches] list error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, defaultPassword, studentIds } = req.body;
    const batchName = String(name || '').trim().toUpperCase();
    const parsedStudents = parseStudents(studentIds);
    const ids = parsedStudents.map((student) => student.id);

    if (!batchName) return res.status(400).json({ error: 'Batch name is required.' });
    if (!defaultPassword) return res.status(400).json({ error: 'Default password is required.' });
    if (!ids.length) return res.status(400).json({ error: 'At least one student ID is required.' });

    const batch = await Batch.findOneAndUpdate(
      { name: batchName },
      { name: batchName, defaultPassword, studentIds: ids },
      { upsert: true, new: true, runValidators: true }
    );

    const ops = parsedStudents.map((student) => ({
      updateOne: {
        filter: { user_id: student.id },
        update: {
          $setOnInsert: {
            user_id: student.id,
            roll_number: student.id,
            password: defaultPassword,
            role: 'student',
            mustChangePassword: true,
          },
          $set: {
            name: student.name,
            batch: batchName,
          },
        },
        upsert: true,
      },
    }));

    if (ops.length) await User.bulkWrite(ops);

    res.status(201).json({ success: true, batch });
  } catch (err) {
    console.error('[batches] create error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/students', async (req, res) => {
  try {
    const filter = { role: 'student' };
    if (req.query.batch) filter.batch = req.query.batch;
    const students = await User.find(filter)
      .select('name user_id roll_number batch mustChangePassword')
      .sort({ batch: 1, roll_number: 1 })
      .lean();
    res.json(students);
  } catch (err) {
    console.error('[batches] students error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/students/:userId', async (req, res) => {
  try {
    const { name, password, mustChangePassword, batch } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (password) update.password = password;
    if (mustChangePassword !== undefined) update.mustChangePassword = !!mustChangePassword;
    if (batch !== undefined) update.batch = String(batch).trim().toUpperCase();

    const student = await User.findOneAndUpdate(
      { user_id: req.params.userId, role: 'student' },
      update,
      { new: true }
    ).select('name user_id roll_number batch mustChangePassword');

    if (!student) return res.status(404).json({ error: 'Student not found.' });

    if (batch !== undefined) {
      await Batch.updateMany({}, { $pull: { studentIds: student.user_id } });
      if (student.batch) {
        await Batch.findOneAndUpdate(
          { name: student.batch },
          { $addToSet: { studentIds: student.user_id } },
          { upsert: true, new: true }
        );
      }
    }

    res.json({ success: true, student });
  } catch (err) {
    console.error('[batches] update student error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/students/:userId', async (req, res) => {
  try {
    const student = await User.findOneAndDelete({
      user_id: req.params.userId,
      role: 'student',
    });

    if (!student) return res.status(404).json({ error: 'Student not found.' });

    await Batch.updateMany(
      {},
      { $pull: { studentIds: student.user_id } }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[batches] delete student error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/password-reset-requests', async (req, res) => {
  try {
    const requests = await PasswordResetRequest.find({ status: 'pending' }).sort({ createdAt: -1 }).lean();
    res.json(requests);
  } catch (err) {
    console.error('[batches] password reset list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Used by the teacher header to surface actionable requests from every
// teacher page, without having to first navigate to Batches & Students.
router.get('/pending-requests', async (req, res) => {
  try {
    const [passwordResets, sessionDisconnects] = await Promise.all([
      PasswordResetRequest.find({ status: 'pending' }).sort({ createdAt: -1 }).lean(),
      SessionDisconnectRequest.find({ status: 'pending' }).sort({ createdAt: -1 }).lean(),
    ]);
    res.json({ passwordResets, sessionDisconnects });
  } catch (err) {
    console.error('[batches] pending request notifications error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/password-reset-requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const update = { status };
    if (status === 'approved') update.approvedAt = new Date();

    const request = await PasswordResetRequest.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!request) return res.status(404).json({ error: 'Request not found.' });

    res.json({ success: true, request });
  } catch (err) {
    console.error('[batches] password reset update error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/session-disconnect-requests', async (req, res) => {
  try {
    const requests = await SessionDisconnectRequest.find({ status: 'pending' }).sort({ createdAt: -1 }).lean();
    res.json(requests);
  } catch (err) {
    console.error('[batches] session disconnect list error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/session-disconnect-requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const request = await SessionDisconnectRequest.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { $set: { status, approvedAt: status === 'approved' ? new Date() : null } },
      { new: true }
    );
    if (!request) return res.status(404).json({ error: 'Pending request not found.' });

    if (status === 'approved') {
      const connections = await StudentConnection.find({ userId: request.userId, revokedAt: null });
      const { closeStudentSocketsForConnection } = await import('../controllers/sshController.js');
      await Promise.all(connections.map(async (connection) => {
        await revokeStudentConnection(connection.sessionId, 'disconnected after teacher approval');
        closeStudentSocketsForConnection(connection.sessionId);
      }));
    }
    res.json({ success: true, request });
  } catch (err) {
    console.error('[batches] session disconnect update error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
