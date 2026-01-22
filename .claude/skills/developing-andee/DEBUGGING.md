# Debugging Guide

Troubleshooting and debugging Andee issues.

## Contents

- [Sandbox IDE (Direct Container Access)](#sandbox-ide-direct-container-access)
- [Real-time Log Tailing](#real-time-log-tailing)
- [Agent Logs](#agent-logs)
- [Log Event Reference](#log-event-reference)
- [Claude SDK Transcripts (Internal Reasoning)](#claude-sdk-transcripts-internal-reasoning)
- [Storage Locations](#storage-locations)
- [Diagnostics](#diagnostics)
- [Resetting Sandboxes](#resetting-sandboxes)
- [R2 Session Management](#r2-session-management)
- [Snapshot Management](#snapshot-management)
- [Testing Endpoints Directly](#testing-endpoints-directly)
- [Verify Persistent Server](#verify-persistent-server)
- [Common Issues & Solutions](#common-issues--solutions)
- [Performance Timing Analysis](#performance-timing-analysis)

---

## Sandbox IDE (Direct Container Access)

For interactive debugging, use the Sandbox IDE at https://andee-ide.pages.dev/

### Features

| Feature | Use Case |
|---------|----------|
| **Terminal** | Run commands interactively in the container |
| **File browser** | Navigate any path (/workspace, /home/claude, etc.) |
| **Editor** | View/edit files with Monaco (VS Code editor) |
| **Snapshots** | Take, preview, and restore filesystem snapshots (📷 button) |

### Terminal Capabilities

The terminal uses node-pty for full PTY support:
- Run `claude` to test Claude Code TUI interactively
- View logs: `cat /workspace/telegram_agent.log`
- Test bash commands in the live container
- Resize support, job control, colors

### Use Cases

```
┌─────────────────────────────────────────────────────────────────────────┐
│  IDE DEBUGGING USE CASES                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Test skills interactively                                           │
│     $ claude "test my weather skill"                                    │
│                                                                         │
│  2. Inspect memory files                                                │
│     Browse to /home/claude/shared/lists/ in file tree                   │
│                                                                         │
│  3. Check persistent server state                                       │
│     $ cat /workspace/telegram_agent.log | tail -50                      │
│                                                                         │
│  4. Debug memvid search                                                 │
│     $ memvid find /media/conversation-history/$CHAT_ID/memory.mv2 "query"│
│                                                                         │
│  5. Verify YAML in artifacts                                            │
│     $ yq '.tags' /home/claude/shared/lists/recipes/pasta-abc123.md      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Terminal Server Location

The terminal is served by `claude-sandbox-worker/.claude/scripts/ws-terminal.js` on port 8081. Uses node-pty for proper PTY emulation (required for Claude Code TUI to work).

### Terminal Connection Troubleshooting

The terminal uses a robust health-checking architecture to handle reconnection scenarios:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ws-terminal.js HEALTH CHECKING ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  On startup, checks for existing healthy server:                        │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. PID file exists? (/tmp/ws-terminal.pid)                      │   │
│  │           │                                                       │   │
│  │           ▼                                                       │   │
│  │  2. Process still alive? (kill -0 $pid)                          │   │
│  │           │                                                       │   │
│  │           ▼                                                       │   │
│  │  3. Port 8081 accepting connections? (TCP connect test)          │   │
│  │           │                                                       │   │
│  │           ▼                                                       │   │
│  │  ALL THREE TRUE? → Exit with code 0 (healthy server exists)      │   │
│  │  ANY FALSE?      → Clean up stale state → Start fresh server     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  KEY: Requires BOTH process alive AND port listening.                   │
│  A stale PID file alone or port in TIME_WAIT won't cause false exit.   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Common Terminal Issues:**

| Error | Cause | Solution |
|-------|-------|----------|
| `ProcessExitedBeforeReadyError: code 0` | ws-terminal.js thought healthy server exists (stale state) | Restart sandbox via IDE button or `/restart` endpoint |
| `ProcessExitedBeforeReadyError: code 1` | Port 8081 bind failed (EADDRINUSE) | Usually resolves after retry; if persistent, restart sandbox |
| Terminal connects then immediately disconnects | Container killed by version rollout | Wait 30-45 seconds after deploy, then restart sandbox |
| "500" errors on WebSocket connect | ws-terminal.js failed to start | Check worker logs via `wrangler tail`; restart sandbox |

**Diagnosing Terminal Issues:**

```bash
# 1. Check worker logs for ws-terminal startup
cd claude-sandbox-worker && npx wrangler tail --format pretty

# 2. Look for these key log messages:
# [IDE] Port 8081 status: listening/not listening
# [IDE] Starting ws-terminal server for sandbox X
# [IDE] ws-terminal started for sandbox X

# 3. If terminal fails to start, you'll see:
# ProcessExitedBeforeReadyError: Process exited with code 0/1 before becoming ready

# 4. Restart sandbox to clear stale state:
curl -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/restart" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"YOUR_CHAT_ID","senderId":"YOUR_SENDER_ID","isGroup":false}'
```

---

## Real-time Log Tailing

**Correct order for capturing logs:**

1. **Start tail FIRST** (before triggering test):
   ```bash
   cd /Users/sam/projects/Andee/claude-telegram-bot
   timeout 30 npx wrangler tail --format pretty
   ```
   - Real-time only - **no history**, won't show past events
   - Use `timeout 30` to auto-stop (increase if logs get cut off mid-request)

2. **Trigger your test** (in another terminal or device):
   - Send Telegram message, OR
   - Run curl command

3. **Read logs** that appeared in the tail output

**For sandbox worker logs** (run in separate terminal):
```bash
cd /Users/sam/projects/Andee/claude-sandbox-worker
timeout 30 npx wrangler tail --format pretty
```

**Tip:** Tail both workers simultaneously in split terminals to see the full request flow.

---

## Agent Logs

The persistent server writes timestamped logs to `/workspace/telegram_agent.log`:

```bash
# Get logs for a specific chat
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/logs?chatId=CHAT_ID" | jq -r '.log'
```

### Example Log Output

```
[2026-01-11T16:07:26.749Z] SERVER starting on port 8080
[2026-01-11T16:07:26.751Z] SERVER ready on port 8080
[2026-01-11T16:07:26.752Z] LOOP starting (session=null)
[2026-01-11T16:07:26.753Z] LOOP waiting for message...
[2026-01-11T16:07:26.999Z] MESSAGE received: text=What is 2+2?...
[2026-01-11T16:07:27.000Z] LOOP processing: What is 2+2?...
[2026-01-11T16:07:27.166Z] MESSAGE received: text=What is 3+3?...  ← ARRIVED WHILE BUSY (queued)
[2026-01-11T16:07:30.567Z] SESSION id=ff7963e6-e432-4823-b93f-4334ac157edc
[2026-01-11T16:07:30.750Z] COMPLETE cost=$0.0074 chars=1
[2026-01-11T16:07:31.090Z] TELEGRAM_SENT
[2026-01-11T16:07:31.316Z] R2_SESSION_UPDATED
[2026-01-11T16:07:33.095Z] LOOP iteration complete, waiting for next message...
[2026-01-11T16:07:33.095Z] LOOP processing: What is 3+3?...        ← PICKED UP FROM QUEUE!
[2026-01-11T16:07:36.986Z] COMPLETE cost=$0.0090 chars=1
[2026-01-11T16:07:37.458Z] TELEGRAM_SENT
[2026-01-11T16:07:39.463Z] LOOP iteration complete, waiting for next message...
[2026-01-11T16:07:39.463Z] LOOP waiting for message...             ← READY FOR MORE
```

---

## Log Event Reference

| Event | Meaning |
|-------|---------|
| `SERVER starting/ready` | HTTP server lifecycle |
| `LOOP starting/waiting/processing` | Message loop state |
| `LOOP iteration complete` | query() finished, ready for next message |
| `MESSAGE received` | New message from Worker (may be queued if busy) |
| `SESSION id=X` | Claude session ID captured |
| `TOOL_START/TOOL_END` | Tool execution tracking |
| `COMPLETE cost=$X chars=Y` | Response complete with cost |
| `TELEGRAM_SENT` | Response sent to user |
| `R2_SESSION_UPDATED` | Session persisted to R2 |
| `ASYNC_SNAPSHOT success/failed/error` | Per-message snapshot (fires after each response) |
| `AUTO_SNAPSHOT creating/created/error` | Fallback snapshot (55min idle) |
| `[TEST] Skipping {method}` | Grammy API call skipped for test user (telegram-bot only) |
| `[VOICE] Received voice message` | Audio data received from Telegram |
| `[VOICE] Starting transcription` | Beginning Workers AI Whisper call |
| `[VOICE] Whisper API returned in Xms` | Transcription timing complete |
| `[VOICE] Transcription successful` | Text extracted from audio |
| `[VOICE] Transcription failed` | Error during speech-to-text |
| `[SchedulerDO] Alarm fired` | DO alarm triggered for reminder delivery |
| `[SchedulerDO] Processing N due reminders` | Number of reminders being processed |
| `[SchedulerDO] Sent reminder X` | Reminder message delivered to Telegram |
| `[SchedulerDO] Pinned message X in chat Y` | Reminder auto-pinned successfully |
| `[SchedulerDO] Failed to pin message X` | Pin failed (bot not admin in group) |
| `[SchedulerDO] Sent pin failure notification` | One-time tip sent about admin perms |
| `[SchedulerDO] Alarm set for X` | Next alarm scheduled |

---

## Claude SDK Transcripts (Internal Reasoning)

The `/logs` endpoint shows high-level agent events, but for deep debugging you need
Claude's **internal transcripts** - the JSONL files containing thinking and tool calls.

### Where Transcripts Live

Inside the container:
```
/home/claude/.claude/projects/-workspace-files/
├── {sessionId}.jsonl           ← Main conversation transcript
└── subagents/
    └── agent-{id}.jsonl        ← Subagent transcripts
```

### Quick Access via /transcripts Endpoint

```bash
# List all sessions for a chat
curl "https://claude-sandbox-worker.samuel-hagman.workers.dev/transcripts?chatId=CHAT_ID" \
  -H "X-API-Key: $ANDEE_API_KEY"

# Get the latest transcript (newest first)
curl "https://claude-sandbox-worker.samuel-hagman.workers.dev/transcripts?chatId=CHAT_ID&latest=true" \
  -H "X-API-Key: $ANDEE_API_KEY"

# Get just the thinking blocks (most useful for debugging)
curl "https://claude-sandbox-worker.samuel-hagman.workers.dev/transcripts?chatId=CHAT_ID&latest=true&thinkingOnly=true" \
  -H "X-API-Key: $ANDEE_API_KEY"

# Get just the tool calls
curl "https://claude-sandbox-worker.samuel-hagman.workers.dev/transcripts?chatId=CHAT_ID&latest=true&toolsOnly=true" \
  -H "X-API-Key: $ANDEE_API_KEY"

# Pagination - get last 3 entries
curl "https://claude-sandbox-worker.samuel-hagman.workers.dev/transcripts?chatId=CHAT_ID&latest=true&limit=3" \
  -H "X-API-Key: $ANDEE_API_KEY"

# Page 2 (skip first 3)
curl "https://claude-sandbox-worker.samuel-hagman.workers.dev/transcripts?chatId=CHAT_ID&latest=true&limit=3&offset=3" \
  -H "X-API-Key: $ANDEE_API_KEY"
```

### Transcript Structure

Each JSONL line is an entry. **Content is an array of blocks**, not flat fields:

```json
{
  "type": "assistant",
  "timestamp": "2026-01-20T11:00:33.520Z",
  "message": {
    "content": [
      {
        "type": "thinking",
        "thinking": "The user wants a weather report. I should use the weather skill..."
      },
      {
        "type": "tool_use",
        "id": "toolu_01...",
        "name": "Skill",
        "input": { "skill": "weather", "args": "Boston" }
      },
      {
        "type": "text",
        "text": "Good morning! Here's the weather..."
      }
    ]
  }
}
```

**Content block types:**
| Block Type | Contains |
|------------|----------|
| `thinking` | Claude's internal reasoning (THE GOLD for debugging) |
| `tool_use` | Tool call with name and input arguments |
| `text` | Final text response to user |
| `tool_result` | Result returned from a tool |

### IDE Terminal Access

```bash
# List all session files
ls -la /home/claude/.claude/projects/-workspace-files/*.jsonl

# Extract thinking blocks (inside content array)
cat /home/claude/.claude/projects/-workspace-files/*.jsonl | \
  jq -r 'select(.message.content) | .message.content[] | select(.type=="thinking") | .thinking'

# List all tool calls Claude made
cat /home/claude/.claude/projects/-workspace-files/*.jsonl | \
  jq -r 'select(.message.content) | .message.content[] | select(.type=="tool_use") | .name'
```

### Debugging Example: Slow Image Processing

When image processing is slow, check what tools Claude called:

```bash
# Via API - quick tool list
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/transcripts?chatId=CHAT_ID&latest=true&toolsOnly=true" \
  -H "X-API-Key: $ANDEE_API_KEY" | jq '.tools[] | .name'

# Via API - what was Claude thinking?
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/transcripts?chatId=CHAT_ID&latest=true&thinkingOnly=true" \
  -H "X-API-Key: $ANDEE_API_KEY" | jq '.thinking[] | .thinking'
```

If you see `analyzing-media` skill being invoked when it shouldn't be (Claude has native vision), that's your culprit. The thinking blocks will show WHY Claude chose that tool.

### Comparing /logs vs /transcripts

| `/logs` (Agent Log) | `/transcripts` (Claude SDK) |
|---------------------|----------------------------|
| High-level events | Full conversation detail |
| MESSAGE, TOOL_START, COMPLETE | Actual tool arguments, thinking |
| Good for timing/flow | Good for "why did Claude do X?" |
| `/workspace/telegram_agent.log` | `/home/claude/.claude/projects/-workspace-files/*.jsonl` |

---

## Storage Locations

| Location | Purpose |
|----------|---------|
| R2: `andee-sessions/sessions/{chatId}.json` | Session IDs, message counts |
| R2: `andee-snapshots/snapshots/{chatId}/{timestamp}.tar.gz` | Filesystem backups |
| Container: `~/.claude/` | Claude session transcripts |
| Container: `/workspace/telegram_agent.log` | Agent logs |
| Container: `/workspace/files/` | Working directory |

---

## Diagnostics

```bash
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/diag" | jq .
```

---

## Resetting Sandboxes

Creates a snapshot of the current state, then destroys the container and clears the R2 session:

```bash
curl -s -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/reset" \
  -H "Content-Type: application/json" \
  -d '{"chatId":"CHAT_ID"}'
# Returns: { success: true, snapshotKey: "snapshots/CHAT_ID/..." }
```

The next request to this chatId will automatically restore from the latest snapshot.

---

## R2 Session Management

```bash
# List sessions
npx wrangler r2 object list andee-sessions --remote

# Get specific session
npx wrangler r2 object get andee-sessions/sessions/CHAT_ID.json --pipe --remote

# Delete session manually
npx wrangler r2 object delete andee-sessions/sessions/CHAT_ID.json --remote
```

---

## Snapshot Management

Snapshots backup `/workspace` and `/home/claude` directories to R2.

### API Endpoints

```bash
# Create manual snapshot
curl -s -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/snapshot" \
  -H "Content-Type: application/json" \
  -d '{"chatId":"CHAT_ID"}'

# List snapshots for a chat
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/snapshots?chatId=CHAT_ID"

# Get latest snapshot (returns tar.gz)
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/snapshot?chatId=CHAT_ID" -o snapshot.tar.gz
```

### Snapshot Immutability Policy

> **NEVER delete snapshots.** Snapshots are append-only and serve as an immutable historical record. If you need a clean slate, create an empty snapshot and restore to it—don't delete history.

**Why?**
- Snapshots are the audit trail / undo history
- Deleting loses the ability to recover from mistakes
- Storage is cheap; history is invaluable

**Need a fresh start?** Use `/factory-reset` via Telegram or the API. This:
1. Creates a pre-reset snapshot (preserving history)
2. Destroys the container
3. Wipes the session (amnesia)
4. Next message starts fresh but can still restore old snapshots if needed

### Wrangler R2 Commands

```bash
# List all snapshots
npx wrangler r2 object list andee-snapshots --prefix=snapshots/ --remote

# List snapshots for specific chat
npx wrangler r2 object list andee-snapshots --prefix=snapshots/CHAT_ID/ --remote

# Download a snapshot
npx wrangler r2 object get andee-snapshots/snapshots/CHAT_ID/2024-01-05T12:00:00.000Z.tar.gz --file=snapshot.tar.gz --remote

# ⚠️ DO NOT DELETE SNAPSHOTS - See "Snapshot Immutability Policy" above
```

### Snapshot Lifecycle

| Trigger | When |
|---------|------|
| Per-message (async) | After each Claude response sent to Telegram (non-blocking) |
| Fallback (idle timer) | After 55 minutes of inactivity (before 1h sleep) |
| Pre-reset | Before `/reset` or `/factory-reset` destroys the sandbox |
| Manual | User calls `/snapshot` command in Telegram |

**Note**: Per-message snapshots ensure you never lose more than one message worth of data. The idle timer is a fallback in case per-message snapshots fail.

### Restore Behavior

- Snapshots are automatically restored when a fresh container starts
- Restore happens in both `/ask` endpoint (Telegram messages) and `/files` endpoint (IDE)
- The latest snapshot (by timestamp) is always used
- IDE uses marker file `/tmp/.ide-initialized` to track if auto-restore already happened
- **No size limits**: Both endpoints use presigned URL + curl, supporting snapshots of any size

### IDE Snapshot Management

The Sandbox IDE supports creating, browsing, and restoring snapshots via the 📷 button:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  IDE SNAPSHOT MANAGEMENT                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  📸 Take: Create a new snapshot immediately                             │
│     - Button in dropdown header next to × close button                  │
│     - Backs up /workspace and /home/claude to R2                        │
│     - Shows loading state ("Taking...") during creation                 │
│     - New snapshot appears at top of list with LATEST badge             │
│                                                                         │
│  👁 Preview: Browse snapshot without restoring                          │
│     - Downloads tar to /tmp, lists with tar -tzf                        │
│     - Navigate directories, view file contents                          │
│     - Useful for checking "what's in this old snapshot?"                │
│                                                                         │
│  ↩ Restore: Replace container files with snapshot                       │
│     1. Generate presigned URL for R2 snapshot                           │
│     2. Container curls directly from R2 (bypasses Worker limits)        │
│     3. Extract tar.gz excluding system files (.claude/skills, etc.)     │
│     4. Copy snapshot to R2 as "latest" (markAsLatest)                   │
│     5. Session may become stale → click "Restart Sandbox"               │
│                                                                         │
│  Auto-restore on IDE access:                                            │
│     - `maybeAutoRestore()` in ide.ts checks /tmp/.ide-initialized       │
│     - If missing, calls `restoreFromSnapshot()` from container-startup  │
│     - Uses same presigned URL approach - NO size limits                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Restore Edge Cases & Gotchas

| Issue | Symptom | Solution |
|-------|---------|----------|
| Session stale after restore | `Unknown Error, TODO` when browsing files | Click "Restart Sandbox" - fresh container will auto-restore from R2 |
| Files lost after restart | Files were there, now gone | Fixed (2026-01-22). IDE `maybeAutoRestore()` now uses `restoreFromSnapshot()` with presigned URLs - no size limits |
| markAsLatest failed | Response shows `markAsLatestError` | markAsLatest now copies original snapshot to R2 instead of re-tarring (avoids session staleness) |

**Note**: Large snapshot issues (stack overflow, 10MB limits) have been resolved. Both `/ask` and `/files` endpoints now use `restoreFromSnapshot()` from `container-startup.ts`, which downloads snapshots via presigned URL + curl directly in the container, bypassing all Worker memory/RPC limits.

### Restore Endpoints

```bash
# Preview snapshot contents (without restoring)
curl "https://claude-sandbox-worker.../snapshot-files?sandbox=chat-X&snapshotKey=Y&path=/&chatId=X&senderId=Y&isGroup=Z"

# Restore snapshot (replaces container files)
curl -X POST "https://claude-sandbox-worker.../restore" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"X","senderId":"Y","isGroup":false,"snapshotKey":"snapshots/Y/X/2026-01-12T04-16-53-540Z.tar.gz","markAsLatest":true}'
```

---

## Testing Endpoints Directly

```bash
# Health check
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/"

# Test /ask endpoint (persistent server, fire-and-forget)
curl -s -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/ask" \
  -H "Content-Type: application/json" \
  -d '{"chatId":"test","message":"hello","botToken":"fake-token","claudeSessionId":null,"userMessageId":1}'

# Check if persistent server is running (look for "Persistent server already running")
# Send second message to same chatId and check wrangler tail logs
```

### Test User Log Behavior

When testing with TEST_USER_1 (999999999) or TEST_USER_2 (888888888), the telegram-bot's Grammy transformer skips Telegram API calls:

```bash
# Send test webhook to telegram-bot (port 8788 locally, production URL for prod)
curl -X POST http://localhost:8788/ \
  -H "Content-Type: application/json" \
  -d '{"update_id":1,"message":{"message_id":1,"from":{"id":999999999,"first_name":"TestUser1","is_bot":false},"chat":{"id":999999999,"type":"private"},"date":1704650400,"text":"Hello test!"}}'

# Expected logs (no GrammyError):
# [AUTH] User unknown (ID: 999999999) in chat 999999999 (type: private, isGroup: false)
# [999999999] Received: Hello test!...
# [TEST] Skipping setMessageReaction for test chat 999999999
```

**Important:** For commands like `/start` to be recognized, include the `entities` field in your test payload:
```json
{
  "text": "/start",
  "entities": [{"type": "bot_command", "offset": 0, "length": 6}]
}
```

---

## Verify Persistent Server

```bash
# 1. Reset sandbox
curl -s -X POST ".../reset" -d '{"chatId":"perf-test"}'

# 2. Send first message (starts server)
curl -s -X POST ".../ask" -d '{"chatId":"perf-test","message":"hi","botToken":"fake","userMessageId":1}'

# 3. Wait 10 seconds, check logs
curl -s ".../logs?chatId=perf-test" | jq -r '.log'
# Should see: LOOP waiting for message... (server is persistent)

# 4. Send second message (should reuse server - ~3.5s instead of ~7s)
curl -s -X POST ".../ask" -d '{"chatId":"perf-test","message":"test","botToken":"fake","userMessageId":2}'

# 5. Check wrangler tail - should see "Persistent server already running"
```

---

## Common Issues & Solutions

### Issue: "Claude Code process exited with code 1"

**Cause:** Claude Code CLI process exited unexpectedly. This can happen due to:
- Orphaned session ID in R2 (session doesn't exist in new container)
- Permission issues (HOME env var not set correctly)
- Transient errors during startup

**Automatic Recovery:** As of 2026-01-11, the persistent server automatically:
1. Detects "exited with code 1" errors
2. Clears any stale session ID
3. Retries once with fresh state
4. Only fails permanently if retry also fails

**Manual Solution (if auto-recovery fails):**
```bash
# Reset the sandbox (clears container + R2 session)
curl -s -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/reset" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"CHAT_ID","senderId":"SENDER_ID","isGroup":false}'

# Check logs for details
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/logs?chatId=CHAT_ID" \
  -H "X-API-Key: $ANDEE_API_KEY" | jq -r '.log'
```

### Issue: Eye emoji reaction but no response

**Possible causes:**
1. **30-second Worker timeout** (fixed in current code - agent runs in background)
2. **Container version rollout** - message arrived during deployment
3. **Agent crashed** - check logs

**Diagnosis:**
```bash
# Check agent logs
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/logs?chatId=CHAT_ID" | jq -r '.log'

# If "No log file found" - agent didn't start, check worker logs
npx wrangler tail --format pretty
```

### Issue: Markdown not rendering (showing raw `**bold**`)

**Cause:** The bot uses `parse_mode: "MarkdownV2"` with automatic escaping via `escapeMarkdownV2()`. If markdown isn't rendering, check that the escape function is being called.

**Location:** `claude-sandbox-worker/src/index.ts` in `PERSISTENT_SERVER_SCRIPT`'s `sendToTelegram` function.

### Issue: Container slow / queries taking 45+ seconds

**Cause:** Using default `lite` instance type (1/16 vCPU).

**Solution:** Upgrade instance type in `wrangler.toml`:
```toml
instance_type = "standard-4"
```

Then deploy and reset sandboxes.

### Issue: "Network connection lost" in sandbox logs

**Cause:** Container was terminated (often due to deployment or idle timeout).

**Solution:** Next request will spin up fresh container. If persistent, check Cloudflare status.

### Issue: Port 3000 already in use (EADDRINUSE)

**Cause:** Port 3000 is reserved by Cloudflare Sandbox infrastructure (internal Bun server).

**Solution:** Use port 8080 for the persistent HTTP server instead. This is already configured correctly.

### Issue: "ProcessExitedBeforeReadyError: Process exited with code 1"

**Cause:** The persistent server script failed to start. Common reasons:
1. Port conflict (using 3000 instead of 8080)
2. Missing environment variables (ANTHROPIC_API_KEY, HOME)
3. Import errors in the script

**Solution:**
```bash
# Check if server is using wrong port
grep "const PORT" claude-sandbox-worker/src/index.ts  # Should be 8080

# Verify environment variables are passed correctly in startProcess()
# Should use: { env: { ANTHROPIC_API_KEY: ..., HOME: "/home/claude" } }
```

### Issue: Persistent server not reusing (every message shows "Starting persistent server")

**Cause:** Container is being destroyed between messages (deployment, timeout, or reset).

**Diagnosis:**
```bash
# Check wrangler tail - should show "Persistent server already running" for 2nd message
npx wrangler tail --format pretty

# Check if sleepAfter is configured
grep "sleepAfter" claude-sandbox-worker/src/index.ts  # Should be "1h"
```

### Issue: Skill not found

**Cause:** SKILL.md syntax error or container not rebuilt.

**Solution:**
1. Check SKILL.md YAML frontmatter syntax
2. Rebuild container: `cd claude-sandbox-worker && npm run dev`
3. For production: deploy and reset sandboxes

### Issue: Direct Link Mini App not opening

**Cause:** Link format incorrect or BotFather not configured.

**Solution:**
1. Verify format: `[Text](https://t.me/HeyAndee_bot/app?startapp={component}_{base64url})`
2. Check startapp uses underscore separator between component and data
3. Verify shell Mini App is registered in BotFather (short name: `app`)

### Issue: Mini App data error

**Cause:** Base64url encoding issue or URL too long.

**Solution:**
1. Verify base64url encoding (NOT standard base64):
   ```javascript
   const base64url = btoa(JSON.stringify(data))
     .replace(/\+/g, '-')   // + → -
     .replace(/\//g, '_')   // / → _
     .replace(/=+$/, '');   // Remove padding
   ```
2. Check URL length limits (~512 chars for startapp parameter)
3. Keep data minimal - use compact keys (e.g., `loc` not `location`)
4. For TypeScript components, ensure data matches the interface in `apps/src/lib/types/`

### Issue: Container errors during build

**Cause:** Dockerfile issues or npm package errors.

**Solution:**
1. Check Dockerfile syntax
2. Verify npm packages are available
3. Check `npm run dev` output for specific errors

### Issue: IDE snapshot restore loses files after restart

**Cause:** Before the fix, fresh containers didn't auto-restore from R2. The restore extracted files, but when you clicked "Restart Sandbox" to fix the stale session, the fresh container started empty.

**Solution (now automatic):** `handleFiles()` in ide.ts now checks for `/tmp/.ide-initialized` marker. If missing, it auto-restores from the latest R2 snapshot before listing files.

**If files are still missing after restore:**
1. Check network requests - did `markAsLatest` succeed? (look for `newSnapshotKey` in response)
2. If `markAsLatestError` is present, the snapshot wasn't copied to R2 as latest
3. Try restoring again with fresh browser (clear any cached state)

### Issue: "Maximum call stack size exceeded" on large snapshots

**Cause:** Using spread operator on large Uint8Array: `btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))`. JavaScript function arguments have a limit (~32KB-65KB depending on engine).

**Solution:** Build binary string in chunks, then btoa once:
```typescript
const bytes = new Uint8Array(arrayBuffer);
const CHUNK_SIZE = 32768; // 32KB
let binaryString = '';
for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
  const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
  binaryString += String.fromCharCode.apply(null, Array.from(chunk));
}
const base64Data = btoa(binaryString);
```

**Affected files:** `snapshot.ts`, `snapshot-preview.ts`, `ide.ts` (all now fixed)

### Issue: Voice message returns empty transcription

**Error:** `[VOICE] Transcription returned empty text`

**Causes:**
1. Audio too short (< 0.5s)
2. Corrupted audio file
3. Audio is silence or unintelligible

**Solution:**
1. Try a longer voice clip
2. Check audio format is OGG/OPUS (Telegram's native format)
3. Verify audio contains clear speech

### Issue: Voice transcription timeout or error

**Error:** `[VOICE] Transcription failed: ...` or Workers AI timeout

**Causes:**
1. Audio file too large (> 25MB limit)
2. Workers AI service issue
3. Invalid audio format

**Solution:**
1. Telegram voice notes are typically small (~200KB/min), so size shouldn't be an issue
2. Check Cloudflare status page for Workers AI issues
3. Ensure audio is proper OGG/OPUS format from Telegram

### Issue: Voice message not detected

**Cause:** Grammy handler not receiving voice message event.

**Solution:**
1. Check telegram-bot logs for `message:voice` handler
2. Verify audio was sent as voice note (hold-to-record), not audio file attachment
3. Audio file attachments are not yet supported (only voice notes)

### Issue: Timezone not applied / Reminders at wrong time

**Cause:** User hasn't set their timezone, or TZ isn't being read on cold start.

**Verify timezone is set:**
```bash
# Check worker logs on cold start
wrangler tail claude-sandbox-worker
# Look for: "[Worker] User {id} timezone: America/Los_Angeles"

# Check preferences file in container via IDE or curl
# Browse to /home/claude/private/{senderId}/preferences.yaml
```

**Common issues:**
| Symptom | Cause | Fix |
|---------|-------|-----|
| No timezone log on startup | No preferences.yaml | User needs to set timezone ("My timezone is X") |
| TZ not updating mid-session | Expected behavior | TZ env var applies on next cold start only |
| Reminders at wrong time | Wrong TZ string | Use IANA format (America/New_York, not EST) |

---

## Dockerfile / Container Setup Issues

Quick reference for container build and setup issues:

### Bun AVX Crash (Apple Silicon / Docker Desktop)

**Error:**
```
CPU lacks AVX support
Illegal instruction at address 0x4001FB4
```

**Root Cause:** Docker Desktop on Apple Silicon uses Rosetta 2 for x86_64 emulation. Rosetta does NOT support AVX instructions. Some Bun versions (e.g., 1.3.6) have regressions where their "baseline" build still triggers AVX code paths.

**Solutions:**

1. **Disable Rosetta in Docker Desktop** (recommended):
   - Docker Desktop → Settings → General
   - Uncheck "Use Rosetta for x86_64/amd64 emulation on Apple Silicon"
   - Apply & Restart

2. **Pin Bun to a working version** in Dockerfile:
   ```dockerfile
   # PINNED to v1.3.5: v1.3.6 has AVX regression causing crash under Rosetta
   RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/root/.bun bash -s "bun-v1.3.5" && \
       mv /root/.bun/bin/bun /usr/local/bin/bun
   ```

**Why it happens intermittently:** You may see this work in the morning but fail later because Docker pulled a new base image or Bun's install script installed a newer version with the regression.

**References:**
- [Bun Issue #19309](https://github.com/oven-sh/bun/issues/19309) - AVX crashes in baseline builds
- [Docker for Mac #7137](https://github.com/docker/for-mac/issues/7137) - Rosetta breaks amd64 images needing AVX

---

| Problem | Error | Solution |
|---------|-------|----------|
| Bun AVX crash | `CPU lacks AVX support` / `Illegal instruction` | Disable Rosetta in Docker Desktop OR pin Bun to 1.3.5 (see above) |
| Claude refuses root | `--dangerously-skip-permissions cannot be used with root/sudo` | Create non-root user in Dockerfile: `RUN useradd -m -s /bin/bash claude` then `USER claude` |
| ESM can't find global npm packages | `Cannot find package '@anthropic-ai/claude-agent-sdk'` | Symlink in Dockerfile: `RUN ln -s /usr/local/lib/node_modules /workspace/node_modules` |
| Sandbox SQL not enabled | `SQL is not enabled for this Durable Object class` | Use `new_sqlite_classes` in wrangler.toml migrations |
| Claude can't find config | Process fails silently | Set `HOME=/home/claude` via `env` option in `startProcess()` |
| Container killed on deploy | `Runtime signalled the container to exit due to a new version rollout` | Transient - next message will spin up fresh container |
| Memvid file not found | `memvid find` returns empty | File is created on first `memvid put`. Check if `.mv2` file exists first. |
| Terminal lines wrong position | Text at random positions | Ensure ws-terminal.js uses `pty.spawn()`, not `child_process.spawn()` |
| node-pty build fails | `gyp ERR! build error` | Add build-essential + python3 to Dockerfile before `npm install -g node-pty` |

---

## Performance Timing Analysis

### Persistent Server Performance

| Message Type | Time | Breakdown |
|--------------|------|-----------|
| First message (cold start) | ~7s | Container startup + Claude CLI + response |
| Subsequent messages (warm) | ~3.5s | Just response (server already running) |
| After 1 hour idle | ~7s | Container slept, fresh cold start |

### Log-based Timing Analysis

```
[timestamp] SERVER starting      - Container spawned, HTTP server init
[timestamp] SERVER ready         - Port 8080 listening
[timestamp] LOOP starting        - Message loop started
[timestamp] LOOP waiting         - Ready for messages (blocking)
[timestamp] MESSAGE received     - Worker sent message (may be queued if busy)
[timestamp] LOOP processing      - Processing message from queue
[timestamp] SESSION id=X         - Claude session captured
[timestamp] TOOL_START name=X    - Tool execution began
[timestamp] TOOL_END id=X        - Tool execution finished
[timestamp] COMPLETE cost=$X     - Response complete, shows cost
[timestamp] TELEGRAM_SENT        - Sent to Telegram API
[timestamp] R2_SESSION_UPDATED   - Session persisted
[timestamp] LOOP iteration complete - Ready for next message
```

### Timing Breakdown (warm message)

- Message receive → SESSION: ~0.5s (generator wakeup)
- SESSION → COMPLETE: 2-4s (Anthropic API response)
- COMPLETE → TELEGRAM_SENT: ~0.3s (network)

**Key optimization**: The `while(true)` loop processes messages one at a time with session resumption. Messages arriving while Claude is busy are queued and processed in order. Each `query()` call shares context via session ID.
