import { Router } from 'express';
import EvaluationRun from '../models/EvaluationRun.js';
import { runAndEvaluate } from '../controllers/sshController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

async function handleEvaluation(req, res, runType) {
  try {
    console.log("1. handleEvaluation entered");
    const {
      sessionId,
      moduleId,
      questionId,
      tagPaths = {},
      sourceFiles = {},
    } = req.body;

    if (!questionId) {
      return res.status(400).json({ error: 'questionId is required' });
    }
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    if (runType === 'submit' && String(sessionId).startsWith('PRACTICE_')) {
      return res.status(403).json({ error: 'Practice sessions are evaluation-only and cannot be submitted.' });
    }
    if (!tagPaths || Object.keys(tagPaths).length === 0) {
      return res.status(400).json({ error: 'tagPaths is required (tag -> absolute file path)' });
    }

    if (!req.user || req.user.role !== 'student') {
      return res.status(403).json({ error: 'Only students can run evaluations' });
    }

    console.log("2. before runAndEvaluate");

    const wantsStream = req.query.stream === '1';

    if (wantsStream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
    }

    // Evaluators can produce many small SSH chunks. Streaming them all makes
    // the browser repeatedly re-render a huge terminal and can freeze Safari.
    // Preserve enough diagnostic output while keeping the live response safe.
    let streamedLogChars = 0;
    let logWasTruncated = false;
    const MAX_STREAMED_LOG_CHARS = 160_000;
    const sendLog = wantsStream
      ? (event) => {
        const message = String(event?.message || '');
        const remaining = MAX_STREAMED_LOG_CHARS - streamedLogChars;
        if (remaining <= 0) {
          if (!logWasTruncated) {
            logWasTruncated = true;
            res.write(`${JSON.stringify({ event: 'log', type: 'notice', message: '\n[Live output truncated; evaluation is still running.]\n' })}\n`);
          }
          return;
        }
        const safeMessage = message.slice(0, remaining);
        streamedLogChars += safeMessage.length;
        res.write(`${JSON.stringify({ event: 'log', ...event, message: safeMessage })}\n`);
      }
      : undefined;

    const result = await runAndEvaluate({
      userId: req.user.user_id,
      studentName: req.user.name,
      sessionId,
      moduleId,
      questionId,
      tagPaths,
      sourceFiles,
      runType,
      // Practice feedback is visible only in the current workspace.
      persistRun: !String(sessionId).startsWith('PRACTICE_'),
      onLog: sendLog,
    });

    console.log("3. after runAndEvaluate");
    if (wantsStream) {
      res.write(`${JSON.stringify({ event: 'done', success: true, result })}\n`);
      res.end();
    } else {
      res.json({ success: true, ...result });
    }
    console.log("4. response sent");
  } catch (err) {
    console.error(`[API] evaluation/${runType} error:`, err);
    if (req.query.stream === '1' && !res.headersSent) {
      res.status(500);
    }
    if (req.query.stream === '1') {
      res.write(`${JSON.stringify({ event: 'error', error: err.message })}\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
}

router.post('/run', requireAuth, (req, res) => handleEvaluation(req, res, 'evaluate'));

router.post('/submit', requireAuth, (req, res) => handleEvaluation(req, res, 'submit'));

router.get('/results', async (req, res) => {
  try {
    const { userId, sessionId, questionId, runType } = req.query;
    if (!userId || !sessionId) {
      return res.status(400).json({ error: 'userId and sessionId are required' });
    }

    const query = { userId, sessionId };
    if (questionId) query.questionId = questionId;
    if (runType) query.runType = runType;

    const runs = await EvaluationRun.find(query).sort({ createdAt: -1 }).limit(20);
    res.json(runs);
  } catch (err) {
    console.error('[API] evaluation/results error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
