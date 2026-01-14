# Snapshot Restore Debug Report

**Date**: 2026-01-12  
**Status**: Issue identified - `ensureSandboxHealthy()` may fail on completely sleeping sandboxes  
**Test User**: TEST_USER_1 (999999999)

---

## Problem Summary

When attempting to restore a snapshot via the production API, the restore fails with:
```json
{"error":"Unable to wake sandbox for restore"}
```

This occurs even though `ensureSandboxHealthy()` uses `listProcesses()` to wake the sandbox before executing commands.

---

## Test Results

### Test 1: Restore without restart (FAILED)
```bash
curl -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/restore" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: adk_8dfeed669475a5661b976ff13249c20c" \
  -d '{"chatId":"999999999","senderId":"999999999","isGroup":false,"snapshotKey":"snapshots/999999999/999999999/2026-01-11T16-05-13-494Z.tar.gz","markAsLatest":false}'

# Result: {"error":"Unable to wake sandbox for restore"}
```

### Test 2: Restart then restore (SUCCESS)
```bash
# Step 1: Restart sandbox
curl -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/restart" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: adk_8dfeed669475a5661b976ff13249c20c" \
  -d '{"chatId":"999999999","senderId":"999999999","isGroup":false}'

# Result: {"success":true,"message":"Container restarted. Session preserved."}

# Step 2: Restore snapshot
curl -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/restore" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: adk_8dfeed669475a5661b976ff13249c20c" \
  -d '{"chatId":"999999999","senderId":"999999999","isGroup":false,"snapshotKey":"snapshots/999999999/999999999/2026-01-11T16-05-13-494Z.tar.gz","markAsLatest":false}'

# Result: {"success":true,"restoredFrom":"snapshots/999999999/999999999/2026-01-11T16-05-13-494Z.tar.gz"}
```

---

## Root Cause Analysis

The `ensureSandboxHealthy()` function in `snapshot.ts` attempts to wake the sandbox using `listProcesses()`, but this may not be sufficient when:

1. **Sandbox is completely asleep** - After 1 hour of inactivity, the container sleeps deeply
2. **Timing issues** - `listProcesses()` may succeed but the sandbox isn't fully ready for `exec()` immediately
3. **Session staleness** - The session may become stale between `listProcesses()` and `exec()` calls

### Current Implementation

```typescript:25:59:claude-sandbox-worker/src/handlers/snapshot.ts
async function ensureSandboxHealthy(sandbox: Sandbox): Promise<boolean> {
  try {
    // listProcesses() properly activates a sleeping sandbox
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

### Retry Logic in handleSnapshotRestore

```typescript:372:392:claude-sandbox-worker/src/handlers/snapshot.ts
const isHealthy = await ensureSandboxHealthy(sandbox);
if (!isHealthy) {
  console.log(`[Snapshot] Sandbox not healthy, attempting to wake...`);
  // Try once more - the first call may have woken it
  const retry = await ensureSandboxHealthy(sandbox);
  if (!retry) {
    return Response.json(
      { error: "Unable to wake sandbox for restore" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
```

---

## Proposed Solutions

### Solution 1: Add delay after listProcesses()

Add a small delay after `listProcesses()` to allow the sandbox to fully wake up:

```typescript
async function ensureSandboxHealthy(sandbox: Sandbox): Promise<boolean> {
  try {
    const processes = await sandbox.listProcesses();
    console.log(`[Snapshot] Sandbox has ${processes.length} process(es) running`);

    // Give sandbox a moment to fully wake up
    await new Promise(resolve => setTimeout(resolve, 500));

    const result = await sandbox.exec('echo "alive"', { timeout: 10000 });
    return result.exitCode === 0;
  } catch (error) {
    console.log(`[Snapshot] Sandbox health check failed: ${error}`);
    return false;
  }
}
```

### Solution 2: More aggressive retry with exponential backoff

Improve the retry logic in `handleSnapshotRestore`:

```typescript
let isHealthy = false;
let attempts = 0;
const maxAttempts = 3;

while (!isHealthy && attempts < maxAttempts) {
  attempts++;
  isHealthy = await ensureSandboxHealthy(sandbox);
  
  if (!isHealthy && attempts < maxAttempts) {
    const delay = Math.min(1000 * Math.pow(2, attempts - 1), 5000); // Exponential backoff, max 5s
    console.log(`[Snapshot] Health check failed, retrying in ${delay}ms (attempt ${attempts}/${maxAttempts})...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

if (!isHealthy) {
  return Response.json(
    { error: "Unable to wake sandbox for restore after multiple attempts" },
    { status: 500, headers: CORS_HEADERS }
  );
}
```

### Solution 3: Auto-restart on health check failure

If health check fails, automatically restart the sandbox:

```typescript
const isHealthy = await ensureSandboxHealthy(sandbox);
if (!isHealthy) {
  console.log(`[Snapshot] Sandbox not healthy, attempting restart...`);
  
  // Try restart endpoint (if available) or create new sandbox
  // This would require access to restart functionality
  // For now, return error suggesting manual restart
  return Response.json(
    { 
      error: "Sandbox is sleeping and cannot be woken. Please restart the sandbox first.",
      suggestion: "Call /restart endpoint before restoring"
    },
    { status: 503, headers: CORS_HEADERS }
  );
}
```

---

## Recommended Fix

**Combine Solution 1 and Solution 2**: Add a delay after `listProcesses()` and improve retry logic with exponential backoff.

---

## Chrome DevTools Debugging

Due to browser instance conflicts, Chrome DevTools MCP couldn't be used directly. To debug in production:

1. **Open Production IDE**: https://andee-ide.pages.dev
2. **Open Browser DevTools** (F12)
3. **Network Tab**: Monitor `/restore` requests
4. **Console Tab**: Check for error messages
5. **Application Tab**: Check localStorage for API key

### Expected Network Flow

1. `POST /restore` → Should return 200 OK with `{"success":true,...}`
2. If fails → Check response body for error message
3. Check console for any JavaScript errors

### Debugging Checklist

- [ ] API key is correct (check localStorage)
- [ ] Sandbox is selected in IDE
- [ ] Network request shows correct headers (`X-API-Key`)
- [ ] Response status code (200 = success, 500 = server error, 503 = service unavailable)
- [ ] Response body contains error details

---

## Next Steps

1. **Implement Solution 1 + 2** (delay + retry logic)
2. **Test in production** with TEST_USER_1
3. **Monitor logs** for health check failures
4. **Update handoff document** with findings

---

## Related Issues

- IDE `/files` endpoint has similar session staleness issues (already fixed with `listProcesses()`)
- `markAsLatest` often fails due to session staleness (expected behavior, handled gracefully)
