#!/usr/bin/env node
/**
 * WebSocket Terminal Server with PTY Support
 *
 * Uses node-pty for proper terminal emulation:
 * - isatty() returns true (required for Claude Code TUI)
 * - Resize events work (terminal knows actual width/height)
 * - Job control works (no "no job control" warnings)
 *
 * Protocol (ttyd-compatible):
 * - '0' + data: stdin/stdout
 * - '1' + JSON: resize { columns, rows }
 *
 * Usage: node ws-terminal.js
 * Listens on port 8081
 *
 * This server stays running persistently and handles multiple
 * WebSocket connections. Each connection gets its own PTY shell.
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const fs = require('fs');
const net = require('net');

const PORT = 8081;
const PID_FILE = '/tmp/ws-terminal.pid';
const MAX_BIND_RETRIES = 5;
const BIND_RETRY_DELAY = 1000; // ms

console.log(`[ws-terminal] Starting WebSocket terminal server on port ${PORT}...`);
console.log(`[ws-terminal] PID: ${process.pid}`);

// Check if port is accepting connections
function isPortAcceptingConnections(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * Check if another healthy ws-terminal instance is running.
 *
 * IMPORTANT: We require BOTH conditions to be true before exiting:
 *   1. PID file process exists AND is alive (kill -0 succeeds)
 *   2. Port 8081 is accepting TCP connections
 *
 * This dual-check prevents false positives from:
 *   - Stale PID files from crashed processes
 *   - Ports in TIME_WAIT state after recent close
 *   - /diag or other endpoints that may have left partial state
 *
 * If either condition fails, we clean up and start a fresh server.
 *
 * @returns {boolean} true if healthy server exists (caller should exit)
 */
async function checkExistingServer() {
  // First, always clean up stale PID file if the process doesn't exist
  if (fs.existsSync(PID_FILE)) {
    try {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      console.log(`[ws-terminal] Found PID file with pid ${oldPid}`);

      let processExists = false;
      try {
        process.kill(oldPid, 0); // Signal 0 just checks if process exists
        processExists = true;
        console.log(`[ws-terminal] Process ${oldPid} exists`);
      } catch (e) {
        console.log(`[ws-terminal] Process ${oldPid} does not exist, removing stale PID file`);
        fs.unlinkSync(PID_FILE);
      }

      if (processExists) {
        // CRITICAL: Check BOTH process AND port before considering server healthy
        // A process may exist but be hung/dead (not listening on port)
        // A port may appear open briefly due to TIME_WAIT from previous connection
        const portOpen = await isPortAcceptingConnections(PORT);
        if (portOpen) {
          // BOTH conditions met: process alive AND port accepting connections
          // This is truly a healthy server - safe to exit and let existing instance handle
          console.log(`[ws-terminal] Port ${PORT} accepting connections and process ${oldPid} running - server healthy`);
          return true;
        } else {
          // Process exists but port not open - zombie/hung process, kill and restart
          console.log(`[ws-terminal] Process ${oldPid} exists but port not listening - killing it`);
          try {
            process.kill(oldPid, 'SIGKILL');
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (e) {
            console.log(`[ws-terminal] Could not kill ${oldPid}: ${e.message}`);
          }
          try { fs.unlinkSync(PID_FILE); } catch (e) {}
        }
      }
    } catch (e) {
      console.log(`[ws-terminal] Error handling PID file: ${e.message}`);
      try { fs.unlinkSync(PID_FILE); } catch (e2) {}
    }
  } else {
    // No PID file - check if something else is on the port (not our server)
    // This could be: another service, a stale socket in TIME_WAIT, etc.
    // We DON'T exit here because without our PID file, it's not our healthy server
    const portOpen = await isPortAcceptingConnections(PORT);
    if (portOpen) {
      console.log(`[ws-terminal] Port ${PORT} in use by unknown process (no PID file) - will try to bind anyway`);
      // Don't return true - let the bind retry logic handle EADDRINUSE
      // The port may free up during retries, or we'll fail after MAX_BIND_RETRIES
    }
  }

  return false;
}

// Write our PID file
function writePidFile() {
  fs.writeFileSync(PID_FILE, process.pid.toString());
  console.log(`[ws-terminal] Wrote PID file: ${PID_FILE}`);
}

// Try to bind with retries
async function tryBindWithRetries(server) {
  for (let attempt = 1; attempt <= MAX_BIND_RETRIES; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          server.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);

        // Only call listen on first attempt or after previous error
        if (attempt === 1 || !server.listening) {
          server.listen({ port: PORT, host: '0.0.0.0' });
        }
      });
      console.log(`[ws-terminal] HTTP server listening on port ${PORT} (attempt ${attempt})`);
      return true;
    } catch (err) {
      console.log(`[ws-terminal] Bind attempt ${attempt}/${MAX_BIND_RETRIES} failed: ${err.message}`);

      if (err.code === 'EADDRINUSE') {
        // Check if it's now a healthy server
        const healthy = await isPortAcceptingConnections(PORT);
        if (healthy) {
          console.log(`[ws-terminal] Another instance is now healthy on port ${PORT} - exiting`);
          process.exit(0);
        }

        if (attempt < MAX_BIND_RETRIES) {
          console.log(`[ws-terminal] Waiting ${BIND_RETRY_DELAY}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, BIND_RETRY_DELAY));
        }
      } else {
        throw err;
      }
    }
  }
  return false;
}

async function main() {
  // Check if a healthy server is already running
  if (await checkExistingServer()) {
    console.log(`[ws-terminal] Healthy server already running - exiting cleanly`);
    process.exit(0);
  }

  // Create HTTP server
  const server = http.createServer();

  // Try to bind with retries
  const bound = await tryBindWithRetries(server);
  if (!bound) {
    console.error(`[ws-terminal] Failed to bind after ${MAX_BIND_RETRIES} attempts`);
    process.exit(1);
  }

  writePidFile();

  // Create WebSocket server attached to HTTP server
  const wss = new WebSocketServer({ server });

  wss.on('listening', () => {
    console.log(`[ws-terminal] WebSocket server READY on port ${PORT}`);
  });

  wss.on('connection', (ws) => {
    console.log('[ws-terminal] Client connected');

    // Create PTY shell - proper terminal emulation
    const shell = pty.spawn('bash', [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/workspace',
      env: {
        HOME: '/home/claude',
        USER: 'claude',
        TERM: 'xterm-256color',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        NODE_PATH: '/usr/local/lib/node_modules',
      },
    });

    console.log(`[ws-terminal] PTY shell spawned, pid ${shell.pid}`);

    // PTY output → WebSocket (ttyd protocol: '0' prefix)
    shell.onData((data) => {
      if (ws.readyState === 1) {
        ws.send('0' + data);
      }
    });

    shell.onExit(({ exitCode, signal }) => {
      console.log(`[ws-terminal] Shell exited (code: ${exitCode}, signal: ${signal})`);
      if (ws.readyState === 1) {
        ws.close();
      }
    });

    // WebSocket → PTY
    ws.on('message', (msg) => {
      const str = msg.toString();
      const cmd = str[0];
      const payload = str.slice(1);

      if (cmd === '0') {
        shell.write(payload);
      } else if (cmd === '1') {
        try {
          const { columns, rows } = JSON.parse(payload);
          if (columns > 0 && rows > 0) {
            shell.resize(columns, rows);
            console.log(`[ws-terminal] Resized to ${columns}x${rows}`);
          }
        } catch (e) {
          console.error('[ws-terminal] Invalid resize payload:', payload);
        }
      }
    });

    ws.on('close', () => {
      console.log('[ws-terminal] Client disconnected');
      shell.kill();
    });

    ws.on('error', (err) => {
      console.error('[ws-terminal] WebSocket error:', err);
      shell.kill();
    });
  });

  wss.on('error', (err) => {
    console.error('[ws-terminal] WebSocket server error:', err.message);
  });

  // Clean up PID file on exit
  const cleanup = () => {
    try { fs.unlinkSync(PID_FILE); } catch (e) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  // Handle uncaught errors gracefully
  process.on('uncaughtException', (err) => {
    console.error('[ws-terminal] Uncaught exception:', err.message);
    cleanup();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[ws-terminal] Unhandled rejection:', reason);
  });

  console.log('[ws-terminal] Waiting for connections...');
}

main().catch((err) => {
  console.error('[ws-terminal] Fatal error:', err.message, err.stack);
  process.exit(1);
});
