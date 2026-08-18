import { WebSocketServer } from 'ws';
import { Client } from 'ssh2';
import fs from 'fs';
import { PassThrough } from 'stream';
import dotenv from 'dotenv';
import Session from '../models/Session.js';
import { createContainerForUser, docker, normalizeSessionId, buildLabResourceName } from '../docker/dockerManager.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { Question } from '../models/Question.js';
import EvaluationRun from '../models/EvaluationRun.js';
import { getPooledConnection, evictPooledConnection } from '../utils/sshConnectionPool.js';
import {
  EVAL_DIR,
  buildStudentSh,
  parseEvaluatedCsv,
  parseConnCsv,
  parseStatusCsv,
  toApiResults,
} from '../utils/evaluationHelper.js';
import LabAssignment from '../models/LabAssignment.js';
import User from '../models/User.js';
import { getUserFromRequest } from '../middleware/auth.js';

dotenv.config();

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sessions = {}; // session socket key => { conn, stream, ws, userId, sessionId, terminalId }

// Teacher-driven revocation must also terminate an already-open terminal;
// otherwise an interactive shell could remain usable until the tab reloads.
export function closeStudentSocketsForConnection(connectionId) {
  Object.entries(sessions).forEach(([socketKey, session]) => {
    if (session.connectionId !== connectionId) return;
    session.ended = true;
    if (session.detachTimer) clearTimeout(session.detachTimer);
    try { session.ws?.close(4001, 'Session disconnected by teacher'); } catch (_) {}
    try { session.stream?.end(); } catch (_) {}
    try { session.conn?.end(); } catch (_) {}
    delete sessions[socketKey];
  });
}

function isChannelOpenFailure(err) {
  return err?.reason === 2 || /Channel open failure|open failed/i.test(err?.message || '');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function closeSftp(sftp) {
  try {
    sftp?.end?.();
  } catch (_) {
    /* already closed */
  }
}

function isTransientSshStartupError(err) {
  return (
    err?.level === 'client-authentication' ||
    /All configured authentication methods failed|ECONNREFUSED|ECONNRESET|Timed out while waiting for handshake/i.test(err?.message || '')
  );
}

function connectSshClient({ sshPort, username, privateKeyPath, label }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;

    conn.on('ready', () => {
      settled = true;
      resolve(conn);
    })
    .on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      } else {
        console.error(`[SSH] ${label} connection error:`, err);
      }
    })
    .connect({
      host: '127.0.0.1',
      port: sshPort,
      username,
      privateKey: fs.readFileSync(privateKeyPath),
      readyTimeout: 10000,
    });
  });
}

async function connectSshWithRetry(config, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await connectSshClient(config);
    } catch (err) {
      lastError = err;
      if (!isTransientSshStartupError(err) || attempt === attempts) break;
      const delay = Math.min(250 * attempt, 1500);
      console.warn(`[SSH] ${config.label} not ready on port ${config.sshPort}; retrying in ${delay}ms (${attempt}/${attempts})`);
      await wait(delay);
    }
  }
  throw lastError;
}

async function createSSHConnection(userId, sshPortOverride = null, requestedSessionId = null) {
  const activeSession = sshPortOverride
    ? null
    : await ensureSessionContainer(userId, requestedSessionId);
  const session = sshPortOverride
    ? await Session.findOne({ userId }).sort({ createdAt: -1 })
    : await Session.findOne({ userId, sessionId: activeSession.sessionId });
  console.log("[SSH] Session found:", session);
  if (!session && !sshPortOverride) throw new Error('No active session for user');
  const sshPort = sshPortOverride || session.sshPort;
  const poolKey = `labuser:${sshPort}`;

  // One labuser connection is reused across autosaves/exec calls for the
  // same container instead of a fresh SSH handshake per call — see
  // utils/sshConnectionPool.js for why this matters at scale.
  const conn = await getPooledConnection(poolKey, () => connectSshWithRetry({
    sshPort,
    username: 'labuser',
    privateKeyPath: './labuser_key',
    label: 'labuser',
  }));
  conn.__poolKey = poolKey;
  return conn;
}

/**
 * A dedicated, non-pooled labuser connection for the interactive terminal.
 * Deliberately NOT routed through the shared pool: a terminal shell's
 * connection lifecycle is tied 1:1 to its WebSocket (it's ended the moment
 * the tab closes), whereas the pool exists for short-lived, fire-and-forget
 * operations (autosave, exec, evaluate) that outlive any single request. If
 * these shared a connection, closing a terminal tab would kill an
 * in-flight autosave on the same container.
 */
function createLabuserConnection(sshPort) {
  return connectSshWithRetry({
    sshPort,
    username: 'labuser',
    privateKeyPath: './labuser_key',
    label: 'terminal labuser',
  });
}

// How often the server pings each open terminal socket. Sending a ping frame
// is real traffic on the connection, which is what actually matters here: it
// resets the idle timer on any NAT/firewall/proxy sitting between the
// browser and this server, which would otherwise silently kill a socket that
// has gone quiet (e.g. nobody typing for a while). Without this, the
// connection can die with no close frame on either side, and the terminal
// only notices once it tries to write and fails.
const HEARTBEAT_INTERVAL_MS = 25_000;

// How long a shell is kept alive, unattached, after its WebSocket drops
// (network blip, tab backgrounded, brief Wi-Fi loss, etc.) before it's torn
// down for real. This is what stops a dropped socket from killing whatever
// the student had running (a server blocked on accept(), a long test, etc.):
// if they reconnect within this window, they resume the exact same shell
// instead of getting a fresh one.
const DETACH_GRACE_PERIOD_MS = 45_000;

// Cap on how much output we buffer for a detached (no ws attached) session,
// so a chatty or runaway process can't grow this unbounded while nobody's
// listening. Measured in characters of terminal output.
const MAX_BUFFERED_OUTPUT_CHARS = 200_000;

function bufferSessionOutput(session, chunk) {
  session.outputBuffer = (session.outputBuffer || '') + chunk;
  if (session.outputBuffer.length > MAX_BUFFERED_OUTPUT_CHARS) {
    session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFERED_OUTPUT_CHARS);
  }
}

// Send terminal output to whichever ws is currently attached; if none is
// (the socket dropped but the shell is still in its grace period), buffer it
// instead of dropping it on the floor so a reconnect can replay it.
function emitSessionData(session, output) {
  if (session.ws && session.ws.readyState === session.ws.OPEN) {
    session.ws.send(JSON.stringify({ type: 'data', data: output }));
  } else {
    bufferSessionOutput(session, output);
  }
}

function clearDetachTimer(session) {
  if (session.detachTimer) {
    clearTimeout(session.detachTimer);
    session.detachTimer = null;
  }
}

// Called once the shell process itself has actually ended (student typed
// `exit`, SSH connection died for real, etc.) — as opposed to just the
// WebSocket dropping. There's nothing to reattach to anymore, so clean up
// immediately rather than waiting out the grace period.
function endSession(session) {
  if (session.ended) return;
  session.ended = true;
  clearDetachTimer(session);
  emitEndMessage(session);
  try { session.conn.end(); } catch (_) { /* already closed */ }
  if (sessions[session.socketKey] === session) delete sessions[session.socketKey];
  Session.updateOne(
    { userId: session.userId, sessionId: session.sessionId },
    { $pull: { activeSockets: session.terminalId } }
  ).catch((err) => console.error('[SSH WS] Failed to clear activeSockets on session end:', err.message));
}

function emitEndMessage(session) {
  if (session.ws && session.ws.readyState === session.ws.OPEN) {
    session.ws.send(JSON.stringify({ type: 'end' }));
  }
}

// A WebSocket dropped, but the shell may still be perfectly healthy — start
// (or restart) the grace-period countdown before tearing the shell down.
function scheduleDetachCleanup(session) {
  clearDetachTimer(session);
  session.detachTimer = setTimeout(() => {
    if (sessions[session.socketKey] !== session) return; // already reattached or replaced
    console.log(`[SSH WS] No reconnect within ${DETACH_GRACE_PERIOD_MS / 1000}s for ${session.socketKey}; tearing down shell`);
    try { session.stream.end(); } catch (_) { /* already closed */ }
    endSession(session);
  }, DETACH_GRACE_PERIOD_MS);
}

// Wires a (possibly new) ws up to an existing shell session — used both for
// the very first connection and for a reconnect that lands inside the grace
// period. Replays any output the shell produced while detached.
function attachWsToSession(ws, session) {
  clearDetachTimer(session);
  session.ws = ws;

  if (session.outputBuffer) {
    ws.send(JSON.stringify({ type: 'data', data: session.outputBuffer }));
    session.outputBuffer = '';
  }

  ws.on('message', (message) => {
    try {
      const { type, data, cols, rows } = JSON.parse(message);
      if (type === 'input') {
        session.stream.write(data);
      } else if (type === 'resize') {
        session.stream.setWindow(rows, cols, 600, 800);
      }
    } catch (err) {
      console.error('[WS] Invalid message format:', err);
    }
  });

  ws.on('close', () => {
    // If this session has since been reattached to a newer ws, or force-
    // closed elsewhere (teacher revocation, student exiting the lab), this
    // stale ws's close is a no-op — that path already did its own cleanup.
    if (session.ended || sessions[session.socketKey] !== session || session.ws !== ws) return;
    console.warn(`[SSH WS] ${session.socketKey} disconnected; keeping shell alive for ${DETACH_GRACE_PERIOD_MS / 1000}s in case of reconnect`);
    session.ws = null;
    scheduleDetachCleanup(session);
  });
}

async function startTeacherDockerShell(ws, request) {
  let stream = null;
  let exec = null;
  let pendingResize = null;
  let resolveInitialResize;
  const initialResize = new Promise((resolve) => { resolveInitialResize = resolve; });
  const applyResize = ({ cols, rows }) => {
    pendingResize = { cols, rows };
    resolveInitialResize?.();
    resolveInitialResize = null;
    if (!exec) return;
    exec.resize({ w: Math.max(1, Number(cols) || 80), h: Math.max(1, Number(rows) || 24) })
      .catch((err) => console.error('[Docker shell] resize failed:', err.message));
  };
  // Register this before Docker creates the exec stream. The browser sends its
  // initial xterm dimensions immediately on WebSocket open; without queuing
  // it, Bash keeps Docker's 80-column default and Tab completion wraps oddly.
  ws.on('message', (message) => {
    try {
      const { type, data, cols, rows } = JSON.parse(message);
      if (type === 'input' && stream) stream.write(data);
      if (type === 'resize') applyResize({ cols, rows });
    } catch (err) { console.error('[Docker shell] invalid websocket message:', err.message); }
  });
  ws.on('close', () => { try { stream?.end(); } catch (_) {} });
  try {
    const teacher = await getUserFromRequest(request, ['faculty', 'admin']);
    if (!teacher || !['faculty', 'admin'].includes(teacher.role)) throw new Error('Teacher authentication is required.');
    const containerId = String(ws.query.containerId || '');
    if (!containerId) throw new Error('Container ID is required.');
    const shellUser = ws.query.shellUser === 'root' ? 'root' : 'networklab';
    const container = docker.getContainer(containerId);
    const inspect = await container.inspect();
    if (!inspect.State?.Running) throw new Error('Start the container before opening a Bash shell.');
    // Do not start Bash with Docker's 80-column default. Waiting a short time
    // for the browser's first xterm resize gives readline/Tab completion the
    // correct geometry from its very first prompt.
    await Promise.race([initialResize, wait(750)]);
    const initialCols = Math.max(1, Number(pendingResize?.cols) || 80);
    const initialRows = Math.max(1, Number(pendingResize?.rows) || 24);
    exec = await container.exec({
      User: shellUser, Cmd: ['bash', '-l'], AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true,
      ConsoleSize: [initialRows, initialCols],
    });
    stream = await exec.start({ hijack: true, stdin: true });
    // ConsoleSize covers modern Docker engines; resize explicitly as well for
    // engines that only apply terminal dimensions after ExecStart.
    await exec.resize({ w: initialCols, h: initialRows });
    // Docker exec sends stdout/stderr over one multiplexed stream. Passing
    // that stream straight to xterm renders the final byte of each 8-byte
    // Docker frame header (the stray "t", "r", "\\" seen on Tab completion).
    // Demux it before forwarding terminal bytes to the browser.
    const terminalOutput = new PassThrough();
    docker.modem.demuxStream(stream, terminalOutput, terminalOutput);
    terminalOutput.on('data', (data) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data: data.toString('utf8') }));
    });
    stream.on('end', () => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'end' }));
    });
    stream.on('error', (err) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message: err.message }));
    });
  } catch (err) {
    console.error('[Docker shell] failed to start:', err.message);
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message: err.message }));
    ws.close();
  }
}

export function initSSHWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        // Didn't respond to the previous ping — treat as dead and force a
        // close so the client's onclose/reconnect logic kicks in promptly
        // instead of waiting on a TCP-level timeout that may never fire.
        return ws.terminate();
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (_) {
        /* socket already closing */
      }
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeat));

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;
    const query = Object.fromEntries(requestUrl.searchParams.entries());
    if (pathname === '/ws/ssh' || pathname === '/ws/docker-shell') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.query = query;
        ws.mode = pathname === '/ws/docker-shell' ? 'docker-shell' : 'student-shell';
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (ws, request) => {
    if (ws.mode === 'docker-shell') {
      await startTeacherDockerShell(ws, request);
      return;
    }
    const { terminalId = 'main', sessionId: requestedSessionId = null } = ws.query;

    // Browsers answer WS ping frames with a pong automatically — no
    // client-side change needed for this to work.
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    try {
      const user = await getUserFromRequest(request);
      if (!user || user.role !== 'student') {
        ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
        ws.close();
        return;
      }
      const userId = user.user_id;
      const connectionId = request.studentConnection?.sessionId;
      const { sshPort, sessionId } = await ensureSessionContainer(userId, requestedSessionId);
      const socketKey = `${userId}:${sessionId}:${terminalId}`;

      // Reconnecting within the grace period after a dropped socket: reuse
      // the still-running shell instead of starting a fresh one, so
      // whatever the student had running survives the blip.
      const existing = sessions[socketKey];
      if (existing && !existing.ended) {
        console.log(`[SSH WS] REATTACH: ${socketKey} rejoining existing shell (no new conn.shell() run)`);
        if (existing.ws && existing.ws.readyState === existing.ws.OPEN) {
          // A second connection came in while the old one still looks live
          // (e.g. a duplicate tab). Take over; the old socket's close
          // handler will see it's no longer the session's ws and no-op.
          try { existing.ws.close(); } catch (_) { /* already closing */ }
        }
        attachWsToSession(ws, existing);
        return;
      }

      console.log(`[SSH WS] NEW SHELL: ${socketKey} has no existing session — starting a fresh conn.shell()`);
      let conn;

      try {
        conn = await createLabuserConnection(sshPort);

        // Request shell with explicit PTY for interactive programs
        conn.shell({
          term: 'xterm-256color',
          cols: 240,
          rows: 20,
          width: 640,
          height: 480
        }, (err, stream) => {
          if (err) {
            return ws.send(JSON.stringify({ type: 'error', message: 'SSH Shell Error' }));
          }

          const session = {
            conn, stream, ws, userId, sessionId, terminalId, connectionId, socketKey,
            outputBuffer: '', detachTimer: null, ended: false,
          };
          sessions[socketKey] = session;

          stream.on('data', (data) => {
            emitSessionData(session, data.toString('utf8'));
          });

          stream.stderr?.on('data', (data) => {
            emitSessionData(session, data.toString('utf8'));
          });

          // The shell process itself ending (student typed `exit`, the SSH
          // channel died for real) — distinct from the ws just dropping.
          // Nothing to reattach to here, so clean up right away.
          stream.on('close', () => endSession(session));

          attachWsToSession(ws, session);
        });
      } catch (err) {
        if (conn) conn.end();
        throw err;
      }
    } catch (err) {
      console.error('[SSH WS] Failed to init session:', err.message);
      ws.send(JSON.stringify({ type: 'error', message: 'Failed to start lab session' }));
    }
  });
}

async function resolveContainerSessionId(userId, requestedSessionId = null) {
  const normalizedRequested = normalizeSessionId(requestedSessionId);
  if (normalizedRequested) return normalizedRequested;

  const student = await User.findOne({ user_id: userId, role: 'student' }).select('batch').lean();
  if (!student) return null;

  const assignment = await LabAssignment.findOne({
    status: 'active',
    $or: [
      { endsAt: null },
      { endsAt: { $gt: new Date() } },
    ],
    slotKey: { $nin: [null, ''] },
    $and: [
      {
        $or: [
          { targetBatch: { $in: [null, ''] } },
          { targetBatch: student.batch || '' },
        ],
      },
    ],
  }).lean();

  if (!assignment) return null;
  if (assignment.endsAt && new Date(assignment.endsAt) <= new Date()) return null;
  if (assignment.targetBatch && assignment.targetBatch !== student.batch) return null;

  return normalizeSessionId(assignment.slotKey);
}

export async function ensureSessionContainer(userId, requestedSessionId = null) {
  const resolvedSessionId = await resolveContainerSessionId(userId, requestedSessionId);
  const { containerName, sshPort, sessionId } = await createContainerForUser(userId, resolvedSessionId);

  let sessionDoc = await Session.findOne({ userId, sessionId });
  if (!sessionDoc) {
    await Session.create({
      userId,
      sessionId,
      containerName,
      sshPort,
      createdAt: new Date(),
      activeSockets: [],
    });
    console.log(`[Session DB] Created new session for ${userId} @ ${sessionId}`);
  } else if ((sessionDoc.containerName !== containerName) || (sessionDoc.sshPort !== sshPort)) {
    sessionDoc.containerName = containerName;
    sessionDoc.sshPort = sshPort;
    await sessionDoc.save();
    console.log(`[Session DB] Updated existing session for ${userId}`);
  }

  return { containerName, sshPort, sessionId };
}

export async function stopSessionContainer(userId, requestedSessionId) {
  const sessionId = normalizeSessionId(requestedSessionId);
  if (!sessionId) throw new Error('sessionId is required');

  const session = await Session.findOne({ userId, sessionId });
  const expectedContainerName = buildLabResourceName(userId, sessionId);
  const containerName = session?.containerName || expectedContainerName;

  for (const [socketKey, entry] of Object.entries(sessions)) {
    if (entry.userId === userId && entry.sessionId === sessionId) {
      entry.ended = true;
      if (entry.detachTimer) clearTimeout(entry.detachTimer);
      try {
        entry.ws?.close?.();
      } catch (_) {
        /* socket already closed */
      }
      try {
        entry.stream?.end?.();
      } catch (_) {
        /* stream already closed */
      }
      try {
        entry.conn?.end?.();
      } catch (_) {
        /* connection already closed */
      }
      delete sessions[socketKey];
    }
  }

  if (session?.sshPort) {
    evictPooledConnection(`labuser:${session.sshPort}`);
    evictPooledConnection(`networklab:${session.sshPort}`);
  }

  const containers = await docker.listContainers({ all: true });
  const match = containers.find((info) => {
    const names = (info.Names || []).map((name) => name.replace(/^\//, ''));
    return names.includes(containerName) || names.includes(expectedContainerName);
  });

  if (!match) {
    await Session.updateOne(
      { userId, sessionId },
      { $set: { activeSockets: [] } }
    );
    return {
      success: true,
      stopped: false,
      reason: 'container_not_found',
      sessionId,
      containerName,
      expectedContainerName,
    };
  }

  const container = docker.getContainer(match.Id);
  try {
    const inspect = await container.inspect();
    if (inspect.State?.Running) {
      await container.stop({ t: 3 });
    }
  } catch (err) {
    if (err.statusCode !== 304 && err.statusCode !== 404) throw err;
  }

  let finalInspect = null;
  try {
    finalInspect = await container.inspect();
    if (finalInspect.State?.Running) {
      await container.kill();
      finalInspect = await container.inspect();
    }
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }

  await Session.updateOne(
    { userId, sessionId },
    { $set: { activeSockets: [] } }
  );

  const stillRunning = !!finalInspect?.State?.Running;
  return {
    success: !stillRunning,
    stopped: !stillRunning,
    sessionId,
    containerName: match.Names?.[0]?.replace(/^\//, '') || containerName,
    state: finalInspect?.State?.Status || match.State,
  };
}

async function ensureDirectoryExists(sftp, remotePath) {
  const pathParts = remotePath.split('/').slice(0, -1);
  let currentPath = '';
  
  for (let i = 1; i < pathParts.length; i++) {
    currentPath += (currentPath.endsWith('/') ? '' : '/') + pathParts[i];
    await new Promise((resolve) => {
      sftp.mkdir(currentPath, { mode: 0o755 }, () => resolve());
    });
  }
}

/**
 * upload string to file in container
 */
async function uploadFileContent(userId, content, remotePath, sessionId = null, attempt = 1) {
  let conn;
  try {
    conn = await createSSHConnection(userId, null, sessionId);
    
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) {
          return reject(err);
        }
        
        ensureDirectoryExists(sftp, remotePath).then(() => {
          const writeStream = sftp.createWriteStream(remotePath);
          writeStream.on('close', () => {
            console.log(`[SFTP] File content written to ${remotePath}`);
            closeSftp(sftp);
            resolve();
          });
          writeStream.on('error', (err) => {
            console.error('[SFTP] WriteStream error:', err);
            closeSftp(sftp);
            reject(err);
          });
          writeStream.write(content);
          writeStream.end();
        }).catch(err => {
          closeSftp(sftp);
          reject(err);
        });
      });
    });
  } catch (err) {
    if (conn?.__poolKey && isChannelOpenFailure(err) && attempt < 3) {
      console.warn(`[SFTP] Channel open failed for ${conn.__poolKey}; evicting pooled connection and retrying (${attempt}/2).`);
      evictPooledConnection(conn.__poolKey);
      await wait(150 * attempt);
      return uploadFileContent(userId, content, remotePath, sessionId, attempt + 1);
    }
    throw err;
  }
}

/**
 * Save file to user's container via SFTP
 */
export async function saveFileToContainer({ userId, filePath, code, sessionId = null }) {
  // Normalize path
  const remotePath = filePath;
  return uploadFileContent(userId, code, remotePath, sessionId);
}

/**
 * Upload a local file to the container
 */
async function uploadLocalFile(userId, localPath, remotePath, attempt = 1) {
  let conn;
  try {
    conn = await createSSHConnection(userId);
    
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) {
          return reject(err);
        }
        
        ensureDirectoryExists(sftp, remotePath).then(() => {
          sftp.fastPut(localPath, remotePath, (err) => {
            closeSftp(sftp);
            if (err) {
              console.error('[SFTP] Upload error:', err);
              reject(err);
            } else {
              console.log(`[SFTP] File uploaded: ${localPath} → ${remotePath}`);
              resolve();
            }
          });
        }).catch(err => {
          closeSftp(sftp);
          reject(err);
        });
      });
    });
  } catch (err) {
    if (conn?.__poolKey && isChannelOpenFailure(err) && attempt < 3) {
      console.warn(`[SFTP] Channel open failed for ${conn.__poolKey}; evicting pooled connection and retrying upload (${attempt}/2).`);
      evictPooledConnection(conn.__poolKey);
      await wait(150 * attempt);
      return uploadLocalFile(userId, localPath, remotePath, attempt + 1);
    }
    throw err;
  }
}

/**
 * Execute a command in the user's container via SSH
 */
// async function execCmd(command, userId) {
//   const session = await Session.findOne({ userId }).sort({ createdAt: -1 });
//   if (!session) throw new Error('No active session for user');
//   const { sshPort } = session;

//   return execSSH(userId, command, sshPort);
// }

/**
 * Execute command via SSH and return stdout, stderr, and exit code
 */
async function execSSH(userId, command, sshPortOverride = null) {
  let conn;
  try {
    conn = await createSSHConnection(userId, sshPortOverride);
    
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      
      conn.exec(command, (err, stream) => {
        if (err) {
          return reject(err);
        }
        
        stream.on('data', (data) => {
          stdout += data.toString('utf8');
        });
        
        stream.stderr.on('data', (data) => {
          stderr += data.toString('utf8');
        });
        
        stream.on('close', (code) => {
          resolve({ stdout, stderr, exitCode: code });
        });
      });
    });
  } catch (err) {
    throw err;
  }
}

async function createNetworklabConnection(sshPort) {
  const poolKey = `networklab:${sshPort}`;
  const conn = await getPooledConnection(poolKey, () => connectSshWithRetry({
    sshPort,
    username: 'networklab',
    privateKeyPath: './networklab_key',
    label: 'networklab',
  }));
  conn.__poolKey = poolKey;
  return conn;
}

function uploadStringViaConn(conn, remotePath, content) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const ws = sftp.createWriteStream(remotePath);
      ws.on('close', () => {
        closeSftp(sftp);
        resolve();
      });
      ws.on('error', (err) => {
        closeSftp(sftp);
        reject(err);
      });
      ws.write(content ?? '');
      ws.end();
    });
  });
}

function execViaConn(conn, command, onLog) {
  console.log("EXEC START:", command);
  onLog?.({ type: 'stage', message: `$ ${command}` });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    conn.exec(command, (err, stream) => {
      if (err) {
        console.log("EXEC ERROR:", err);
        return reject(err);
      }

      console.log("CHANNEL OPEN");

      stream.on('data', (d) => {
        const chunk = d.toString();
        stdout += chunk;
        onLog?.({ type: 'stdout', message: chunk });
      });

      stream.stderr.on('data', (d) => {
        const chunk = d.toString();
        stderr += chunk;
        onLog?.({ type: 'stderr', message: chunk });
      });

      stream.on('exit', (code) => {
        console.log("EXIT:", code);
        onLog?.({ type: 'stage', message: `process exited with code ${code}` });
      });

      stream.on('end', () => {
        console.log("END");
      });

      stream.on('close', (code) => {
        console.log("CLOSE:", code);
        resolve({ stdout, stderr, exitCode: code });
      });
    });
  });
}

/**
 * Runs question-specific nice.sh inside networklab evaluation dir.
 * Generic framework scripts must already exist in the container image.
 */
export async function runAndEvaluate({
  userId,
  studentName = '',
  sessionId,
  moduleId,
  questionId,
  tagPaths = {},
  sourceFiles = {},
  runType = 'evaluate',
  onLog,
}) {
  console.log("========== ENTERED runAndEvaluate ==========");
  onLog?.({ type: 'stage', message: `Starting ${runType} for question ${questionId}` });
  const activeSession = await ensureSessionContainer(userId, sessionId);
  const session = await Session.findOne({ userId, sessionId: activeSession.sessionId });
  if (!session) throw new Error('No active session for user');

  const question = await Question.findById(questionId).lean();
  if (!question) throw new Error(`Question ${questionId} not found`);

  const questionKey = question.questionKey;
  const inputContent = question.input || '';
  const niceScript = question.niceScript;
  const testcasesJson = question.testcasesFile;
  if (!niceScript || !testcasesJson) {
    throw new Error('This question has no saved nice.sh or testcases.json. Open and save it once in the teacher editor to migrate it.');
  }
  const studentSh = buildStudentSh(userId, studentName);

  const conn = await createNetworklabConnection(session.sshPort);

  try {
    console.log("A writing nice.sh");
    onLog?.({ type: 'stage', message: 'Writing nice.sh' });
    await uploadStringViaConn(conn, `${EVAL_DIR}/nice.sh`, niceScript);
    console.log("B writing testcase");
    onLog?.({ type: 'stage', message: 'Writing testcases.json' });
    await uploadStringViaConn(conn, `${EVAL_DIR}/testcases.json`, testcasesJson);
    console.log("C upload input");
    onLog?.({ type: 'stage', message: 'Writing input file' });
    await uploadStringViaConn(conn, `${EVAL_DIR}/input`, inputContent);
    console.log("D upload student");
    onLog?.({ type: 'stage', message: 'Writing student.sh' });
    await uploadStringViaConn(conn, `${EVAL_DIR}/student.sh`, studentSh);

    /*
    console.log("E creating symlinks");
    onLog?.({ type: 'stage', message: 'Linking student source files' });
    const fileArgs = [];

    for (const [tag, filePath] of Object.entries(tagPaths)) {
      const ext = path.posix.extname(filePath);      // ".c", ".py", etc.
      const taggedName = `${tag}${ext}`;             // server1.c, client2.c

      await execViaConn(
        conn,
        `ln -sf "${filePath}" "${EVAL_DIR}/${taggedName}"`
      );

      fileArgs.push(`"${EVAL_DIR}/${taggedName}"`);
    }

    const args = fileArgs.join(' ');
    */
   
    // Instead of symlinks, copy the files to the evaluation directory
    console.log("E copying source files");
    onLog?.({ type: 'stage', message: 'Copying student source files' });

    const fileArgs = [];
    // tagPaths keys look like "s1", "s2", "c1", "c2", ... — group filenames
    // by whether the tag is a server (s*) or client (c*) role so nice.sh
    // gets them as two separate quoted args:
    //   bash nice.sh "server1.c server2.c" "client1.c client2.c"
    const serverFiles = [];
    const clientFiles = [];

    for (const [tag, filePath] of Object.entries(tagPaths)) {
      const fileName = path.posix.basename(filePath);

      await execViaConn(
        conn,
        `cp -f "${filePath}" "${EVAL_DIR}/${fileName}"`
      );

      fileArgs.push(`"${fileName}"`);

      const role = String(tag).trim().toLowerCase().charAt(0);
      if (role === 's') {
        serverFiles.push(fileName);
      } else if (role === 'c') {
        clientFiles.push(fileName);
      }
    }

    const args = fileArgs.join(' ');
    const serverArgs = `"${serverFiles.join(' ')}"`;
    const clientArgs = `"${clientFiles.join(' ')}"`;

    console.log("F chmod");
    await execViaConn(conn, `chmod +x ${EVAL_DIR}/nice.sh`, onLog);

    console.log("G running nice.sh");
    onLog?.({ type: 'stage', message: 'Running nice.sh' });
    const { stdout, stderr, exitCode } = await execViaConn(
      conn,
      `cd ${EVAL_DIR} && bash nice.sh ${serverArgs} ${clientArgs}; echo "__DONE__"; exit`,
      onLog
    );

    console.log("H nice.sh finished");
    console.log("stdout:");
    console.log(stdout);

    console.log("stderr:");
    console.log(stderr);

    console.log("exitCode:", exitCode);
    const csvPath = `${EVAL_DIR}/${userId}_evaluated.csv`;
    const connPath = `${EVAL_DIR}/${userId}_conn.csv`;
    const statusPath = `${EVAL_DIR}/${userId}_status.csv`;

    console.log("I reading csvs (evaluated, conn, status)");
    onLog?.({ type: 'stage', message: 'Reading evaluation CSV files' });
    const { stdout: csvContent } = await execViaConn(conn, `cat ${csvPath} 2>/dev/null || true`);
    const { stdout: connCsvContent } = await execViaConn(conn, `cat ${connPath} 2>/dev/null || true`);
    const { stdout: statusCsvContent } = await execViaConn(conn, `cat ${statusPath} 2>/dev/null || true`);

    console.log("J csv read");
    const communicationResults = parseEvaluatedCsv(csvContent, userId);
    const connResults = parseConnCsv(connCsvContent);
    const statusResults = parseStatusCsv(statusCsvContent);
    console.log("K parsing");
    const results = toApiResults(communicationResults);

    console.log("L saving mongodb");
    const assignment = moduleId
      ? await LabAssignment.findOne({
          activeModule: moduleId,
          status: 'active',
          $or: [
            { endsAt: null },
            { endsAt: { $gt: new Date() } },
          ],
        }).lean()
      : null;
    const runDoc = await EvaluationRun.create({
      userId,
      studentName,
      sessionId,
      moduleId,
      questionId,
      questionKey,
      runType,
      tagPaths,
      sourceFiles,
      communicationResults,
      connResults,
      statusResults,
      rawCsv: csvContent,
      stdout,
      stderr,
      exitCode,
      slotKey: assignment?.slotKey || null,
    });

    console.log("M returning");
    return {
      runId: runDoc._id,
      results,
      communicationResults,
      connResults,
      statusResults,
      stdout,
      stderr,
      exitCode,
    };
  } catch (err) {
    // A genuine failure here might mean the connection itself is bad
    // (container restarted mid-run, etc.) — evict it so the next attempt
    // gets a fresh connection instead of retrying against a dead one.
    evictPooledConnection(`networklab:${session.sshPort}`);
    throw err;
  }
}




/**
 * Runs the evaluation workflow: saves code, copies scripts, runs evaluation, fetches result CSVs.
 */
export async function runEvaluation(userId, questionId, serverCode, clientCode) {
  // * accept arrays for server and client files and update evaluation command to use the files from arrays *
  try {
    // Create or get container/session
    const { containerName } = await createContainerForUser(userId);

    // Save server and client code files
    await saveFileToContainer({ userId, filePath: '/home/labuser/evaluation/nserver.c', code: serverCode });
    await saveFileToContainer({ userId, filePath: '/home/labuser/evaluation/nclient.c', code: clientCode });

    // Copy evaluation scripts (kmam) to /home/labuser/kmam
    const localEvalpath = path.resolve(__dirname, '../../kmam');
    const remoteEvalpath = '/home/labuser/kmam';
    await execSSH(userId, `mkdir -p ${remoteEvalpath}`);
    
    // Recursively upload all files in kmam (simple implementation: upload each file)
    const files = fs.readdirSync(localEvalpath);
    for (const file of files) {
      const localFile = path.join(localEvalpath, file);
      const remoteFile = `${remoteEvalpath}/${file}`;
      if (fs.statSync(localFile).isFile()) {
        await uploadLocalFile(userId, localFile, remoteFile);
      }
      // to support subdirectories, add recursive logic here
    }

    // Run evaluation script (nice.sh)
    // not sure about how ordering of arguments is going to be done
    const evalCmd = `cd ${remoteEvalpath} && ./nice.sh "nserver.c" "nclient.c nclient.c nclient.c"`; 

    const { stdout, stderr } = await execSSH(userId, evalCmd);
    console.log(`Evaluation stdout:`, stdout);
    if (stderr) console.error(`Evaluation stderr:`, stderr);

    // Read result files
    const evaluatedCsv = await readFileFromContainer(userId, `${remoteEvalpath}/${userId}_evaluated.csv`);
    const connCsv = await readFileFromContainer(userId, `${remoteEvalpath}/${userId}_conn.csv`);
    const statusCsv = await readFileFromContainer(userId, `${remoteEvalpath}/${userId}_status.csv`);

    return {
      evaluated: evaluatedCsv,
      conn: connCsv,
      status: statusCsv
    };
  } catch (error) {
    console.error(`Error running evaluation for user ${userId}:`, error);
    throw error;
  }
}
// Helper: Read file content from container via SFTP
async function readFileFromContainer(userId, remotePath, attempt = 1) {
  let conn;
  try {
    conn = await createSSHConnection(userId);
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) {
          return reject(err);
        }
        let data = '';
        const stream = sftp.createReadStream(remotePath);
        stream.on('data', chunk => { data += chunk.toString(); });
        stream.on('end', () => {
          closeSftp(sftp);
          resolve(data);
        });
        stream.on('error', err => {
          closeSftp(sftp);
          reject(err);
        });
      });
    });
  } catch (err) {
    if (conn?.__poolKey && isChannelOpenFailure(err) && attempt < 3) {
      console.warn(`[SFTP] Channel open failed for ${conn.__poolKey}; evicting pooled connection and retrying read (${attempt}/2).`);
      evictPooledConnection(conn.__poolKey);
      await wait(150 * attempt);
      return readFileFromContainer(userId, remotePath, attempt + 1);
    }
    throw err;
  }
}
