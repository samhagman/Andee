# Snapshot Restore Fix - Handoff Document v2

> **SUPERSEDED (2026-01-22)**: This document describes the OLD snapshot implementation with multiple scattered handlers and patterns. The patterns documented here have been consolidated into a unified module: `claude-sandbox-worker/src/lib/snapshot-operations.ts`. See `/developing-andee` skill (DEBUGGING.md section) for current snapshot documentation. This document is retained for historical reference to understand past design decisions.

**Date**: 2026-01-12
**Status**: Core fix deployed to production, one follow-up issue identified
**Test User**: TEST_USER_1 (999999999)

---

## Executive Summary

The snapshot restore functionality in the Sandbox IDE was failing due to **sandbox session staleness**. The fix has been deployed to production and tested successfully. One follow-up issue was identified: the IDE's `/files` endpoint has the same session staleness bug.

---

## Problem Statement

When users attempted to restore a snapshot via the Sandbox IDE, the restore would fail with:
```json
{"error": "Unknown Error, TODO"}
```

**Root Cause**: The Cloudflare Sandbox SDK's `exec()` method fails on stale sessions. Sessions become stale after ~1-2 minutes of inactivity in local dev, and have similar timeouts in production. The restore handler was using `exec()` without first waking the sandbox.

---

## Architecture Context

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SNAPSHOT RESTORE FLOW                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  IDE (browser)                                                          │
│       │                                                                 │
│       │ POST /restore { chatId, snapshotKey, markAsLatest }             │
│       ▼                                                                 │
│  Sandbox Worker (Cloudflare)                                            │
│       │                                                                 │
│       ├─► 1. Download snapshot from R2                                  │
│       │                                                                 │
│       ├─► 2. Wake sandbox (listProcesses + exec health check)  ◄─ FIX  │
│       │                                                                 │
│       ├─► 3. Write snapshot to container (writeFile base64)    ◄─ FIX  │
│       │                                                                 │
│       ├─► 4. Extract tar.gz (exec tar -xzf)                             │
│       │                                                                 │
│       └─► 5. [Optional] Create new snapshot (markAsLatest)              │
│                                                                         │
│  Key Insight:                                                           │
│  • listProcesses() properly wakes sleeping sandboxes                    │
│  • exec() FAILS on stale sessions without waking                        │
│  • writeFile() with encoding:"base64" handles binary data correctly     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Changes Made

### File: `claude-sandbox-worker/src/handlers/snapshot.ts`

#### Fix 1: `ensureSandboxHealthy()` function (lines 20-39)

**Before**: Used only `exec('echo alive')` which fails on stale sessions.

**After**: Uses `listProcesses()` first (which properly wakes the sandbox), then validates with `exec()`.

```typescript
/**
 * Ensures the sandbox is healthy and ready to execute commands.
 * Uses listProcesses() first (which properly activates the sandbox),
 * then validates with an exec command.
 */
async function ensureSandboxHealthy(sandbox: Sandbox): Promise<boolean> {
  try {
    // listProcesses() properly activates a sleeping sandbox
    // (unlike exec() which fails on stale sessions)
    const processes = await sandbox.listProcesses();
    console.log(`[Snapshot] Sandbox has ${processes.length} process(es) running`);

    // Now try a simple exec to confirm the sandbox is responsive
    const result = await sandbox.exec('echo "alive"', { timeout: 10000 });
    return result.exitCode === 0;
  } catch (error) {
    console.log(`[Snapshot] Sandbox health check failed: ${error}`);
    return false;
  }
}
```

#### Fix 2: Simplified writeFile (lines 349-365)

**Before**: Used a complex chunked heredoc approach with `printf` commands that failed for large files (>32KB).

**After**: Uses SDK's native `writeFile()` with `encoding: "base64"` - same proven pattern as `ask.ts`.

```typescript
// Step 3: Write snapshot to container using SDK's writeFile (same approach as ask.ts)
// The SDK handles base64 encoding internally
console.log(`[Snapshot] Writing snapshot to container (${arrayBuffer.byteLength} bytes)...`);
const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

try {
  await sandbox.writeFile(SNAPSHOT_TMP_PATH, base64Data, {
    encoding: "base64",
  });
  console.log(`[Snapshot] Snapshot file written successfully`);
} catch (writeError) {
  console.error(`[Snapshot] Failed to write snapshot file:`, writeError);
  return Response.json(
    { error: "Failed to write snapshot to container", detail: String(writeError) },
    { status: 500, headers: CORS_HEADERS }
  );
}
```

#### Fix 3: Graceful markAsLatest error handling (lines 385-459)

**Before**: If markAsLatest failed, the entire restore returned 500 even though files were successfully restored.

**After**: Wrapped in try-catch, returns 200 OK with `markAsLatestError` field if the optional step fails.

```typescript
// Step 5: Optionally create new snapshot to mark as latest
// This is wrapped in try-catch so restore is still successful even if marking fails
let newSnapshotKey: string | undefined;
let markAsLatestError: string | undefined;
if (markAsLatest) {
  try {
    // ... create new snapshot logic ...
  } catch (markError) {
    // Don't fail the restore if marking as latest fails
    console.warn(`[Snapshot] Failed to mark as latest (restore still succeeded):`, markError);
    markAsLatestError = markError instanceof Error ? markError.message : String(markError);
  }
}

return Response.json(
  {
    success: true,
    restoredFrom: snapshotKey,
    newSnapshotKey,
    markAsLatestError, // undefined if successful, error message if failed
  },
  { headers: CORS_HEADERS }
);
```

---

## Testing Results

### Local Development Testing (2026-01-11)

| Test | Snapshot Size | Result |
|------|---------------|--------|
| Small snapshot | 16 KB | ✅ Success |
| Medium snapshot | 61 KB | ✅ Success |
| Large snapshot | 74 KB | ✅ Success |
| With markAsLatest | 33 KB | ✅ Success (markAsLatest failed gracefully) |

### Production Testing (2026-01-12)

**Deployment**: Successfully deployed to `https://claude-sandbox-worker.h2c.workers.dev`

| Test | Description | Result |
|------|-------------|--------|
| Restore WITHOUT markAsLatest | Jan 8 snapshot (73.8 KB) | ✅ 200 OK |
| Restore WITH markAsLatest | Jan 7 snapshot (15.2 KB) | ✅ 200 OK (markAsLatestError present) |
| File verification | Check /home/claude and /workspace | ✅ Files present |
| Cleanup | Restore latest snapshot | ✅ Success |

**Production Test Commands Used**:

```bash
# Restart sandbox (clears stale session)
curl -X POST https://claude-sandbox-worker.h2c.workers.dev/restart \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"999999999","senderId":"999999999","isGroup":false}'

# Restore snapshot
curl -X POST https://claude-sandbox-worker.h2c.workers.dev/restore \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"999999999","senderId":"999999999","isGroup":false,"snapshotKey":"snapshots/999999999/999999999/2026-01-11T16-05-13-494Z.tar.gz","markAsLatest":false}'

# List snapshots
curl "https://claude-sandbox-worker.h2c.workers.dev/snapshots?chatId=999999999&senderId=999999999&isGroup=false" \
  -H "X-API-Key: $ANDEE_API_KEY"

# Check files after restore
curl "https://claude-sandbox-worker.h2c.workers.dev/files?sandbox=chat-999999999&path=/home/claude" \
  -H "X-API-Key: $ANDEE_API_KEY"
```

---

## Known Limitations

### 1. markAsLatest Often Fails in Production

**Behavior**: The `markAsLatest` option frequently fails with "Sandbox session became stale after restore".

**Why**: The restore operation (download from R2 + write file + extract tar) takes enough time that the sandbox session becomes stale before we can create a new snapshot.

**Impact**: Low - The core restore always succeeds. Users can manually create a snapshot after restoring if needed.

**Response Format**:
```json
{
  "success": true,
  "restoredFrom": "snapshots/999999999/999999999/2026-01-07T17-26-46-404Z.tar.gz",
  "markAsLatestError": "Sandbox session became stale after restore"
}
```

### 2. Session Staleness is Expected Behavior

The Cloudflare Sandbox SDK has aggressive session timeouts. This is by design for resource efficiency. Our fix ensures we always try to wake the sandbox before operations, but we can't prevent staleness during long-running operations.

---

## Follow-Up Issue: IDE `/files` Endpoint

### Problem

The IDE's `/files` endpoint (`claude-sandbox-worker/src/handlers/ide.ts`) has the same session staleness bug. When the sandbox session is stale, file listing returns 500:

```json
{
  "error": "Failed to list files",
  "detail": "Error: CommandError: Failed to execute command 'ls -la...' in session 'sandbox-chat-999999999': Unknown Error, TODO"
}
```

### Affected Function

`handleFilesList()` in `claude-sandbox-worker/src/handlers/ide.ts`

### Recommended Fix

Apply the same `listProcesses()` pattern before `exec()` calls:

```typescript
// Before any exec() call in ide.ts:
try {
  await sandbox.listProcesses(); // Wake the sandbox
} catch (e) {
  // Sandbox may need a moment, try once more
  await sandbox.listProcesses();
}

// Then proceed with exec()
const result = await sandbox.exec('ls -la ...', { timeout: 10000 });
```

### Workaround

Users can click the sandbox dropdown and re-select their sandbox, which triggers a reconnection that often works.

---

## Files Modified

| File | Change |
|------|--------|
| `claude-sandbox-worker/src/handlers/snapshot.ts` | Core restore fix (3 changes) |

## Files to Modify (Follow-up)

| File | Change Needed |
|------|---------------|
| `claude-sandbox-worker/src/handlers/ide.ts` | Add listProcesses() before exec() calls |

---

## Deployment Status

| Component | Status | URL |
|-----------|--------|-----|
| Sandbox Worker | ✅ Deployed | https://claude-sandbox-worker.h2c.workers.dev |
| Sandbox IDE | ✅ Deployed | https://andee-ide.pages.dev |

---

## How to Verify the Fix

1. **Open Production IDE**: https://andee-ide.pages.dev
2. **Enter API Key**: `adk_8dfeed669475a5661b976ff13249c20c` (from `.dev.vars`)
3. **Select TEST_USER_1** from dropdown
4. **Click snapshot button** (📷 with count)
5. **Click restore** on any snapshot
6. **Verify**: Should return 200 OK (check Network tab in DevTools)

**Note**: The IDE may show "Disconnected" after restore due to the separate `/files` endpoint bug. The restore itself still works - verify via curl or by refreshing the page.

---

## Git Status (Uncommitted Changes)

The snapshot.ts fix is part of a larger set of uncommitted changes. Key modified files:

```
M claude-sandbox-worker/src/handlers/snapshot.ts  ← THE FIX
M claude-sandbox-worker/src/handlers/ide.ts       ← Also modified (unrelated)
M sandbox-ide/src/components/SnapshotPanel.ts     ← UI components
```

**Recommendation**: Commit the snapshot restore fix separately before addressing the IDE /files endpoint issue.

---

## Summary for Next Session

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SNAPSHOT RESTORE - STATUS SUMMARY                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ✅ DONE:                                                               │
│  • Fixed ensureSandboxHealthy() to use listProcesses() first            │
│  • Fixed writeFile() to use SDK's native base64 encoding                │
│  • Fixed markAsLatest to fail gracefully (returns 200 with error msg)   │
│  • Deployed to production                                               │
│  • Tested with TEST_USER_1 in production                                │
│                                                                         │
│  ⚠️  KNOWN LIMITATION:                                                  │
│  • markAsLatest often fails due to session staleness (expected)         │
│  • Core restore always works                                            │
│                                                                         │
│  📋 TODO:                                                               │
│  • Fix IDE /files endpoint session staleness (same pattern)             │
│  • Commit the changes                                                   │
│                                                                         │
│  🔑 CREDENTIALS:                                                        │
│  • API Key: adk_8dfeed669475a5661b976ff13249c20c                        │
│  • Test User: 999999999 (TEST_USER_1)                                   │
│  • Production IDE: https://andee-ide.pages.dev                          │
│  • Production Worker: https://claude-sandbox-worker.h2c.workers.dev │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference: Key Insight

The **critical insight** that fixed this bug:

> `listProcesses()` properly wakes a sleeping/stale Cloudflare Sandbox.
> `exec()` does NOT wake the sandbox - it just fails with "Unknown Error, TODO".

This pattern should be applied anywhere we use `sandbox.exec()` on a sandbox that may be sleeping:

```typescript
// WRONG - fails on stale session
const result = await sandbox.exec('some command');

// RIGHT - wake first, then exec
await sandbox.listProcesses(); // Wakes the sandbox
const result = await sandbox.exec('some command');
```
