import { Router } from 'express';
import Submission from '../models/Submission.js';
import { getActiveSessionForUser } from '../utils/sessionHelper.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/fetch', requireAuth, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const questionId = req.query.questionId;
    let sessionId = req.query.sessionId;

    if (!userId || !questionId) {
      return res.status(400).json({ error: 'userId and questionId are required' });
    }

    if (!sessionId) {
      try {
        const session = await getActiveSessionForUser(userId);
        sessionId = session.sessionId;
      } catch (err) {
        return res.status(400).json({ error: 'sessionId is required when no active lab session exists.' });
      }
    }

    const submissions = await Submission.find({ userId, questionId, sessionId }).sort({ createdAt: -1 });

    const formatted = submissions.map(sub => {
      const passed = sub.passedCount ?? 0;
      const total = sub.totalTestCases ?? 0;
      const accepted = total > 0 && passed === total;

      return {
        id: sub._id,
        status: accepted ? 'Accepted' : 'Wrong Answer',
        timestamp: new Date(sub.createdAt).toLocaleString(),
        sourceCode: sub.sourceCode,
        language: sub.language,
        passed: passed,
        total: total,
        sessionId: sub.sessionId,
        evaluationResults: sub.evaluationResults || [],
        evalError: sub.evalError || null,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error('[GET] /api/submission/fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});



// Save submission record after evaluation
router.post('/db', requireAuth, async (req, res) => {
  console.log("========== SUBMISSION ==========");
  console.log(req.body);
  try {
    const {
      questionId,
      sourceCode,
      language,
      passedCount = 0,
      totalTestCases = 0,
      evaluationResults = [],
      evalError = null,
      sessionId: requestedSessionId,
      moduleId,
      autoSubmitted = false,
      clientRequestId = null,
    } = req.body;
    const userId = req.user.user_id;

    if (!userId || !questionId) {
      return res.status(400).json({ error: 'userId and questionId are required' });
    }

    let sessionId = requestedSessionId;
    if (!sessionId) {
      const session = await getActiveSessionForUser(userId);
      sessionId = session.sessionId;
    }

    // If this exact attempt was already saved (a retry landed after the
    // original response was lost in transit), hand back that same
    // submission instead of creating a second row for one Submit click.
    if (clientRequestId) {
      const already = await Submission.findOne({ userId, clientRequestId });
      if (already) {
        return res.json({ success: true, submissionId: already._id });
      }
    }

    let submission;
    try {
      submission = await Submission.create({
        userId,
        questionId,
        sessionId,
        moduleId,
        sourceCode,
        language,
        passedCount,
        totalTestCases,
        evaluationResults,
        evalError,
        autoSubmitted,
        clientRequestId,
      });
    } catch (err) {
      // Duplicate key on (userId, clientRequestId): a concurrent retry beat
      // us to it. Treat it the same as the pre-check above.
      if (err?.code === 11000 && clientRequestId) {
        const already = await Submission.findOne({ userId, clientRequestId });
        if (already) return res.json({ success: true, submissionId: already._id });
      }
      throw err;
    }

    res.json({ success: true, submissionId: submission._id });
  } catch (err) {
    console.error('[POST] /api/submission/db error:', err);
    res.status(500).json({ error: err.message || 'Failed to save submission' });
  }
});

router.get('/has-submission', requireAuth, async (req, res) => {
  try {
    const { sessionId, moduleId } = req.query;
    const userId = req.user.user_id;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const filter = { userId, sessionId };
    if (moduleId) filter.moduleId = moduleId;

    const latest = await Submission.findOne(filter).sort({ createdAt: -1 }).lean();
    res.json({ hasSubmission: !!latest, latest });
  } catch (err) {
    console.error('[GET] /api/submission/has-submission error:', err);
    res.status(500).json({ error: 'Failed to check submissions' });
  }
});

// ========================= STUDENT ENDPOINTS =========================

router.post('/evaluate/:studentId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { questionId, serverCode, clientCode } = req.body;

    if (!userId || !questionId || !serverCode || !clientCode) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Run evaluation in container
    const resultFiles = await runEvaluation(userId, questionId, serverCode, clientCode);
    
    // Process and store results
    const submission = await processEvaluationResults(resultFiles);
    
    res.json({
      success: true,
      submissionId: submission._id,
      isBest: submission.isBestSubmission,
      score: submission.score,
      code: submission.sourceCode
    });
  } catch (err) {
    console.error('[API] /submission/evaluate error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Get all submissions for a student in the current session
router.get('/student-submissions/:studentId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const sessionId = req.query.sessionId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    if (!sessionId) return res.status(400).json({ error: 'sessionId query parameter is required' });
    // Return all submissions for this student in this session
    const submissions = await Submission.find({ userId, sessionId }).sort({ submittedAt: -1 });
    res.json(submissions);
  } catch (err) {
    console.error('[GET] /api/submission/student-submissions error:', err);
    res.status(500).json({ error: 'Failed to fetch student submissions' });
  }
});

// ========================= TEACHER ENDPOINTS =========================

// Get all best submissions for the current session (for teacher dashboard)
router.get('/best-submissions', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'sessionId query parameter is required' });
    // Return all best submissions for this session, grouped by userId
    const bestSubs = await Submission.find({ sessionId, isBestSubmission: true }).lean();
    const grouped = {};
    for (const sub of bestSubs) {
      if (!grouped[sub.userId]) grouped[sub.userId] = [];
      grouped[sub.userId].push(sub);
    }
    res.json(grouped);
  } catch (err) {
    console.error('[GET] /api/submission/best-submissions error:', err);
    res.status(500).json({ error: 'Failed to fetch best submissions' });
  }
});

// Export all best submissions as a CSV file (for teacher report download)
router.get('/export-best-csv', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (!sessionId) return res.status(400).send('sessionId query parameter is required');
    const bestSubs = await Submission.find({ sessionId, isBestSubmission: true }).lean();
    if (!bestSubs.length) return res.status(404).send('No submissions found');

    // Collect all rows from all evaluationResults, using the original evaluated.csv format
    let header = null;
    const rows = [];
    for (const sub of bestSubs) {
      if (Array.isArray(sub.evaluationResults) && sub.evaluationResults.length > 0) {
        if (!header) header = Object.keys(sub.evaluationResults[0]);
        for (const rec of sub.evaluationResults) {
          rows.push(header.map(h => (rec[h] !== undefined ? String(rec[h]).replace(/"/g, '""') : '')).join(','));
        }
      }
    }
    if (!header) return res.status(404).send('No evaluation results found');
    const csv = [header.join(',')].concat(rows).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="best_submissions.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[GET] /api/submission/export-best-csv error:', err);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

export default router;