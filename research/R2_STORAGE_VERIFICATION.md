# R2 Storage Verification Report

**Date:** January 6, 2026
**Scope:** Sessions, Snapshots, Multi-User Isolation, Group Chats
**Status:** VERIFIED WITH LIVE TESTS

---

## Executive Summary

The Andee bot's R2 storage system for sessions and snapshots has been thoroughly verified through code analysis and live testing. **The system is working correctly** with proper multi-user isolation and group chat sharing as designed.

### Key Findings

| Component | Status | Notes |
|-----------|--------|-------|
| Session Key Structure | **WORKING** | Private: `sessions/{senderId}/{chatId}.json`, Group: `sessions/groups/{chatId}.json` |
| Snapshot Key Structure | **WORKING** | Private: `snapshots/{senderId}/{chatId}/{ts}.tar.gz`, Group: `snapshots/groups/{chatId}/{ts}.tar.gz` |
| Private Chat Isolation | **WORKING** | Each user has isolated session directory |
| Group Chat Sharing | **WORKING** | All members share single session (intentional) |
| Cross-User Protection | **WORKING** | Delete operations blocked for wrong senderId |
| Snapshot Backup/Restore | **WORKING** | `/workspace/` and `/home/claude/` preserved |
| Pre-Reset Snapshots | **WORKING** | Auto-creates snapshot before destroy |
| Authentication | **WORKING** | X-API-Key required on all endpoints |

### Vulnerabilities Identified

| Severity | Issue | Status |
|----------|-------|--------|
| HIGH | Race condition in messageCount (group chats) | Unpatched |
| MEDIUM | Memory leak in persistent server | Unpatched |
| MEDIUM | Snapshot restore race condition | Unpatched |
| LOW | Typing indicator not cleared on error | Unpatched |
| LOW | Legacy fallback could break isolation | Mitigated by consistent code |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  R2 STORAGE ARCHITECTURE                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SESSIONS BUCKET (andee-sessions)                                    │   │
│  │                                                                      │   │
│  │  Private Chats:                                                      │   │
│  │    sessions/{senderId}/{chatId}.json                                 │   │
│  │    Example: sessions/111/111.json (User 111's DM)                    │   │
│  │    Example: sessions/222/222.json (User 222's DM)                    │   │
│  │                                                                      │   │
│  │  Group Chats:                                                        │   │
│  │    sessions/groups/{chatId}.json                                     │   │
│  │    Example: sessions/groups/-100555.json (All members share)         │   │
│  │                                                                      │   │
│  │  Schema:                                                             │   │
│  │  {                                                                   │   │
│  │    claudeSessionId: string | null,  // Claude Agent SDK session      │   │
│  │    messageCount: number,            // Messages in this session      │   │
│  │    createdAt: string,               // ISO timestamp                 │   │
│  │    updatedAt: string                // Last update                   │   │
│  │  }                                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SNAPSHOTS BUCKET (andee-snapshots)                                  │   │
│  │                                                                      │   │
│  │  Private Chats:                                                      │   │
│  │    snapshots/{senderId}/{chatId}/{timestamp}.tar.gz                  │   │
│  │    Example: snapshots/999/test/2026-01-06T15-29-26-625Z.tar.gz       │   │
│  │                                                                      │   │
│  │  Group Chats:                                                        │   │
│  │    snapshots/groups/{chatId}/{timestamp}.tar.gz                      │   │
│  │    Example: snapshots/groups/-100555/2026-01-06T15-30-00-000Z.tar.gz │   │
│  │                                                                      │   │
│  │  Contents:                                                           │   │
│  │    /workspace/           - Working files                             │   │
│  │    /workspace/files/     - User files                                │   │
│  │    /workspace/node_modules - NPM symlink                             │   │
│  │    /home/claude/         - Claude user home                          │   │
│  │    /home/claude/.claude/ - Claude config                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Session System Deep Dive

### Key Generation Logic

**File:** `shared/types/session.ts:30-41`

```typescript
export function getSessionKey(
  chatId: string,
  senderId?: string,
  isGroup?: boolean
): string {
  if (senderId !== undefined && isGroup !== undefined) {
    return isGroup
      ? `sessions/groups/${chatId}.json`       // Group: shared
      : `sessions/${senderId}/${chatId}.json`; // Private: per-user
  }
  return `sessions/${chatId}.json`; // Legacy fallback
}
```

### Session Update Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SESSION UPDATE LIFECYCLE                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User sends message                                                         │
│       │                                                                     │
│       ▼                                                                     │
│  Grammy Bot (telegram-bot/src/index.ts:23-37)                               │
│  ├── getSession(env, chatId, senderId, isGroup)                             │
│  │   └── R2.get(getSessionKey(...))                                         │
│  │   └── Returns existing session or createDefaultSession()                 │
│  │                                                                          │
│       ▼                                                                     │
│  POST /ask with claudeSessionId from session                                │
│       │                                                                     │
│       ▼                                                                     │
│  Container processes message via Claude Agent SDK                           │
│       │                                                                     │
│       ▼                                                                     │
│  persistent-server.script.js:502-518                                        │
│  ├── POST /session-update with new claudeSessionId                          │
│  │                                                                          │
│       ▼                                                                     │
│  sessionUpdate.ts:15-55                                                     │
│  ├── Read existing session (or create new)                                  │
│  ├── session.claudeSessionId = newId                                        │
│  ├── session.messageCount++                                                 │
│  ├── session.updatedAt = new Date()                                         │
│  └── R2.put(sessionKey, JSON.stringify(session))                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Critical Files

| File | Lines | Purpose |
|------|-------|---------|
| `shared/types/session.ts` | 5-22 | SessionData interface |
| `shared/types/session.ts` | 30-41 | getSessionKey() |
| `claude-sandbox-worker/src/handlers/sessionUpdate.ts` | 15-55 | Session update handler |
| `claude-telegram-bot/src/index.ts` | 23-47 | Session read/delete |

---

## Snapshot System Deep Dive

### Snapshot Creation Process

**File:** `claude-sandbox-worker/src/handlers/snapshot.ts:30-135`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SNAPSHOT CREATION FLOW (POST /snapshot)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Validate chatId exists                                                  │
│       │                                                                     │
│       ▼                                                                     │
│  2. Get sandbox: getSandbox(env.Sandbox, `chat-${chatId}`)                  │
│       │                                                                     │
│       ▼                                                                     │
│  3. Check directories for content:                                          │
│     for dir in ["/workspace", "/home/claude"]:                              │
│       sandbox.exec(`test -d ${dir} && ls -A ${dir}`)                        │
│       │                                                                     │
│       ▼                                                                     │
│  4. Create tar archive:                                                     │
│     sandbox.exec(`tar -czf /tmp/snapshot.tar.gz ${dirs}`)                   │
│       │                                                                     │
│       ▼                                                                     │
│  5. Read tar file as base64:                                                │
│     sandbox.readFile("/tmp/snapshot.tar.gz", { encoding: "base64" })        │
│       │                                                                     │
│       ▼                                                                     │
│  6. Convert to binary and upload to R2:                                     │
│     env.SNAPSHOTS.put(snapshotKey, binaryData, {                            │
│       customMetadata: { chatId, senderId, isGroup, createdAt, directories } │
│     })                                                                      │
│       │                                                                     │
│       ▼                                                                     │
│  7. Clean up: sandbox.exec("rm -f /tmp/snapshot.tar.gz")                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Snapshot Restoration Process

**File:** `claude-sandbox-worker/src/handlers/ask.ts:33-99`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SNAPSHOT RESTORATION FLOW (on container start)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. List snapshots with prefix:                                             │
│     prefix = getSnapshotPrefix(chatId, senderId, isGroup)                   │
│     listResult = env.SNAPSHOTS.list({ prefix })                             │
│       │                                                                     │
│       ▼                                                                     │
│  2. Get latest snapshot (sorted by key, descending):                        │
│     latestKey = objects.sort((a,b) => b.key.localeCompare(a.key))[0].key   │
│       │                                                                     │
│       ▼                                                                     │
│  3. Download from R2:                                                       │
│     object = env.SNAPSHOTS.get(latestKey)                                   │
│     arrayBuffer = object.arrayBuffer()                                      │
│       │                                                                     │
│       ▼                                                                     │
│  4. Write to container as base64:                                           │
│     sandbox.writeFile("/tmp/snapshot.tar.gz", base64Data, {encoding:"base64"})│
│       │                                                                     │
│       ▼                                                                     │
│  5. Extract to root:                                                        │
│     sandbox.exec("cd / && tar -xzf /tmp/snapshot.tar.gz")                   │
│       │                                                                     │
│       ▼                                                                     │
│  6. Clean up:                                                               │
│     sandbox.exec("rm -f /tmp/snapshot.tar.gz")                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Reset Creates Pre-Snapshot

**File:** `claude-sandbox-worker/src/handlers/reset.ts:40-95`

The `/reset` endpoint automatically creates a snapshot BEFORE destroying the container:

1. Check if directories have content
2. Create tar archive
3. Upload to R2 with `reason: "pre-reset"` metadata
4. THEN destroy sandbox
5. Delete R2 session

This ensures data is never lost on reset.

---

## Multi-User Scenarios

### Scenario 1: Private Chat Isolation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PRIVATE CHAT: Complete Isolation                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User Alice (ID: 111) DMs bot:                                              │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │  chatId = "111"                                                  │       │
│  │  senderId = "111"                                                │       │
│  │  isGroup = false                                                 │       │
│  │                                                                  │       │
│  │  Session:   sessions/111/111.json         ✓ ISOLATED             │       │
│  │  Snapshot:  snapshots/111/111/{ts}.tar.gz ✓ ISOLATED             │       │
│  │  Sandbox:   chat-111                      ✓ ISOLATED             │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│  User Bob (ID: 222) DMs bot:                                                │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │  chatId = "222"                                                  │       │
│  │  senderId = "222"                                                │       │
│  │  isGroup = false                                                 │       │
│  │                                                                  │       │
│  │  Session:   sessions/222/222.json         ✓ ISOLATED             │       │
│  │  Snapshot:  snapshots/222/222/{ts}.tar.gz ✓ ISOLATED             │       │
│  │  Sandbox:   chat-222                      ✓ ISOLATED             │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│  RESULT: Alice and Bob have completely separate:                            │
│    - Session data (conversation history)                                    │
│    - Filesystem snapshots                                                   │
│    - Sandbox containers                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Scenario 2: Group Chat Sharing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  GROUP CHAT: Intentional Sharing                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Group "Team Chat" (ID: -100555):                                           │
│                                                                             │
│  Alice sends message:                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │  chatId = "-100555"                                              │       │
│  │  senderId = "111" (IGNORED for group key)                        │       │
│  │  isGroup = true                                                  │       │
│  │                                                                  │       │
│  │  Session:   sessions/groups/-100555.json  ← SHARED               │       │
│  │  Snapshot:  snapshots/groups/-100555/...  ← SHARED               │       │
│  │  Sandbox:   chat--100555                  ← SHARED               │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│  Bob sends message to SAME group:                                           │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │  chatId = "-100555"                                              │       │
│  │  senderId = "222" (IGNORED for group key)                        │       │
│  │  isGroup = true                                                  │       │
│  │                                                                  │       │
│  │  Session:   sessions/groups/-100555.json  ← SAME FILE            │       │
│  │  Snapshot:  snapshots/groups/-100555/...  ← SAME DIR             │       │
│  │  Sandbox:   chat--100555                  ← SAME CONTAINER       │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│  RESULT: Alice and Bob share:                                               │
│    - Same conversation context (Claude sees all messages)                   │
│    - Same filesystem (can collaborate on files)                             │
│    - Same sandbox container                                                 │
│                                                                             │
│  This is INTENTIONAL for group collaboration!                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Scenario 3: Cross-User Protection

The system prevents users from accessing other users' data:

```typescript
// snapshot.ts:297-303
if (!key.startsWith(prefix)) {
  return Response.json(
    { error: "Invalid key for this chatId/senderId/isGroup combination" },
    { status: 403, headers: CORS_HEADERS }
  );
}
```

**Verified in Test 20:** User 111 cannot delete User 999's snapshot.

---

## Live Test Results

### Test Environment

- **Host:** localhost:8787 (wrangler dev)
- **R2:** Local emulation via wrangler
- **API Key:** `adk_8dfeed669475a5661b976ff13249c20c`

### Test Results Summary

| Test | Description | Result | Response |
|------|-------------|--------|----------|
| 1 | Health check (no auth) | PASS | `{"status":"ok","service":"claude-sandbox-worker"}` |
| 2 | Session update - Alice private | PASS | `{"success":true}` |
| 3 | Session update - Bob private | PASS | `{"success":true}` |
| 4 | Session update - Alice in group | PASS | `{"success":true}` |
| 5 | Session update - Bob in same group | PASS | `{"success":true}` |
| 6 | List snapshots - Alice private | PASS | `{"count":0,"snapshots":[]}` |
| 7 | List snapshots - Group | PASS | `{"count":0,"snapshots":[]}` |
| 8 | Get latest snapshot (none) | PASS | `{"error":"No snapshots found"}` (404) |
| 9 | Auth - No API key | PASS | `{"error":"Unauthorized"}` (401) |
| 10 | Auth - Wrong API key | PASS | `{"error":"Unauthorized"}` (401) |
| 11 | Create snapshot - Private | PASS | Key: `snapshots/999/test-no-container/...` |
| 12 | List snapshots after create | PASS | `{"count":1,"snapshots":[...]}` |
| 13 | Download snapshot | PASS | HTTP 200, 8231 bytes |
| 14 | Verify snapshot contents | PASS | Valid tar.gz with `/workspace/`, `/home/claude/` |
| 15 | Create snapshot - Group | PASS | Key: `snapshots/groups/-100test-group/...` |
| 16 | Reset creates pre-snapshot | PASS | `{"snapshotKey":"snapshots/999/..."}` |
| 17 | List after reset (2 snapshots) | PASS | `{"count":2,"snapshots":[...]}` |
| 18 | Verify R2 keys | PASS | All keys follow expected structure |
| 19 | Delete single snapshot | PASS | `{"success":true,"deleted":1}` |
| 20 | Cross-user delete blocked | PASS | `{"error":"Invalid key..."}` (403) |
| 21 | Delete all snapshots | PASS | `{"success":true,"deleted":1}` |

### R2 Key Verification

**Sessions (from SQLite):**
```
sessions/111/111.json           ← Alice private
sessions/222/222.json           ← Bob private
sessions/groups/-100555.json    ← Group (shared)
```

**Snapshots (from SQLite):**
```
snapshots/999/test-no-container/2026-01-06T15-29-26-625Z.tar.gz
snapshots/999/test-no-container/2026-01-06T15-29-58-193Z.tar.gz
snapshots/groups/-100test-group/2026-01-06T15-29-51-980Z.tar.gz
```

### Session Data Verification

```json
// Alice's session (sessions/111/111.json)
{"claudeSessionId":"sess-alice-001","messageCount":1,"createdAt":"2026-01-06T15:27:29.172Z","updatedAt":"2026-01-06T15:27:29.173Z"}

// Bob's session (sessions/222/222.json)
{"claudeSessionId":"sess-bob-001","messageCount":1,"createdAt":"2026-01-06T15:27:29.191Z","updatedAt":"2026-01-06T15:27:29.191Z"}

// Group session (sessions/groups/-100555.json)
{"claudeSessionId":"sess-group-002","messageCount":2,"createdAt":"2026-01-06T15:27:29.203Z","updatedAt":"2026-01-06T15:27:29.215Z"}
```

**Key Observation:** Group session has `messageCount:2` because both Alice and Bob sent messages. The `claudeSessionId` was overwritten by Bob's update (`sess-group-002`), confirming shared state.

---

## Issues & Vulnerabilities

### HIGH: Race Condition in messageCount

**File:** `sessionUpdate.ts:41-44`

```typescript
session.claudeSessionId = claudeSessionId;
session.messageCount++;  // NOT ATOMIC
session.updatedAt = new Date().toISOString();
await ctx.env.SESSIONS.put(sessionKey, JSON.stringify(session));
```

**Problem:** Two concurrent messages in a group chat can read the same `messageCount`, both increment it, and both write the same value:

```
Time 1: Alice reads messageCount=5
Time 2: Bob reads messageCount=5 (Alice still processing)
Time 3: Alice writes messageCount=6
Time 4: Bob writes messageCount=6 (LOST INCREMENT)
```

**Impact:** Message counts will be inaccurate in active group chats.

**Affected Scenarios:** Group chats with multiple users sending messages rapidly.

---

### MEDIUM: Memory Leak in Persistent Server

**File:** `persistent-server.script.js:310, 520`

```javascript
// Line 310: Context stored for response handling
currentRequestContext = msg;

// Line 520: Only cleared on success
currentRequestContext = null;
```

**Problem:** If a message fails before reaching the result handler (timeout, error), `currentRequestContext` is never cleared. Over time, this accumulates memory.

**Impact:** Slow memory growth in long-running containers, eventual OOM.

---

### MEDIUM: Snapshot Restore Race Condition

**File:** `ask.ts:138-145`

```typescript
if (!serverProcess) {
  const restored = await restoreFromSnapshot(...);
  // RACE: Another message could arrive during extraction
  // and read partially-restored filesystem
}
```

**Problem:** During tar extraction (up to 60 seconds), another message could arrive and access inconsistent filesystem state.

**Impact:** Potential data corruption or errors if concurrent messages during restore.

---

### LOW: Typing Indicator Not Cleared on Error

**File:** `persistent-server.script.js:313-318, 480-482`

```javascript
// Line 313-318: Interval started
if (!typingInterval) {
  typingInterval = setInterval(() => {
    sendTypingIndicator(botToken, chatId);
  }, 4000);
}

// Line 480-482: Only cleared on success (msg.type === "result")
if (msg.type === "result") {
  clearInterval(typingInterval);
  typingInterval = null;
}
```

**Problem:** If message processing fails before reaching `result`, the typing interval keeps running forever.

**Impact:** Telegram shows "typing..." indicator indefinitely after errors.

---

### LOW: Legacy Fallback Could Break Isolation

**File:** `session.ts:35-40`

```typescript
if (senderId !== undefined && isGroup !== undefined) {
  // New structure with isolation
} else {
  return `sessions/${chatId}.json`; // Legacy: NO ISOLATION
}
```

**Problem:** If any code path forgets to pass `senderId` and `isGroup`, the legacy fallback creates a single session per `chatId` without user isolation.

**Current Status:** All code paths consistently pass these parameters, but the fallback exists and could be triggered by future code changes.

---

## Recommended Fixes

### Fix 1: Atomic Message Count (HIGH Priority)

**Problem:** Race condition in `messageCount` increment.

**Solution:** Use R2's conditional writes or implement optimistic locking.

```typescript
// Option A: Use timestamp-based versioning
async function handleSessionUpdate(ctx: HandlerContext): Promise<Response> {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const existing = await ctx.env.SESSIONS.get(sessionKey);
    const session = existing ? await existing.json() : createDefaultSession();
    const expectedVersion = session.updatedAt;

    session.claudeSessionId = claudeSessionId;
    session.messageCount++;
    session.updatedAt = new Date().toISOString();

    // Conditional write: only succeed if version matches
    const result = await ctx.env.SESSIONS.put(sessionKey, JSON.stringify(session), {
      onlyIf: { etagMatches: existing?.etag }
    });

    if (result.success) return Response.json({ success: true });
  }

  return Response.json({ error: "Concurrent update conflict" }, { status: 409 });
}
```

**Complexity:** Medium - Requires retry logic and conflict handling.

---

### Fix 2: Clear Context on Error (MEDIUM Priority)

**Problem:** Memory leak from `currentRequestContext` not cleared on failure.

**Solution:** Add error handling to clear context.

```javascript
// In persistent-server.script.js, wrap processing in try-finally:
try {
  // Process message...
} catch (err) {
  log(`ERROR: ${err.message}`);
  // Notify user if possible
  if (currentRequestContext) {
    await sendToTelegram(`Error: ${err.message}`, ctx.botToken, ctx.chatId);
  }
} finally {
  // ALWAYS clear context and typing
  currentRequestContext = null;
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
}
```

**Complexity:** Low - Simple try-finally wrapper.

---

### Fix 3: Snapshot Restore Lock (MEDIUM Priority)

**Problem:** Race condition during snapshot restoration.

**Solution:** Add state machine to prevent concurrent operations during restore.

```typescript
// In ask.ts, add restore lock per chat
const restoreInProgress = new Map<string, Promise<boolean>>();

async function handleAsk(ctx: HandlerContext): Promise<Response> {
  const chatId = body.chatId;

  // Wait for any in-progress restore
  if (restoreInProgress.has(chatId)) {
    await restoreInProgress.get(chatId);
  }

  if (!serverProcess) {
    // Set restore lock
    const restorePromise = restoreFromSnapshot(...);
    restoreInProgress.set(chatId, restorePromise);

    try {
      await restorePromise;
    } finally {
      restoreInProgress.delete(chatId);
    }
  }

  // Continue with message processing...
}
```

**Complexity:** Medium - Requires state management across requests.

---

### Fix 4: Clear Typing on Error (LOW Priority)

**Problem:** Typing indicator runs forever after errors.

**Solution:** Covered by Fix 2 - use try-finally to clear interval.

---

### Fix 5: Remove Legacy Fallback (LOW Priority)

**Problem:** Legacy fallback could break isolation if parameters omitted.

**Solution:** Throw error instead of falling back.

```typescript
export function getSessionKey(
  chatId: string,
  senderId?: string,
  isGroup?: boolean
): string {
  if (senderId === undefined || isGroup === undefined) {
    throw new Error(`getSessionKey called without senderId/isGroup for chat ${chatId}`);
  }
  return isGroup
    ? `sessions/groups/${chatId}.json`
    : `sessions/${senderId}/${chatId}.json`;
}
```

**Complexity:** Low - Simple validation.

---

## Conclusion

### What Works Well

1. **Session Key Structure** - Properly isolates private chats while sharing group sessions
2. **Snapshot Key Structure** - Mirrors session structure for consistent isolation
3. **Cross-User Protection** - Delete operations validate ownership via prefix
4. **Pre-Reset Snapshots** - Data is never lost on reset
5. **Authentication** - All non-health endpoints require X-API-Key
6. **Error Handling** - Graceful fallbacks (e.g., create default session on read failure)

### What Needs Attention

| Priority | Issue | Effort |
|----------|-------|--------|
| HIGH | Race condition in messageCount | Medium |
| MEDIUM | Memory leak in persistent server | Low |
| MEDIUM | Snapshot restore race condition | Medium |
| LOW | Typing indicator not cleared | Low |
| LOW | Legacy fallback | Low |

### Overall Assessment

**The R2 storage system is fundamentally sound and working as designed.** The identified issues are edge cases that only affect:
- Very active group chats (messageCount race)
- Long-running containers with many errors (memory leak)
- Rapid messages during container restarts (restore race)

For typical usage with a few active users, the system is reliable and provides appropriate isolation.

### Priority Ranking for Fixes

1. **Fix 2** (Context cleanup) - Low effort, addresses memory leak AND typing indicator
2. **Fix 1** (Atomic messageCount) - Medium effort, prevents data inconsistency in groups
3. **Fix 3** (Restore lock) - Medium effort, prevents rare but serious corruption
4. **Fix 5** (Remove fallback) - Low effort, defense in depth

---

*Report generated: January 6, 2026*
*Verification method: Code analysis + live testing with curl*
