// index.js
import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import apiRoutes from './routes/index.js';
import { initSSHWebSocket } from './controllers/sshController.js';
import { connectDB, disconnectDB } from './utils/db.js'; 
import { startSSHPoolReaper } from './utils/sshConnectionPool.js';
import Session from './models/Session.js';
import { docker } from './docker/dockerManager.js';

dotenv.config();

let sessionReconciliationInProgress = false;

async function reconcileStoredSessions(source = 'startup') {
  if (sessionReconciliationInProgress) {
    console.log('[session-reconcile] skipped; previous run is still in progress');
    return;
  }
  sessionReconciliationInProgress = true;
  try {
    const sessions = await Session.find({}).select('containerName sshPort').lean();
    let updated = 0;
    let removed = 0;

    // Reconcile stored records after a restart without starting containers.
    // Starting every historical workspace here would exhaust the host and undo
    // the benefit of retaining stopped containers/volumes.
    const reconcileOne = async (session) => {
      try {
        const inspect = await docker.getContainer(session.containerName).inspect();
        const sshPort = Number.parseInt(inspect.NetworkSettings?.Ports?.['22/tcp']?.[0]?.HostPort
          || inspect.HostConfig?.PortBindings?.['22/tcp']?.[0]?.HostPort
          || '0', 10);
        if (sshPort > 0 && sshPort !== session.sshPort) {
          await Session.updateOne({ _id: session._id }, { $set: { sshPort } });
          updated += 1;
        }
      } catch (err) {
        if (err.statusCode === 404) {
          await Session.deleteOne({ _id: session._id });
          removed += 1;
        } else {
          console.warn(`[session-reconcile:${source}] could not reconcile ${session.containerName}: ${err.message}`);
        }
      }
    };

    // A bounded amount of parallelism prevents a long startup with hundreds of
    // records without overwhelming Docker with hundreds of inspect requests.
    const RECONCILE_CONCURRENCY = 10;
    for (let index = 0; index < sessions.length; index += RECONCILE_CONCURRENCY) {
      await Promise.all(sessions.slice(index, index + RECONCILE_CONCURRENCY).map(reconcileOne));
    }
    console.log(`[session-reconcile:${source}] reconciled ${sessions.length} session records (${updated} updated, ${removed} removed)`);
  } finally {
    sessionReconciliationInProgress = false;
  }
}

function startSessionReconciliationJob() {
  const INTERVAL_MS = 30 * 60 * 1000;
  setInterval(() => {
    reconcileStoredSessions('scheduled').catch((err) => {
      console.error('[session-reconcile] scheduled run failed:', err);
    });
  }, INTERVAL_MS);
  console.log('[session-reconcile] scheduled every 30 minutes');
}

// Node kills the whole process on an unhandled promise rejection by default
// (and always has for a thrown exception outside any handler). With ~50
// students' terminal WebSockets all served by this one process, that means
// one unguarded rejection anywhere in the codebase disconnects everyone
// simultaneously, not just the request that caused it. Log and survive
// instead — a single bad request shouldn't take the whole lab down.
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL-GUARD] Unhandled promise rejection (process kept alive):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL-GUARD] Uncaught exception (process kept alive):', err);
});

const app = express();
const server = http.createServer(app);

// Only honour X-Forwarded-For when the deployment is explicitly configured
// behind one trusted reverse proxy. Otherwise that header is client-spoofable.
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

// Middlewares
const allowedOrigins = [
  "http://localhost:5173", 
  "http://10.16.16.107:5173",
  "http://10.5.1.4:5173",
  "http://192.168.137.131:5173",
  "http://10.5.1.122:5173",
  "http://192.168.138.181:5173",
  "http://10.5.2.250:5173",
  //"http://10.7.103.226:5173",
  //"http://10.5.12.254:5173",
  //"http://192.168.1.200:5173",
  //"http://10.21.68.19:5173"     //library
];

app.use(cors({
  origin : (origin, callback) => {
    const isLocalDev = /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+):\d+$/.test(origin || '');
    if(!origin || allowedOrigins.includes(origin) || isLocalDev){
      callback(null, true);
    }
    else{
      callback(new Error("Not Allowed by CORS."));
    }
  },
  credentials: true, 
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
// Make sure path is absolute to avoid any path resolution issues
app.use(express.static(path.join(process.cwd(), 'public')));
// Explicitly serve uploads directory
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

// REST API routes
app.use('/api', apiRoutes);

// Initialize SSH WebSocket handler (handles /ws/ssh upgrades)
initSSHWebSocket(server);

// Graceful shutdown handler for DB
process.on('SIGINT', async () => {
  console.log('\nCaught SIGINT, shutting down...');
  await disconnectDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nCaught SIGTERM, shutting down...');
  await disconnectDB();
  process.exit(0);
});

const PORT = process.env.PORT || 5001;

async function startServer() {
  await connectDB();
  await reconcileStoredSessions('startup');
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
    startSSHPoolReaper();
    startSessionReconciliationJob();
  });
}

startServer().catch((err) => {
  console.error('[startup] failed:', err);
  process.exit(1);
});
