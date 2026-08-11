import { Router } from 'express';
import { exec } from 'child_process';
import pingRoute from './ping.js';
import questionsRoute from './questions.js';
import submissionRoute from './submission.js';
import filesRoute from './file.js';
import moduleRoutes from './modules.js';
import sessionsRoute from './sessions.js';
import evaluationRoute from './evaluation.js';
import coursesRoute from './courses.js';
import performanceRoute from './performance.js';
import authRoute from './auth.js';
import batchesRoute from './batches.js';
import dockerRoute from './docker.js';
import mongoDbRoute from './mongodb.js';
import { ensureSessionContainer, saveFileToContainer } from '../controllers/sshController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use('/ping', pingRoute);
router.use('/questions', questionsRoute);
router.use('/submission', submissionRoute);
router.use('/evaluation', evaluationRoute);
router.use('/file',filesRoute);
router.use('/modules', moduleRoutes);
router.use('/sessions', sessionsRoute);
router.use('/courses', coursesRoute);
router.use('/performance', performanceRoute);
router.use('/auth', authRoute);
router.use('/batches', batchesRoute);
router.use('/docker', dockerRoute);
router.use('/mongodb', mongoDbRoute);

async function renameFileInContainer({ userId, oldPath, newPath, sessionId = null }) {
  const { containerName } = await ensureSessionContainer(userId, sessionId);
  const cmd = `mv "${oldPath}" "${newPath}"`;

  return new Promise((resolve, reject) => {
    exec(`docker exec ${containerName} sh -c '${cmd}'`, (err, stdout, stderr) => {
      if (err) {
        console.error('Rename failed:', stderr || err);
        return reject(new Error(stderr || err.message));
      }
      resolve();
    });
  });
}

// Save file to container
router.post('/save-file', requireAuth, async (req, res) => {
  try {
    // console.log('[API] save-file received:', req.body);
    const { filename, filePath, code, sessionId } = req.body;
    const userId = req.user.user_id;

    if (!filename || !code) return res.status(400).json({ error: 'Missing filename or code' });
    console.log(filePath)
    await saveFileToContainer({ userId, filename, filePath, code, sessionId });
    console.log('[API] save-file completed successfully');
    res.json({ success: true });
  } catch (err) {
    console.error('[API] save-file error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/rename-file', requireAuth, async (req, res) => {
  try {
    const { oldPath, newPath, sessionId } = req.body;
    const userId = req.user.user_id;
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'Missing oldPath or newPath' });
    }

    await renameFileInContainer({ userId, oldPath, newPath, sessionId });

    console.log(`[API] Renamed file inside container for ${userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] rename-file error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
