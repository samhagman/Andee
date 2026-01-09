# Debugging Guide

Troubleshooting and debugging Andee issues.

## Contents

- [Sandbox IDE (Direct Container Access)](#sandbox-ide-direct-container-access)
- [Real-time Log Tailing](#real-time-log-tailing)
- [Agent Logs](#agent-logs)
- [Log Event Reference](#log-event-reference)
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
│     $ memvid find /home/claude/shared/shared.mv2 "query"                │
│                                                                         │
│  5. Verify YAML in artifacts                                            │
│     $ yq '.tags' /home/claude/shared/lists/recipes/pasta-abc123.md      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Terminal Server Location

The terminal is served by `claude-sandbox-worker/.claude/scripts/ws-terminal.js` on port 8081. Uses node-pty for proper PTY emulation (required for Claude Code TUI to work).

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
[2026-01-05T03:24:43.457Z] SERVER starting on port 8080
[2026-01-05T03:24:43.471Z] CLAUDE starting query loop with streaming input...
[2026-01-05T03:24:43.483Z] GENERATOR waiting for message...
[2026-01-05T03:24:43.484Z] SERVER ready on port 8080
[2026-01-05T03:24:43.999Z] MESSAGE received: chat=log-test text=hi...
[2026-01-05T03:24:44.000Z] GENERATOR yielding message: hi...
[2026-01-05T03:24:44.001Z] GENERATOR waiting for message...  ← Ready for next message!
[2026-01-05T03:24:45.887Z] SESSION id=ff7963e6-e432-4823-b93f-4334ac157edc
[2026-01-05T03:24:50.350Z] COMPLETE cost=$0.0072 chars=35
[2026-01-05T03:24:50.730Z] TELEGRAM_SENT
[2026-01-05T03:24:51.316Z] R2_SESSION_UPDATED
[2026-01-05T03:25:15.363Z] MESSAGE received: chat=log-test text=what is 2+2...  ← Second message!
[2026-01-05T03:25:15.364Z] GENERATOR yielding message: what is 2+2...
[2026-01-05T03:25:18.910Z] COMPLETE cost=$0.0180 chars=55
[2026-01-05T03:25:19.199Z] TELEGRAM_SENT
```

---

## Log Event Reference

| Event | Meaning |
|-------|---------|
| `SERVER starting/ready` | HTTP server lifecycle |
| `GENERATOR waiting/yielding` | Streaming input mode state |
| `MESSAGE received` | New message from Worker |
| `SESSION id=X` | Claude session ID captured |
| `TOOL_START/TOOL_END` | Tool execution tracking |
| `COMPLETE cost=$X chars=Y` | Response complete with cost |
| `TELEGRAM_SENT` | Response sent to user |
| `R2_SESSION_UPDATED` | Session persisted to R2 |
| `AUTO_SNAPSHOT creating/created/error` | Auto-snapshot (55min idle) |
| `[TEST] Skipping {method}` | Grammy API call skipped for test user (telegram-bot only) |
| `[VOICE] Received voice message` | Audio data received from Telegram |
| `[VOICE] Starting transcription` | Beginning Workers AI Whisper call |
| `[VOICE] Whisper API returned in Xms` | Transcription timing complete |
| `[VOICE] Transcription successful` | Text extracted from audio |
| `[VOICE] Transcription failed` | Error during speech-to-text |

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

# Delete all snapshots for a chat
curl -s -X DELETE "https://claude-sandbox-worker.samuel-hagman.workers.dev/snapshot?chatId=CHAT_ID&key=all"
```

### Wrangler R2 Commands

```bash
# List all snapshots
npx wrangler r2 object list andee-snapshots --prefix=snapshots/ --remote

# List snapshots for specific chat
npx wrangler r2 object list andee-snapshots --prefix=snapshots/CHAT_ID/ --remote

# Download a snapshot
npx wrangler r2 object get andee-snapshots/snapshots/CHAT_ID/2024-01-05T12:00:00.000Z.tar.gz --file=snapshot.tar.gz --remote

# Delete a snapshot
npx wrangler r2 object delete andee-snapshots/snapshots/CHAT_ID/2024-01-05T12:00:00.000Z.tar.gz --remote
```

### Snapshot Lifecycle

| Trigger | When |
|---------|------|
| Auto (idle timer) | After 55 minutes of inactivity (before 1h sleep) |
| Pre-reset | Before `/reset` destroys the sandbox |
| Manual | User calls `/snapshot` command in Telegram |

### Restore Behavior

- Snapshots are automatically restored when a fresh container starts
- Restore happens in the `/ask` endpoint
- The latest snapshot (by timestamp) is always used

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
# Should see: GENERATOR waiting for message... (server is persistent)

# 4. Send second message (should reuse server - ~3.5s instead of ~7s)
curl -s -X POST ".../ask" -d '{"chatId":"perf-test","message":"test","botToken":"fake","userMessageId":2}'

# 5. Check wrangler tail - should see "Persistent server already running"
```

---

## Common Issues & Solutions

### Issue: "Claude Code process exited with code 1"

**Cause:** Orphaned session ID in R2. The R2 session has a claudeSessionId that doesn't exist in the container (e.g., after sandbox reset).

**Solution:**
```bash
# Delete the R2 session
npx wrangler r2 object delete andee-sessions/sessions/CHAT_ID.json --remote

# Or reset the sandbox (which now also deletes R2 session)
curl -s -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/reset" \
  -H "Content-Type: application/json" \
  -d '{"chatId":"CHAT_ID"}'
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
[timestamp] GENERATOR waiting    - Claude ready for messages
[timestamp] MESSAGE received     - Worker sent message
[timestamp] SESSION id=X         - Claude session captured
[timestamp] TOOL_START name=X    - Tool execution began
[timestamp] TOOL_END id=X        - Tool execution finished
[timestamp] COMPLETE cost=$X     - Response complete, shows cost
[timestamp] TELEGRAM_SENT        - Sent to Telegram API
[timestamp] R2_SESSION_UPDATED   - Session persisted
```

### Timing Breakdown (warm message)

- Message receive → SESSION: ~0.5s (generator wakeup)
- SESSION → COMPLETE: 2-4s (Anthropic API response)
- COMPLETE → TELEGRAM_SENT: ~0.3s (network)

**Key optimization**: Claude CLI starts ONCE per container lifecycle. The async generator keeps Claude alive between messages, eliminating ~3s startup overhead on subsequent messages.
