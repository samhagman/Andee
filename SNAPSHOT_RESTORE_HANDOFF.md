# Snapshot Restore UI - E2E Test Handoff Document

**Created**: 2026-01-12T16:20:00Z
**Author**: Claude Code (Opus 4.5)
**Status**: UI Testing Complete, Backend Bug Found
**Priority**: Medium (UI works, backend needs fix for restore)

---

## Executive Summary

E2E testing of the Sandbox IDE snapshot restore UI was completed. **All UI components work correctly**. A backend bug was discovered where the restore operation fails when the sandbox session becomes stale. This document provides everything needed to continue the work.

---

## Timeline of Testing Session

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  TESTING SESSION TIMELINE (2026-01-12)                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  16:05:30  Started claude-sandbox-worker (port 8787)                         │
│            └─ Docker build completed, worker ready                           │
│                                                                              │
│  16:05:45  Started sandbox-ide (port 8791)                                   │
│            └─ Note: ports 8789-8790 were in use, used 8791                   │
│                                                                              │
│  16:06:00  Verified both services healthy                                    │
│            └─ curl http://localhost:8787/ → {"status":"ok"}                  │
│            └─ curl http://localhost:8791/ → 200 OK                           │
│                                                                              │
│  16:07:30  Created test sandbox (user 999999999)                             │
│            └─ POST /ask with message to create hello.txt                     │
│            └─ Created session via POST /session-update                       │
│                                                                              │
│  16:08:25  Created Snapshot A                                                │
│            └─ Key: snapshots/999999999/999999999/2026-01-12T16-08-25-790Z    │
│            └─ Size: 55,213 bytes                                             │
│            └─ Contents: hello.txt only                                       │
│                                                                              │
│  16:08:45  Added goodbye.txt via POST /ask                                   │
│                                                                              │
│  16:09:06  Created Snapshot B (LATEST)                                       │
│            └─ Key: snapshots/999999999/999999999/2026-01-12T16-09-06-014Z    │
│            └─ Size: 61,744 bytes                                             │
│            └─ Contents: hello.txt + goodbye.txt                              │
│                                                                              │
│  16:10:00  UI Testing with Chrome DevTools MCP                               │
│            ├─ ✅ Sandbox selector - selected TEST_USER_1                     │
│            ├─ ✅ Snapshot panel - showed 18 snapshots                        │
│            ├─ ✅ Preview Snapshot A - only hello.txt visible                 │
│            ├─ ✅ Preview toggle to Snapshot B - goodbye.txt appeared         │
│            ├─ ✅ Exit preview - returned to live filesystem                  │
│            └─ ✅ Restore confirmation modal - displayed correctly            │
│                                                                              │
│  16:19:12  Restore attempt FAILED                                            │
│            └─ rm -rf /workspace/* succeeded                                  │
│            └─ rm -rf /home/claude/* failed: "Unknown Error, TODO"            │
│            └─ Sandbox session had become stale                               │
│                                                                              │
│  16:20:00  Testing concluded, handoff document created                       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## What Was Tested

### Test Environment
- **Worker**: http://localhost:8787 (claude-sandbox-worker)
- **IDE**: http://localhost:8791 (sandbox-ide on Vite)
- **Test User**: 999999999 (TEST_USER_1 constant)
- **Browser**: Chrome with DevTools MCP

### Test Data Created
```
Sandbox: chat-999999999 (TEST_USER_1 - Private)

Snapshot A (older):
  - Key: snapshots/999999999/999999999/2026-01-12T16-08-25-790Z.tar.gz
  - Size: 55,213 bytes (53.9 KB)
  - Contains: /workspace/hello.txt ("Hello World - Snapshot Test A")

Snapshot B (LATEST):
  - Key: snapshots/999999999/999999999/2026-01-12T16-09-06-014Z.tar.gz
  - Size: 61,744 bytes (60.3 KB)
  - Contains: /workspace/hello.txt + /workspace/goodbye.txt
```

---

## Test Results

### UI Components - ALL PASSED ✅

| Component | Status | Notes |
|-----------|--------|-------|
| Sandbox selector dropdown | ✅ PASS | Shows all sandboxes, can switch between them |
| Snapshot panel button | ✅ PASS | Shows count badge (📷 18) |
| Snapshot dropdown list | ✅ PASS | Lists all snapshots with dates, sizes, LATEST badge |
| Preview button (👁) | ✅ PASS | Enters preview mode correctly |
| Restore button (↩) | ✅ PASS | Opens confirmation modal |
| Preview banner | ✅ PASS | Orange bar shows snapshot date |
| Preview toggle | ✅ PASS | Can switch snapshots while in preview |
| Exit preview button | ✅ PASS | Returns to live filesystem |
| File tree in preview | ✅ PASS | Shows correct files from snapshot |
| Editor in preview | ✅ PASS | Opens files, shows content |
| Confirmation modal | ✅ PASS | Shows date, size, "mark as latest" checkbox |

### Backend - BUG FOUND ⚠️

| Endpoint | Status | Notes |
|----------|--------|-------|
| GET /snapshots | ✅ PASS | Lists snapshots correctly |
| GET /snapshot-files | ✅ PASS | Lists files in snapshot tar |
| GET /snapshot-file | ✅ PASS | Reads file content from tar |
| POST /restore | ❌ FAIL | Fails when sandbox session is stale |

---

## Bug Analysis

### Error Message
```
Restore error: API error: 500
{
  "error": "CommandError: Failed to execute command
  'rm -rf /home/claude/* /home/claude/.[!.]* 2>/dev/null || true'
  in session 'sandbox-chat-999999999': Unknown Error, TODO"
}
```

### Root Cause
The restore handler (`snapshot.ts:304`) runs two sequential `rm -rf` commands:

```typescript
// Line 303-307 in snapshot.ts
for (const dir of SNAPSHOT_DIRS) {
  await sandbox.exec(`rm -rf ${dir}/* ${dir}/.[!.]* 2>/dev/null || true`, {
    timeout: 30000,
  });
}
```

Where `SNAPSHOT_DIRS = ["/workspace", "/home/claude"]`.

**What happened:**
1. First command (`rm -rf /workspace/*`) - **Succeeded**
2. Second command (`rm -rf /home/claude/*`) - **Failed**

The sandbox session became stale between commands. The terminal in the IDE was showing repeated "Disconnected: Connection closed" and "Reconnecting..." messages, indicating the container was unstable.

### Why This Happens
1. `getSandbox()` returns a reference to an existing sandbox
2. If the sandbox has been sleeping or the WebSocket connection is broken, commands fail
3. The Cloudflare Sandbox SDK returns "Unknown Error, TODO" for stale sessions
4. No health check or retry logic exists in the restore handler

### Stack Trace
```
CommandError: Failed to execute command '...' in session 'sandbox-chat-999999999': Unknown Error, TODO
    at createErrorFromResponse (sandbox SDK)
    at CommandClient.handleErrorResponse (sandbox SDK)
    at async CommandClient.execute (sandbox SDK)
    at async Sandbox.execWithSession (sandbox SDK)
    at async handleSnapshotRestore (snapshot.ts:304)
```

---

## Files Involved

### Frontend (sandbox-ide/)
```
sandbox-ide/
├── src/
│   ├── components/
│   │   ├── SnapshotPanel.ts      # Dropdown with snapshot list
│   │   ├── PreviewBanner.ts      # Orange preview mode banner
│   │   ├── ConfirmModal.ts       # Restore confirmation dialog
│   │   ├── FileTree.ts           # File browser (dual live/preview mode)
│   │   └── Editor.ts             # Monaco editor (read-only in preview)
│   ├── lib/
│   │   ├── api.ts                # API client for all endpoints
│   │   └── types.ts              # TypeScript interfaces
│   └── main.ts                   # State orchestration
└── package.json
```

### Backend (claude-sandbox-worker/)
```
claude-sandbox-worker/
├── src/
│   ├── handlers/
│   │   ├── snapshot.ts           # ⚠️ BUG HERE (line 304)
│   │   └── snapshot-preview.ts   # Preview file listing/reading
│   ├── index.ts                  # Route definitions
│   └── types.ts                  # Type definitions
└── wrangler.toml
```

---

## Recommended Fixes

### Option A: Restart Sandbox Before Restore (Recommended)
**Pros**: Most reliable, guarantees fresh container
**Cons**: Slower (~5-7s extra)

```typescript
// In handleSnapshotRestore(), before clearing directories:
console.log(`[Snapshot] Ensuring sandbox is running...`);
await sandbox.start(); // Wake up or start the container

// Or more aggressive - destroy and recreate:
try {
  await sandbox.destroy();
} catch (e) {
  // Ignore if already destroyed
}
const freshSandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
  sleepAfter: SANDBOX_SLEEP_AFTER,
});
```

### Option B: Add Retry Logic
**Pros**: Fast happy path, handles transient failures
**Cons**: More complex, may mask other issues

```typescript
async function execWithRetry(
  sandbox: Sandbox,
  cmd: string,
  opts: ExecOptions,
  maxRetries = 2
): Promise<ExecResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await sandbox.exec(cmd, opts);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.log(`[Snapshot] Command failed, retrying (${attempt}/${maxRetries})...`);
      // Try to restart sandbox
      await sandbox.start();
    }
  }
}
```

### Option C: Health Check Before Commands
**Pros**: Only restarts when needed
**Cons**: Adds latency for health check

```typescript
// Before running restore commands
const healthCheck = await sandbox.exec('echo "alive"', { timeout: 5000 })
  .catch(() => null);

if (!healthCheck || healthCheck.exitCode !== 0) {
  console.log(`[Snapshot] Sandbox unhealthy, restarting...`);
  await sandbox.destroy();
  // getSandbox will create a new one on next exec
}
```

---

## How to Reproduce the Bug

### 1. Start Services
```bash
# Terminal 1
cd /Users/sam/projects/Andee/claude-sandbox-worker && npm run dev

# Terminal 2
cd /Users/sam/projects/Andee/sandbox-ide && npm run dev
```

### 2. Create Test Data (if not exists)
```bash
export ANDEE_API_KEY="adk_8dfeed669475a5661b976ff13249c20c"

# Create session
curl -X POST http://localhost:8787/session-update \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"999999999","senderId":"999999999","isGroup":false,"claudeSessionId":"test"}'

# Create content via /ask
curl -X POST http://localhost:8787/ask \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"999999999","senderId":"999999999","isGroup":false,"message":"Create hello.txt","botToken":"dummy","userMessageId":1}'

# Wait 15 seconds, then create snapshot
sleep 15
curl -X POST http://localhost:8787/snapshot \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"999999999","senderId":"999999999","isGroup":false}'
```

### 3. Reproduce Bug
1. Open http://localhost:8791 in Chrome
2. Select "TEST_USER_1 - Private" from sandbox dropdown
3. Wait for terminal to show disconnection/reconnection cycling
4. Click snapshot button (📷), then click Restore (↩) on any snapshot
5. Click "Restore" in the confirmation modal
6. Bug triggers: "Unknown Error, TODO" alert appears

---

## Current State of Services

**As of session end:**
- Worker running on port 8787 (background task bc886a3)
- IDE running on port 8791 (background task b17c42f)
- Test user 999999999 has 18 snapshots in R2

**To check if still running:**
```bash
curl http://localhost:8787/  # Should return {"status":"ok"}
curl -I http://localhost:8791/  # Should return 200 OK
```

**To stop services:**
```bash
# Find and kill the background tasks, or just restart terminals
pkill -f "wrangler dev"
pkill -f "vite"
```

---

## Next Steps

1. **Fix the restore bug** - Implement one of the recommended fixes (Option A recommended)
2. **Add error handling** - Show better error messages in the UI when restore fails
3. **Test restore end-to-end** - After fix, verify the full flow works:
   - Restore removes goodbye.txt from filesystem
   - "Mark as latest" creates new snapshot
   - File tree refreshes to show restored state
4. **Consider adding loading state** - UI has no spinner during restore operation

---

## Key Constants and Configuration

```typescript
// Test user IDs (from shared/constants.ts)
TEST_USER_1 = "999999999"
TEST_USER_2 = "888888888"

// API Key (hardcoded in sandbox-ide for dev)
ANDEE_API_KEY = "adk_8dfeed669475a5661b976ff13249c20c"

// Ports
WORKER_PORT = 8787
IDE_PORT = 8789 (or next available: 8790, 8791)

// Snapshot directories backed up
SNAPSHOT_DIRS = ["/workspace", "/home/claude"]
```

---

## Related Documentation

- [CLAUDE.md](/Users/sam/projects/Andee/CLAUDE.md) - Project overview and commands
- [Plan file](/Users/sam/.claude/plans/tingly-tumbling-deer.md) - Original E2E test plan
- [snapshot.ts](/Users/sam/projects/Andee/claude-sandbox-worker/src/handlers/snapshot.ts) - Snapshot handlers (bug location)
- [SnapshotPanel.ts](/Users/sam/projects/Andee/sandbox-ide/src/components/SnapshotPanel.ts) - UI component

---

## Contact

This handoff was created by Claude Code (Opus 4.5) on 2026-01-12.

To continue this work, simply tell the next Claude Code session:
> "Read SNAPSHOT_RESTORE_HANDOFF.md and fix the restore bug"
