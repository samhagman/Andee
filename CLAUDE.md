# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start both services for local development
cd claude-sandbox-worker && npm run dev  # Terminal 1 (builds Docker on first run ~2-3 min)
cd claude-telegram-bot && npm run start  # Terminal 2

# Test worker directly (no Telegram needed)
# Note: All endpoints except health check require X-API-Key header
curl http://localhost:8787/                                    # Health check (no auth)
curl -X POST http://localhost:8787/ask \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"test","message":"Say hello","claudeSessionId":null,"botToken":"YOUR_BOT_TOKEN","userMessageId":1}'

# Debug container issues
curl -H "X-API-Key: $ANDEE_API_KEY" http://localhost:8787/diag | jq .

# Reset a chat's sandbox (creates snapshot first)
curl -X POST http://localhost:8787/reset \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"test","senderId":"123","isGroup":false}'

# Snapshot operations
curl -X POST http://localhost:8787/snapshot \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"test","senderId":"123","isGroup":false}'     # Create snapshot
curl -H "X-API-Key: $ANDEE_API_KEY" \
  "http://localhost:8787/snapshots?chatId=test&senderId=123&isGroup=false"  # List

# Test voice message (requires base64-encoded OGG/OPUS audio)
base64 -i test.ogg > /tmp/audio.b64
cat > /tmp/voice_request.json << EOF
{"chatId":"999999999","senderId":"999999999","isGroup":false,
 "audioBase64":"$(cat /tmp/audio.b64)","audioDurationSeconds":5,
 "claudeSessionId":null,"botToken":"$BOT_TOKEN","userMessageId":1}
EOF
curl -X POST http://localhost:8787/ask \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d @/tmp/voice_request.json
```

## Architecture

Telegram bot powered by Claude Code Agent SDK with persistent server in Cloudflare Sandbox containers.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PRODUCTION ARCHITECTURE (Persistent Server)                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Phone ──► Telegram ──► Grammy Bot ──► Sandbox Worker ──► Container     │
│                         (Worker)       (Worker+DO)        (Firecracker) │
│                              │                               │          │
│                              │    Service Binding            │          │
│                              └───────────────────────────────┘          │
│                                                                         │
│  Inside Container (per user, stays alive 1 hour):                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  HTTP Server (port 8080)  ◄──────  Worker POST /message         │   │
│  │       │                                                         │   │
│  │       ▼                                                         │   │
│  │  Async Generator ──► Claude Agent SDK ──► Claude (stays alive)  │   │
│  │       │                                                         │   │
│  │       ▼                                                         │   │
│  │  Response ──► Telegram API (direct from container)              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Key: Claude CLI starts ONCE, handles multiple messages via generator   │
│       Subsequent messages skip ~3.5s CLI startup overhead               │
└─────────────────────────────────────────────────────────────────────────┘
```

**Message flow**: Bot sends `POST /ask` → Worker checks if persistent server running → If not, starts via `startProcess()` → POST message to internal HTTP server → Claude processes via streaming input → Responds directly to Telegram.

**Voice message flow**:
```
┌─────────────────────────────────────────────────────────────────────────┐
│  VOICE MESSAGE FLOW                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Voice Note ──► Telegram ──► Grammy Bot ──► Download OGG ──► Base64    │
│                                                  │                      │
│                                                  ▼                      │
│                               POST /ask { audioBase64: "..." }          │
│                                                  │                      │
│                                                  ▼                      │
│                         Workers AI (whisper-large-v3-turbo)             │
│                              ~900ms, $0.0005/min                        │
│                                                  │                      │
│                                                  ▼                      │
│                            Transcribed text ──► Claude                  │
│                                                  │                      │
│                                                  ▼                      │
│                            Response ──► Telegram                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Sandbox IDE

Browser-based IDE for direct container access at https://andee-ide.pages.dev/

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SANDBOX IDE ARCHITECTURE                                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Browser (andee-ide.pages.dev)                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Sandbox Selector → File Tree → Monaco Editor → xterm.js Terminal│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       │ WebSocket (port 8081)                                           │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Container: ws-terminal.js (node-pty) → PTY → bash               │   │
│  │  Enables: Claude Code TUI, vim, htop, full terminal emulation    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Commands:**
```bash
cd sandbox-ide && npm run dev      # Local dev (Vite on 5173)
cd sandbox-ide && npm run deploy   # Deploy to Cloudflare Pages
```

**Key features:**
- Full PTY support via node-pty (resize, isatty, job control)
- Claude Code TUI works correctly
- Browse any path (/workspace, /home/claude, etc.)
- Monaco editor with syntax highlighting

## Critical Configuration

**Port must match between services** (frequent source of `ECONNREFUSED` errors):
- `claude-sandbox-worker/wrangler.toml`: `[dev] port = 8787`
- `claude-telegram-bot/.dev.vars`: Local development secrets (wrangler dev reads this)

Both services use port 8787 for local development.

## Authentication

Two-layer auth for MVP testing (prevents random users from using the bot):

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: Telegram Allowlist (Bot)     LAYER 2: API Key (Worker)        │
├─────────────────────────────────────────────────────────────────────────┤
│  ALLOWED_USER_IDS=123,456              ANDEE_API_KEY=adk_xxx            │
│  ↓                                     ↓                                │
│  Checks botCtx.from.id                 Checks X-API-Key header          │
│  Works for private + group chats       All endpoints except /           │
└─────────────────────────────────────────────────────────────────────────┘
```

**Find your Telegram user ID:**
- Message `@userinfobot` on Telegram, OR
- Check bot logs when messaging (prints `[AUTH] User xxx (ID: yyy)`)

**Configuration (telegram-bot):**

Two environment files with different purposes:

```bash
# LOCAL DEVELOPMENT: .dev.vars (wrangler dev reads this)
BOT_TOKEN=xxx
ANDEE_API_KEY=adk_xxx
ALLOWED_USER_IDS=              # Empty = allow all users locally

# PRODUCTION: .prod.env (deployed via npm run deploy-secrets)
BOT_TOKEN=xxx
ANDEE_API_KEY=adk_xxx
ALLOWED_USER_IDS=123,456       # Comma-separated user IDs
```

**Configuration (sandbox-worker):**
```bash
# claude-sandbox-worker/.dev.vars
ANDEE_API_KEY=adk_xxx          # Must match telegram-bot's key
```

**Deploy secrets:**
```bash
cd claude-telegram-bot
npm run deploy           # Deploys secrets + code
npm run deploy-secrets   # Secrets only
npm run deploy-code      # Code only (no secrets)
```

**Generate a new API key:**
```bash
openssl rand -hex 16 | sed 's/^/adk_/'
```

## Test Users (Production Testing)

Two dedicated test user IDs for testing without affecting real user data. These are treated **exactly like real users** - same code paths, same storage patterns. The only difference is recognizable IDs.

| Constant | ID | Purpose |
|----------|-----|---------|
| TEST_USER_1 | 999999999 | Primary testing (nine 9s) |
| TEST_USER_2 | 888888888 | Multi-user isolation testing (nine 8s) |
| TEST_GROUP_CHAT | -100999999999 | Group chat testing |

**Local testing (curl to sandbox-worker):**
```bash
# Send message as TEST_USER_1
curl -X POST http://localhost:8787/ask \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"999999999","senderId":"999999999","isGroup":false,"message":"Hello!","botToken":"$BOT_TOKEN","userMessageId":1}'

# Reset TEST_USER_1's sandbox
curl -X POST http://localhost:8787/reset \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"999999999","senderId":"999999999","isGroup":false}'
```

**Production testing:**
```bash
# Sandbox worker (direct API access - requires API key)
curl -X POST https://claude-sandbox-worker.samuel-hagman.workers.dev/ask \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"999999999","senderId":"999999999","isGroup":false,"message":"Hello!","botToken":"'$BOT_TOKEN'","userMessageId":1}'

# Telegram bot (webhook endpoint - simulates Telegram webhook)
# Note: Telegram API calls are skipped for test users (see Transformer Behavior below)
curl -X POST https://claude-telegram-bot.samuel-hagman.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{"update_id":1,"message":{"message_id":1,"from":{"id":999999999,"first_name":"TestUser1","is_bot":false},"chat":{"id":999999999,"type":"private"},"date":1704650400,"text":"Hello!"}}'
```

**TypeScript import:**
```typescript
import { TEST_USER_1, TEST_USER_2, TEST_CHAT_1 } from '@andee/shared/constants';
```

### Transformer Behavior

The telegram-bot includes a Grammy API transformer that **skips Telegram API calls** for test users. This means:

- `setMessageReaction`, `sendMessage`, and other Telegram calls return mock success
- No actual HTTP requests to Telegram API for test users
- Clean logs without GrammyError noise

**Expected logs for test user requests:**
```
[AUTH] User unknown (ID: 999999999) in chat 999999999 (type: private, isGroup: false)
[999999999] Received: Hello from test!...
[TEST] Skipping setMessageReaction for test chat 999999999
```

**Note:** The sandbox-worker still processes messages and attempts to send to Telegram (which fails silently). The transformer only affects the telegram-bot's Grammy API calls.

## R2 Storage Structure

Sessions and snapshots are organized by Telegram user ID for data isolation:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  R2 KEY STRUCTURE (per-user isolation)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PRIVATE CHATS (senderId = user's Telegram ID):                         │
│  ├── sessions/{senderId}/{chatId}.json                                  │
│  └── snapshots/{senderId}/{chatId}/{timestamp}.tar.gz                   │
│                                                                         │
│  GROUP CHATS (shared per chat, not per user):                           │
│  ├── sessions/groups/{chatId}.json                                      │
│  └── snapshots/groups/{chatId}/{timestamp}.tar.gz                       │
│                                                                         │
│  Example paths:                                                         │
│  ├── sessions/123456789/123456789.json     (private: user=chat)         │
│  ├── sessions/123456789/-100987654321.json (private bot to user)        │
│  ├── sessions/groups/-100555666777.json    (supergroup)                 │
│  └── snapshots/123456789/-100987654321/2025-01-06T12-00-00-000Z.tar.gz  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key generation** (`shared/types/session.ts`):
- `getSessionKey(chatId, senderId, isGroup)` → R2 session path
- `getSnapshotKey(chatId, senderId, isGroup, timestamp?)` → R2 snapshot path
- `getSnapshotPrefix(chatId, senderId, isGroup)` → For listing snapshots

**Why this structure:**
- Per-user data isolation for future quotas/billing
- Group chats shared because participants change dynamically
- Legacy fallback for keys without senderId/isGroup (orphaned data)

## Performance

| Message Type | Time | Notes |
|--------------|------|-------|
| First message (cold start) | ~7s | Container + Claude CLI startup |
| Subsequent messages (warm) | ~3.5s | Reuses persistent server, skips CLI startup |
| After 1 hour idle | ~7s | Container slept, fresh start |
| Voice transcription | ~900ms | Cloudflare Workers AI Whisper (adds to total) |

**Container lifecycle**: `sleepAfter: "1h"` - container stays alive for 1 hour of inactivity, then sleeps. Next message triggers fresh start.

On cold start:
1. Restore from R2 snapshot (if exists)
2. Read user timezone from `/home/claude/private/{senderId}/preferences.yaml`
3. Start persistent server with `TZ={timezone}` env var (defaults to UTC)

## Gotchas

| Problem | Error | Solution |
|---------|-------|----------|
| Claude refuses root | `--dangerously-skip-permissions cannot be used with root/sudo` | Create non-root user in Dockerfile: `RUN useradd -m -s /bin/bash claude` then `USER claude` |
| ESM can't find global npm packages | `Cannot find package '@anthropic-ai/claude-agent-sdk'` | Symlink in Dockerfile: `RUN ln -s /usr/local/lib/node_modules /workspace/node_modules` |
| Sandbox SQL not enabled | `SQL is not enabled for this Durable Object class` | Use `new_sqlite_classes` in wrangler.toml migrations |
| Port 3000 already in use | `EADDRINUSE: address already in use :::3000` | Port 3000 is used by Cloudflare Sandbox infrastructure. Use port 8080 instead. |
| Claude can't find config | Process fails silently | Set `HOME=/home/claude` via `env` option in `startProcess()` |
| Container killed on deploy | `Runtime signalled the container to exit due to a new version rollout` | Transient - next message will spin up fresh container |
| Memvid file not found | `memvid find` returns empty | File is created on first `memvid put`. Check if `.mv2` file exists first. |
| Timezone not set | Reminders fire at wrong time | User must set timezone via "My timezone is X" or /timezone command |
| node-pty build fails | `gyp ERR! build error` | Add build-essential + python3 to Dockerfile before `npm install -g node-pty` |
| Terminal lines wrong position | Text at random positions | Ensure ws-terminal.js uses `pty.spawn()`, not `child_process.spawn()` |

## Skills System

**Important distinction - two different `.claude` directories:**

```
/Andee/.claude/skills/               ← FOR YOU (developer) using Claude Code
├── deploying-andee/                    to build Andee on your machine
└── developing-andee/

/Andee/claude-sandbox-worker/.claude/skills/  ← FOR ANDEE (the bot) when
├── weather/SKILL.md                             responding to Telegram users
├── searching-memories/SKILL.md                  (memvid conversation search)
├── managing-artifacts/                          (artifact CRUD with yq)
│   ├── SKILL.md
│   ├── MENU_SCHEMA.md
│   ├── scripts/*.sh
│   └── templates/
└── telegram-response/SKILL.md
```

Andee IS a Claude Code-based bot. It has its own skills that get copied into its Docker container.

**Developer Skills:**
- **deploying-andee** - Deployment guide. Use for: deploying to Cloudflare, setting secrets, configuring webhooks, container instance types
- **developing-andee** - Development + debugging guide. Use for: creating skills, building Mini Apps, debugging issues, analyzing logs

**To add a new skill for Andee (the bot):**
1. Create directory: `claude-sandbox-worker/.claude/skills/{skill-name}/`
2. Create `SKILL.md` with YAML frontmatter (`name`, `description`) and instructions
3. Rebuild container: `cd claude-sandbox-worker && npm run dev`

## Personality System

Andee's personality and communication style are configured via `PERSONALITY.md`, which is appended to Claude's system prompt at runtime.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SYSTEM PROMPT COMPOSITION                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Claude Code Base Preset (tools, safety guidelines)                  │
│                                                                         │
│  2. settingSources: ["user"]                                            │
│     └── Loads: /workspace/CLAUDE.md (Telegram formatting reference)    │
│                                                                         │
│  3. systemPrompt.append                                                 │
│     └── Loads: /home/claude/.claude/PERSONALITY.md                      │
│         └── Identity, voice, formatting, capabilities                   │
│                                                                         │
│  Order: Base → CLAUDE.md → PERSONALITY.md (last = highest weight)       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key files:**
- `claude-sandbox-worker/.claude/PERSONALITY.md` - Source file (edit here to customize)
- `claude-sandbox-worker/Dockerfile` - Copies to `/home/claude/.claude/` in container
- `claude-sandbox-worker/src/scripts/persistent-server.script.js` - Loads at startup, appends to system prompt

**What PERSONALITY.md contains:**
- Identity & pronouns ("she/they", household assistant)
- Voice & personality traits (warm, grounded, late millennial vibes)
- Telegram formatting rules (what works, what doesn't)
- Capabilities awareness (memory, artifacts, reminders, weather)
- Proactive helpfulness guidelines

**To customize personality:**
1. Edit `claude-sandbox-worker/.claude/PERSONALITY.md`
2. Rebuild: `cd claude-sandbox-worker && npm run dev` (local) or `npx wrangler deploy` (production)

**Relationship to telegram-response skill:**
Both PERSONALITY.md and the `telegram-response` skill contain Telegram formatting rules. This overlap is intentional—PERSONALITY.md provides formatting context in the system prompt, while `telegram-response` is a detailed reference Claude can consult. Repetition reinforces the behavior.

## Mini Apps (Telegram Web Apps)

Skills provide rich UI via Telegram Mini Apps using Direct Link Mini Apps. See [.claude/skills/developing-andee/guides/mini-apps.md](.claude/skills/developing-andee/guides/mini-apps.md) for the complete development guide.

**Quick reference:**
```bash
cd apps && npm run dev        # Vite dev server on port 8788
cd apps && npm run build      # Build to dist/
cd apps && npm run typecheck  # TypeScript validation
cd apps && npm run deploy     # Build + deploy to Cloudflare Pages
```

## Memory System

Andee has persistent memory using Memvid for conversation history and flat markdown files for artifacts.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  MEMORY ARCHITECTURE                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  /home/claude/                                                          │
│  ├── shared/                      # Default for all users              │
│  │   ├── shared.mv2               # Shared conversation memory (group)  │
│  │   └── lists/                                                         │
│  │       ├── MENU.JSON            # Schema + vocabulary registry        │
│  │       ├── recipes/             # {name}-{uuid}.md files              │
│  │       ├── movies/                                                    │
│  │       └── grocery/                                                   │
│  │                                                                      │
│  └── private/{senderId}/          # Per-user private storage            │
│      ├── memory.mv2               # Private conversation memory         │
│      ├── preferences.yaml         # User preferences (timezone, etc.)   │
│      └── lists/                                                         │
│          ├── MENU.JSON                                                  │
│          └── recipes/                                                   │
│                                                                         │
│  Memory Type:                                                           │
│  • Group chat (isGroup=true) → /home/claude/shared/shared.mv2           │
│  • Private chat → /home/claude/private/{senderId}/memory.mv2            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key components**:
- **Memvid** (.mv2 files) - Hybrid search over conversation history
- **Artifacts** - Markdown files with YAML frontmatter (recipes, lists, notes)
- **MENU.JSON** - Schema and vocabulary registry for consistent tagging
- **yq** - YAML processor for frontmatter queries

See `ANDEE_MEMORY_TAD.md` for full architecture details.

## Reminder & Proactive System

Andee can set and deliver scheduled reminders via the SchedulerDO Durable Object.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  REMINDER SYSTEM                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User: "Remind me at 3pm to call mom"                                   │
│         │                                                               │
│         ▼                                                               │
│  Container (Claude):                                                    │
│  1. Get current time: date -u +%s                                       │
│  2. Parse "at 3pm" → calculate Unix timestamp                           │
│  3. Create reminder artifact in /home/claude/shared/lists/reminders/    │
│  4. Call POST /schedule-reminder to worker                              │
│         │                                                               │
│         ▼                                                               │
│  SchedulerDO (per user):                                                │
│  • Stores reminder in SQLite                                            │
│  • Sets DO alarm for trigger time                                       │
│  • When alarm fires → sends to Telegram + auto-pins the message         │
│  • If pin fails (bot not admin) → notifies user once per chat           │
│                                                                         │
│  Hourly Cron:                                                           │
│  • Placeholder for future proactive messaging                           │
│  • Could wake containers for context-aware check-ins                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key files**:
- `claude-sandbox-worker/src/scheduler/SchedulerDO.ts` - DO with SQLite + alarms
- `claude-sandbox-worker/.claude/skills/reminders/SKILL.md` - Andee's reminder skill
- `shared/types/reminder.ts` - Shared type definitions

**Testing reminders**:
```bash
# Schedule a test reminder
curl -X POST http://localhost:8787/schedule-reminder \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{
    "senderId": "123456789",
    "chatId": "123456789",
    "isGroup": false,
    "reminderId": "test-uuid-123",
    "triggerAt": '"$(($(date +%s) * 1000 + 60000))"',
    "message": "Test reminder",
    "botToken": "'$BOT_TOKEN'"
  }'

# List reminders
curl "http://localhost:8787/reminders?senderId=123456789" \
  -H "X-API-Key: $ANDEE_API_KEY"
```

## Key Files

- `claude-sandbox-worker/src/index.ts` - Worker endpoints, Sandbox SDK orchestration
- `claude-sandbox-worker/src/handlers/ask.ts` - handleAsk() + transcribeAudio() for voice messages
- `claude-sandbox-worker/src/scripts/` - Container scripts (imported as text via Wrangler `[[rules]]`)
  - `persistent-server.script.js` - HTTP server with streaming Claude input (main execution path)
  - `agent-telegram.script.js` - Fallback one-shot agent
  - `scripts.d.ts` - TypeScript declarations for `.script.js` imports
- `claude-sandbox-worker/Dockerfile` - Container image with Claude CLI, Agent SDK, port 8080 exposed
- `claude-sandbox-worker/.claude/skills/` - Andee's runtime skills (for responding to users)
- `claude-telegram-bot/src/index.ts` - Grammy bot with webhook handler
- `apps/src/lib/` - Shared Mini App library (Telegram utils, base64url, types)
- `apps/src/app/main.ts` - Shell router (parses startapp, loads components)
- `apps/src/weather/main.ts` - Weather component
- `apps/vite.config.ts` - Vite multi-page app build configuration
- `.claude/skills/` - Developer skills (for you when building Andee)
- `sandbox-ide/` - Browser IDE for container access
  - `src/components/Terminal.ts` - xterm.js WebSocket terminal
  - `src/components/FileTree.ts` - File browser with navigation
  - `src/components/Editor.ts` - Monaco editor wrapper
- `claude-sandbox-worker/.claude/scripts/ws-terminal.js` - PTY terminal server (node-pty)
- `claude-sandbox-worker/src/handlers/ide.ts` - IDE endpoint handlers

## Endpoints Reference

### claude-sandbox-worker

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Health check |
| `/ask` | POST | Process message or voice (text via `message`, voice via `audioBase64`) |
| `/logs?chatId=X` | GET | Read agent logs from container |
| `/reset` | POST | Snapshot + destroy sandbox + delete R2 session |
| `/session-update` | POST | Update session in R2 (called by agent) |
| `/diag` | GET | Run diagnostics on container |
| `/snapshot` | POST | Create filesystem snapshot (backup /workspace + /home/claude) |
| `/snapshot?chatId=X` | GET | Get latest snapshot (returns tar.gz) |
| `/snapshots?chatId=X` | GET | List all snapshots for a chat |
| `/snapshot?chatId=X&key=Y` | DELETE | Delete specific snapshot (key=all to delete all) |
| `/schedule-reminder` | POST | Schedule a reminder via SchedulerDO |
| `/cancel-reminder` | POST | Cancel a pending reminder |
| `/complete-reminder` | POST | Mark reminder as completed |
| `/reminders?senderId=X` | GET | List reminders for a user |

### Sandbox IDE Endpoints (claude-sandbox-worker)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sandboxes` | GET | List all R2 sessions with friendly names |
| `/ws` | WS | WebSocket terminal (proxies to ws-terminal.js on port 8081) |
| `/files` | GET | List directory contents |
| `/file` | GET/PUT | Read/write file contents |

### claude-telegram-bot

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Health check |
| `/` | POST | Telegram webhook (Grammy handler) |

## LLM Context

```
llm_context/
└── Cloudflare-developer-platform-guide-full.md   (12 MB - EXTREMELY LARGE)
```

**WARNING: `Cloudflare-developer-platform-guide-full.md` is a 12MB file** containing comprehensive documentation for ALL Cloudflare developer services (Workers, Pages, R2, D1, Durable Objects, Queues, KV, AI, etc.).

**NEVER read this entire file** - it will consume all available context. Instead:

1. **Search within it** using Grep with context flags:
   ```bash
   # Example: Find info about Durable Objects alarms
   Grep pattern="alarm" path="llm_context/Cloudflare-developer-platform-guide-full.md" -C=10
   ```
   This returns only matching lines + surrounding context, not the whole file.

2. **Use the `cloudflare-sandbox-sdk` skill** for Sandbox SDK specifics (already extracted)

3. **Use web search** for general Cloudflare questions
