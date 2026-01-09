# Sandbox IDE WebSocket Terminal Fix

## Overview
Fixed the WebSocket terminal in Sandbox IDE which connected successfully but received no data. The fix involved creating a custom WebSocket terminal server with **node-pty** for proper PTY support, enabling Claude Code TUI to work correctly.

**Final Status: COMPLETE** - Terminal works with full PTY support including:
- Proper terminal size detection ($COLUMNS returns actual width)
- Claude Code TUI renders correctly
- No "no job control" warnings
- Resize events propagate to shell

## Context
- **Problem/Requirement**: The Sandbox IDE terminal connected (101 WebSocket upgrade) but displayed no output - bidirectional communication wasn't working.
- **Initial State**: Using ttyd as the WebSocket terminal server, but wsConnect() wasn't properly piping data regardless of path configuration.
- **Approach**: Deep-dived into SDK documentation, identified ttyd path requirements, then pivoted to a custom WebSocket server that accepts connections on any path.

## Changes Made

### 1. Custom WebSocket Terminal Server
- **Description**: Created a new ws-terminal.js script using Node.js `ws` package instead of ttyd binary
- **Files Created**:
  - `claude-sandbox-worker/.claude/scripts/ws-terminal.js` - Custom WebSocket server
- **Key Points**:
  - Uses `ws` package WebSocketServer for connection handling
  - Uses `child_process.spawn` to create bash shell (not pty since node-pty isn't available)
  - Implements ttyd protocol: '0' prefix for input/output, '1' for resize
  - Accepts WebSocket connections on any path (unlike ttyd which requires /ws)

### 2. Handler Updates for Process Management
- **Description**: Added port liveness checking to detect and restart crashed processes
- **Files Modified**:
  - `claude-sandbox-worker/src/handlers/ide.ts` - Terminal handler logic
- **Key Points**:
  - Added NODE_PATH=/usr/local/lib/node_modules so Node.js can find globally installed `ws`
  - Added `nc -z localhost 8081` check before proxying
  - If process exists but port not listening, kill stale process and restart
  - Changed endpoint from /terminal to /ws to match common WebSocket conventions

### 3. Docker Configuration
- **Description**: Added ws package to container
- **Files Modified**:
  - `claude-sandbox-worker/Dockerfile` - Added npm install -g ws
- **Rationale**: ws package provides a simple, reliable WebSocket server without libwebsockets complexity

### 4. Diagnostic Improvements
- **Description**: Added ws module and terminal script tests to diagnostics
- **Files Modified**:
  - `claude-sandbox-worker/src/handlers/diag.ts` - Added wsModuleTest, wsTerminalTest, wsTerminalRun

## Code Examples

### Custom WebSocket Terminal Server
```javascript
// claude-sandbox-worker/.claude/scripts/ws-terminal.js
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');

const PORT = 8081;
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  const shell = spawn('bash', ['-i'], {
    cwd: '/workspace',
    env: {
      ...process.env,
      HOME: '/home/claude',
      TERM: 'xterm-256color',
    },
  });

  // ttyd protocol: '0' prefix for output
  shell.stdout.on('data', (data) => {
    ws.send('0' + data.toString());
  });

  ws.on('message', (msg) => {
    const cmd = msg.toString()[0];
    const payload = msg.toString().slice(1);
    if (cmd === '0') shell.stdin.write(payload); // Input
  });
});
```

### Port Liveness Check
```typescript
// claude-sandbox-worker/src/handlers/ide.ts
// Check if port 8081 is actually listening
const portCheck = await sandbox.exec(
  "nc -z localhost 8081 && echo 'LISTENING' || echo 'NOT_LISTENING'",
  { timeout: 5000 }
);
const isListening = portCheck.stdout.includes("LISTENING") &&
                   !portCheck.stdout.includes("NOT_LISTENING");

// If process exists but port isn't listening, it crashed - kill and restart
if (wsTerminalProcess && !isListening) {
  await sandbox.exec(`kill -9 ${wsTerminalProcess.pid}`);
}

// Start with NODE_PATH so ws module can be found
const wsTerminal = await sandbox.startProcess(
  "node /home/claude/.claude/scripts/ws-terminal.js",
  {
    env: {
      NODE_PATH: "/usr/local/lib/node_modules",
      // ... other env vars
    },
  }
);
```

## Verification Results

### Production Testing
```
Terminal connects to: wss://claude-sandbox-worker.samuel-hagman.workers.dev/ws
Console logs show:
- [IDE] Terminal status: connected
- [Terminal] Received: string 0bash: cannot set terminal process group...
- [Terminal] Received: string 0]0;claude@cloudchamber: /workspace...
```

### Manual Testing
- [x] Terminal shows "Connected" status (green dot)
- [x] Bash prompt displayed: `claude@cloudchamber:/workspace$`
- [x] Input works: typed `ls` and pressed Enter
- [x] Output received: `CLAUDE.md`, `files`, `node_modules`
- [x] New prompt appeared after command execution

### Diagnostic Verification
```json
{
  "wsModuleTest": {
    "exitCode": 0,
    "stdout": "ws version: OK"
  },
  "wsTerminalRun": {
    "exitCode": 0,
    "stdout": "[ws-terminal] WebSocket terminal server listening on port 8081\n[ws-terminal] Ready for connections\nExit code: 124"
  }
}
```

## Issues Encountered & Solutions

### Issue 1: ttyd Path Mismatch
**Problem**: ttyd expects WebSocket at /ws path, but our endpoint was /terminal
**Solution**: Changed endpoint to /ws, but ttyd still had issues with wsConnect()

### Issue 2: ttyd + wsConnect Data Pipe Failure
**Problem**: Even with correct path, WebSocket upgrade succeeded but no data flowed
**Solution**: Created custom ws-terminal.js server using `ws` package that accepts any path

### Issue 3: ws Module Not Found
**Error**:
```
ProcessExitedBeforeReadyError: Process exited with code 1 before becoming ready
```
**Solution**: Added `NODE_PATH=/usr/local/lib/node_modules` to startProcess env

### Issue 4: Stale Process Detection
**Problem**: Handler saw crashed process as "running" and didn't restart it
**Solution**: Added port 8081 liveness check with `nc -z` before proxying

## Phase 2: PTY Support (2026-01-09)

### Problem
After Phase 1, basic terminal I/O worked but:
- Lines appeared at random positions (shell defaulted to 80 columns)
- `claude` command hung (isatty() returned false)
- "bash: no job control" warnings appeared

### Root Cause
`spawn()` creates pipes, not a PTY. Claude Code requires a proper PTY for:
- `isatty()` to return true
- Terminal size info via TIOCGWINSZ ioctl
- SIGWINCH signal handling for resize

### Solution
Added node-pty to replace spawn():

**Dockerfile changes:**
```dockerfile
# Build dependencies for native node modules
RUN apt-get update && apt-get install -y build-essential python3 && rm -rf /var/lib/apt/lists/*

# Install ws + node-pty
RUN npm install -g ws node-pty
```

**ws-terminal.js rewrite:**
```javascript
const pty = require('node-pty');

const shell = pty.spawn('bash', [], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: '/workspace',
  env: {
    HOME: '/home/claude',
    TERM: 'xterm-256color',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  },
});

// Resize now works!
shell.resize(columns, rows);
```

### Verification Results (Chrome DevTools MCP)

| Test | Expected | Result |
|------|----------|--------|
| Clean prompt | No warnings | ✅ PASS |
| `echo $COLUMNS` | >80 (actual width) | ✅ PASS (120) |
| `ls -la` formatting | Aligned columns | ✅ PASS |
| Claude Code launch | TUI appears | ✅ PASS |
| Theme selection | Interactive menu | ✅ PASS |
| OAuth flow | Shows login URL | ✅ PASS |

### Screenshots
- Terminal connected without warnings
- Claude Code ASCII art logo rendered correctly
- Theme selection menu with 6 options displayed
- OAuth login URL properly line-wrapped

## Next Steps
- [x] ~~Consider adding node-pty to Dockerfile for full PTY support~~ DONE
- [ ] Add terminal reconnection handling in frontend
- [ ] Consider session persistence for terminal state across reconnects

## Notes
- node-pty requires build-essential and python3 for native compilation
- ANTHROPIC_API_KEY must be passed through startProcess env for `claude` command
- Claude Code's OAuth flow catches Ctrl+C - this is expected behavior, not a terminal bug

## References
- Cloudflare Sandbox SDK documentation: wsConnect(), startProcess()
- ttyd source code analysis for protocol understanding
- ws npm package: https://www.npmjs.com/package/ws
- node-pty: https://github.com/microsoft/node-pty
