---
name: andee-ops
description: Operations guide for deploying, debugging, and managing Andee - the Claude-powered Telegram bot on Cloudflare. Use when deploying, checking logs, debugging issues, or managing containers.
---

# Andee Operations Guide

Complete operations reference for the Andee Telegram bot running on Cloudflare Workers + Containers.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PRODUCTION ARCHITECTURE (Persistent Server)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Telegram ──► Webhook ──► claude-telegram-bot (Worker)                      │
│                                    │                                        │
│                                    │ Service Binding                        │
│                                    ▼                                        │
│                          claude-sandbox-worker (Worker + Durable Object)    │
│                                    │                                        │
│                                    │ Sandbox SDK (startProcess, waitForPort)│
│                                    ▼                                        │
│                          Container (Firecracker, per-user, sleepAfter: 1h)  │
│                                    │                                        │
│  ┌─────────────────────────────────┴─────────────────────────────────────┐  │
│  │  INSIDE CONTAINER                                                     │  │
│  │                                                                       │  │
│  │  HTTP Server (port 8080) ◄─── Worker POSTs messages via curl          │  │
│  │       │                                                               │  │
│  │       ▼                                                               │  │
│  │  Async Generator (streaming input mode)                               │  │
│  │       │                                                               │  │
│  │       ▼                                                               │  │
│  │  Claude Agent SDK ──► query() ──► Claude CLI (starts ONCE)            │  │
│  │       │                                                               │  │
│  │       ▼                                                               │  │
│  │  Response ──► Telegram API (directly from container)                  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  PERFORMANCE                                                                │
│  • First message: ~7s (container + Claude CLI startup)                      │
│  • Subsequent messages: ~3.5s (reuses persistent server, no CLI startup)    │
│  • After 1 hour idle: ~7s (container slept, fresh start)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  STORAGE                                                                    │
│  • R2: andee-sessions (session IDs, message counts)                         │
│  • Container: ~/.claude/ (Claude session transcripts)                       │
│  • Container: /workspace/telegram_agent.log (agent logs)                    │
│  • Container: /workspace/files/ (working directory)                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key insight:** Port 3000 is reserved by Cloudflare Sandbox infrastructure (Bun server). Use port 8080 for internal HTTP server.

## Deployment

### Deploy Both Workers

```bash
# Deploy sandbox worker (processes messages, runs Claude)
cd /Users/sam/projects/Andee/claude-sandbox-worker
npx wrangler deploy

# Deploy telegram bot worker (receives webhooks, forwards to sandbox)
cd /Users/sam/projects/Andee/claude-telegram-bot
npx wrangler deploy
```

### Set Secrets

```bash
# Sandbox worker needs Anthropic API key
cd /Users/sam/projects/Andee/claude-sandbox-worker
npx wrangler secret put ANTHROPIC_API_KEY

# Telegram bot needs bot token
cd /Users/sam/projects/Andee/claude-telegram-bot
npx wrangler secret put BOT_TOKEN
```

### Set Telegram Webhook

```bash
cd /Users/sam/projects/Andee/claude-telegram-bot
node scripts/set-webhook.mjs
```

## Debugging

### Real-time Log Tailing

```bash
# Tail telegram bot logs
cd /Users/sam/projects/Andee/claude-telegram-bot
npx wrangler tail --format pretty

# Tail sandbox worker logs (in another terminal)
cd /Users/sam/projects/Andee/claude-sandbox-worker
npx wrangler tail --format pretty
```

### Read Agent Logs from Container

The persistent server writes timestamped logs to `/workspace/telegram_agent.log`:

```bash
# Get logs for a specific chat
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/logs?chatId=CHAT_ID" | jq -r '.log'
```

**Example log output (persistent server):**
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

**Key log events:**
- `SERVER starting/ready` - HTTP server lifecycle
- `GENERATOR waiting/yielding` - Streaming input mode state
- `MESSAGE received` - New message from Worker
- `SESSION id=X` - Claude session ID captured
- `TOOL_START/TOOL_END` - Tool execution tracking
- `COMPLETE cost=$X chars=Y` - Response complete with cost
- `TELEGRAM_SENT` - Response sent to user
- `R2_SESSION_UPDATED` - Session persisted to R2

### Reset a User's Sandbox

Destroys the container and clears the R2 session:

```bash
curl -s -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/reset" \
  -H "Content-Type: application/json" \
  -d '{"chatId":"CHAT_ID"}'
```

### Check Session Data in R2

```bash
# List sessions
npx wrangler r2 object list andee-sessions --remote

# Get specific session
npx wrangler r2 object get andee-sessions/sessions/CHAT_ID.json --pipe --remote

# Delete session manually
npx wrangler r2 object delete andee-sessions/sessions/CHAT_ID.json --remote
```

### Run Diagnostics

```bash
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/diag" | jq .
```

### Test Endpoints Directly

```bash
# Health check
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/"

# Test /ask endpoint (synchronous, waits for response)
curl -s -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/ask" \
  -H "Content-Type: application/json" \
  -d '{"chatId":"test","message":"say hi","claudeSessionId":null}'

# Test /ask-telegram endpoint (persistent server, fire-and-forget)
curl -s -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/ask-telegram" \
  -H "Content-Type: application/json" \
  -d '{"chatId":"test","message":"hello","botToken":"fake-token","claudeSessionId":null}'

# Check if persistent server is running (look for "Persistent server already running")
# Send second message to same chatId and check wrangler tail logs
```

### Verify Persistent Server Is Working

```bash
# 1. Reset sandbox
curl -s -X POST ".../reset" -d '{"chatId":"perf-test"}'

# 2. Send first message (starts server)
curl -s -X POST ".../ask-telegram" -d '{"chatId":"perf-test","message":"hi","botToken":"fake",...}'

# 3. Wait 10 seconds, check logs
curl -s ".../logs?chatId=perf-test" | jq -r '.log'
# Should see: GENERATOR waiting for message... (server is persistent)

# 4. Send second message (should reuse server - ~3.5s instead of ~7s)
curl -s -X POST ".../ask-telegram" -d '{"chatId":"perf-test","message":"test","botToken":"fake",...}'

# 5. Check wrangler tail - should see "Persistent server already running"
```

## Container Configuration

### Instance Types

Configure in `claude-sandbox-worker/wrangler.toml`:

```toml
[[containers]]
class_name = "Sandbox"
image = "./Dockerfile"
instance_type = "standard-4"  # Options below
```

| Type | vCPU | Memory | Disk | Use Case |
|------|------|--------|------|----------|
| lite | 1/16 | 256 MiB | 2 GB | Testing only (very slow) |
| basic | 1/4 | 1 GiB | 4 GB | Light usage |
| standard-1 | 1/2 | 4 GiB | 8 GB | Normal usage |
| standard-2 | 1 | 6 GiB | 12 GB | Better performance |
| standard-3 | 2 | 8 GiB | 16 GB | Heavy usage |
| standard-4 | 4 | 12 GiB | 20 GB | Maximum performance |

**Important:** After changing instance_type, you must reset user sandboxes for them to use the new instance type.

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

### Issue: HTML tags showing raw (e.g., `<b>...</b>`)

**Cause:** Missing `parse_mode: "HTML"` in Telegram sendMessage call.

**Location:** `claude-sandbox-worker/src/index.ts` in `AGENT_TELEGRAM_SCRIPT`'s `sendToTelegram` function.

### Issue: Container slow / queries taking 45+ seconds

**Cause:** Using default `lite` instance type (1/16 vCPU).

**Solution:** Upgrade instance type in `wrangler.toml`:
```toml
instance_type = "standard-4"
```

Then deploy and reset sandboxes.

### Issue: "Runtime signalled the container to exit due to a new version rollout"

**Cause:** User sent message during deployment. Container was killed for version update.

**Solution:** Transient issue - just retry. Message sent after deployment completes will work.

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

## Key Files

| File | Purpose |
|------|---------|
| `claude-sandbox-worker/src/index.ts` | Main worker with `PERSISTENT_SERVER_SCRIPT` (streaming input), endpoints, Sandbox SDK |
| `claude-sandbox-worker/wrangler.toml` | Container config, R2 bindings, instance type, sleepAfter |
| `claude-sandbox-worker/Dockerfile` | Container image with Claude CLI + SDK, EXPOSE 8080 |
| `claude-sandbox-worker/.claude/skills/` | Skills available to the bot (weather, etc.) |
| `claude-telegram-bot/src/index.ts` | Grammy bot, webhook handler, InlineKeyboard support |
| `claude-telegram-bot/wrangler.toml` | Service binding to sandbox worker |

**Key code locations in `src/index.ts`:**
- `PERSISTENT_SERVER_SCRIPT` (~line 377) - HTTP server with streaming input mode
- `/ask-telegram` endpoint (~line 938) - Uses `startProcess()` + `waitForPort(8080)`
- `getSandbox(..., { sleepAfter: "1h" })` - Container lifecycle config

## Endpoints Reference

### claude-sandbox-worker

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Health check |
| `/ask` | POST | Synchronous query (waits for response) |
| `/ask-telegram` | POST | Fire-and-forget (agent sends to Telegram directly) |
| `/logs?chatId=X` | GET | Read agent logs from container |
| `/reset` | POST | Destroy sandbox + delete R2 session |
| `/session-update` | POST | Update session in R2 (called by agent) |
| `/diag` | GET | Run diagnostics on container |

### claude-telegram-bot

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Health check |
| `/` | POST | Telegram webhook (Grammy handler) |

## Performance Timing Analysis

**Persistent Server Performance:**

| Message Type | Time | Breakdown |
|--------------|------|-----------|
| First message (cold start) | ~7s | Container startup + Claude CLI + response |
| Subsequent messages (warm) | ~3.5s | Just response (server already running) |
| After 1 hour idle | ~7s | Container slept, fresh cold start |

**Log-based timing analysis:**

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

**Timing breakdown (warm message):**
- Message receive → SESSION: ~0.5s (generator wakeup)
- SESSION → COMPLETE: 2-4s (Anthropic API response)
- COMPLETE → TELEGRAM_SENT: ~0.3s (network)

**Key optimization**: Claude CLI starts ONCE per container lifecycle. The async generator keeps Claude alive between messages, eliminating ~3s startup overhead on subsequent messages.

## Adding New Skills to the Bot

Skills go in `claude-sandbox-worker/.claude/skills/`:

```bash
mkdir -p claude-sandbox-worker/.claude/skills/my-skill
```

Create `SKILL.md`:
```markdown
---
name: my-skill
description: What this skill does. When to use it.
---

# My Skill

Instructions for Claude on how to use this skill...
```

Then rebuild and deploy:
```bash
cd claude-sandbox-worker
npx wrangler deploy
```

Reset sandboxes to pick up new skills.
