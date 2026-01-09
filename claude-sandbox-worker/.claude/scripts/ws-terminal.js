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
 */

const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = 8081;

const wss = new WebSocketServer({ port: PORT });

console.log(`[ws-terminal] WebSocket terminal server listening on port ${PORT}`);
console.log('[ws-terminal] PTY support enabled - Claude Code will work');

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
      // Ensure node can find global modules for any Node.js commands
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
      // Input data - write to PTY
      shell.write(payload);
    } else if (cmd === '1') {
      // Resize command - apply to PTY
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
  console.error('[ws-terminal] Server error:', err);
});

console.log('[ws-terminal] Ready for connections');
