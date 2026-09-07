import express from 'express';
import StudentAnnouncement from '../models/StudentAnnouncement.js';
import User from '../models/User.js';
import { authorize, requireAuth } from '../middleware/auth.js';
import { isAdmin, teacherBatches } from '../utils/teacherScope.js';

const router = express.Router();

router.get('/mine', requireAuth, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student authentication is required.' });
  const announcements = await StudentAnnouncement.find({ userId: req.user.user_id, dismissedAt: null })
    .sort({ createdAt: 1 }).limit(25).lean();
  res.json(announcements);
});

router.post('/:id/dismiss', requireAuth, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student authentication is required.' });
  const result = await StudentAnnouncement.updateOne(
    { _id: req.params.id, userId: req.user.user_id, dismissedAt: null },
    { $set: { dismissedAt: new Date() } }
  );
  if (!result.matchedCount) return res.status(404).json({ error: 'Announcement not found.' });
  res.json({ success: true });
});

router.post('/', requireAuth, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    const type = req.body?.type;
    const target = req.body?.target;
    const batch = String(req.body?.batch || '').trim().toUpperCase();
    const selectedIds = [...new Set((req.body?.studentIds || []).map((id) => String(id).trim()).filter(Boolean))];
    if (!message) return res.status(400).json({ error: 'Message is required.' });
    if (!['notification', 'alert'].includes(type)) return res.status(400).json({ error: 'Choose notification or alert.' });
    if (!['all', 'batch', 'students'].includes(target)) return res.status(400).json({ error: 'Choose recipients.' });
    if (target === 'batch' && !batch) return res.status(400).json({ error: 'Choose a batch.' });
    if (target === 'students' && !selectedIds.length) return res.status(400).json({ error: 'Choose at least one student.' });

    const filter = { role: 'student' };
    if (target === 'batch') filter.batch = batch;
    if (target === 'students') filter.user_id = { $in: selectedIds };
    if (!isAdmin(req.user)) {
      const allowedBatches = teacherBatches(req.user);
      if (target === 'batch' && !allowedBatches.includes(batch)) return res.status(403).json({ error: 'That batch is not assigned to you.' });
      filter.batch = target === 'batch' ? batch : { $in: allowedBatches };
    }

    const recipients = await User.find(filter).select('user_id').lean();
    if (!recipients.length) return res.status(404).json({ error: 'No matching students found.' });
    await StudentAnnouncement.insertMany(recipients.map((student) => ({
      userId: student.user_id, message, type, sentBy: req.user.user_id,
    })));
    res.status(201).json({ success: true, recipientCount: recipients.length });
  } catch (err) {
    console.error('[announcements] send error:', err);
    res.status(500).json({ error: err.message || 'Could not send announcement.' });
  }
});

export default router;
