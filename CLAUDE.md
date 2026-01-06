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

**Container lifecycle**: `sleepAfter: "1h"` - container stays alive for 1 hour of inactivity, then sleeps. Next message triggers fresh start.

## Gotchas

| Problem | Error | Solution |
|---------|-------|----------|
| Claude refuses root | `--dangerously-skip-permissions cannot be used with root/sudo` | Create non-root user in Dockerfile: `RUN useradd -m -s /bin/bash claude` then `USER claude` |
| ESM can't find global npm packages | `Cannot find package '@anthropic-ai/claude-agent-sdk'` | Symlink in Dockerfile: `RUN ln -s /usr/local/lib/node_modules /workspace/node_modules` |
| Sandbox SQL not enabled | `SQL is not enabled for this Durable Object class` | Use `new_sqlite_classes` in wrangler.toml migrations |
| Port 3000 already in use | `EADDRINUSE: address already in use :::3000` | Port 3000 is used by Cloudflare Sandbox infrastructure. Use port 8080 instead. |
| Claude can't find config | Process fails silently | Set `HOME=/home/claude` via `env` option in `startProcess()` |
| Container killed on deploy | `Runtime signalled the container to exit due to a new version rollout` | Transient - next message will spin up fresh container |

## Skills System

**Important distinction - two different `.claude` directories:**

```
/Andee/.claude/skills/               ← FOR YOU (developer) using Claude Code
├── deploying-andee/                    to build Andee on your machine
└── developing-andee/

/Andee/claude-sandbox-worker/.claude/skills/  ← FOR ANDEE (the bot) when
└── weather/SKILL.md                             responding to Telegram users
```

Andee IS a Claude Code-based bot. It has its own skills that get copied into its Docker container.

**Developer Skills:**
- **deploying-andee** - Deployment guide. Use for: deploying to Cloudflare, setting secrets, configuring webhooks, container instance types
- **developing-andee** - Development + debugging guide. Use for: creating skills, building Mini Apps, debugging issues, analyzing logs

**To add a new skill for Andee (the bot):**
1. Create directory: `claude-sandbox-worker/.claude/skills/{skill-name}/`
2. Create `SKILL.md` with YAML frontmatter (`name`, `description`) and instructions
3. Rebuild container: `cd claude-sandbox-worker && npm run dev`

## Mini Apps (Telegram Web Apps)

Skills provide rich UI via Telegram Mini Apps using Direct Link Mini Apps. See [.claude/skills/developing-andee/guides/mini-apps.md](.claude/skills/developing-andee/guides/mini-apps.md) for the complete development guide.

**Quick reference:**
```bash
cd apps && npm run dev        # Vite dev server on port 8788
cd apps && npm run build      # Build to dist/
cd apps && npm run typecheck  # TypeScript validation
cd apps && npm run deploy     # Build + deploy to Cloudflare Pages
```

## Key Files

- `claude-sandbox-worker/src/index.ts` - Worker endpoints, Sandbox SDK orchestration
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

## Endpoints Reference

### claude-sandbox-worker

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Health check |
| `/ask` | POST | Fire-and-forget (persistent server, responds to Telegram) |
| `/logs?chatId=X` | GET | Read agent logs from container |
| `/reset` | POST | Snapshot + destroy sandbox + delete R2 session |
| `/session-update` | POST | Update session in R2 (called by agent) |
| `/diag` | GET | Run diagnostics on container |
| `/snapshot` | POST | Create filesystem snapshot (backup /workspace + /home/claude) |
| `/snapshot?chatId=X` | GET | Get latest snapshot (returns tar.gz) |
| `/snapshots?chatId=X` | GET | List all snapshots for a chat |
| `/snapshot?chatId=X&key=Y` | DELETE | Delete specific snapshot (key=all to delete all) |

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
