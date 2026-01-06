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
  -d '{"chatId":"test","message":"Say hello","claudeSessionId":null}'

# Streaming test
curl -X POST http://localhost:8787/ask-stream \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"test","message":"Say hello","claudeSessionId":null}'
curl -H "X-API-Key: $ANDEE_API_KEY" "http://localhost:8787/poll?chatId=test"

# Debug container issues
curl -H "X-API-Key: $ANDEE_API_KEY" http://localhost:8787/diag | jq .

# Reset a chat's sandbox
curl -X POST http://localhost:8787/reset \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"test"}'
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

**Message flow**: Bot sends `POST /ask-telegram` → Worker checks if persistent server running → If not, starts via `startProcess()` → POST message to internal HTTP server → Claude processes via streaming input → Responds directly to Telegram.

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
├── andee-ops/                          to build Andee on your machine
└── andee-dev/

/Andee/claude-sandbox-worker/.claude/skills/  ← FOR ANDEE (the bot) when
└── weather/SKILL.md                             responding to Telegram users
```

Andee IS a Claude Code-based bot. It has its own skills that get copied into its Docker container.

**Developer Skills:**
- **andee-ops** - Deployment guide. Use for: deploying to Cloudflare, setting secrets, configuring webhooks, container instance types
- **andee-dev** - Development + debugging guide. Use for: creating skills, building Mini Apps, debugging issues, analyzing logs

**To add a new skill for Andee (the bot):**
1. Create directory: `claude-sandbox-worker/.claude/skills/{skill-name}/`
2. Create `SKILL.md` with YAML frontmatter (`name`, `description`) and instructions
3. Rebuild container: `cd claude-sandbox-worker && npm run dev`

## Mini Apps (Telegram Web Apps)

Skills provide rich UI via Telegram Mini Apps using **Direct Link Mini Apps**. Claude returns links in this format:
```markdown
[Button Text](https://t.me/HeyAndee_bot/app?startapp={component}_{base64url_data})
```

The link opens a **shell Mini App** that dynamically loads the requested component. This works in both private and group chats.

**startapp format:** `{component}_{base64url_data}`
- `component`: Folder name in `apps/src/` (e.g., `weather`)
- `base64url_data`: Base64url-encoded JSON (no `+`, `/`, or `=`)

**Architecture:**
```
┌──────────────────────────────────────────────────────────────────────────┐
│  User taps: https://t.me/HeyAndee_bot/app?startapp=weather_eyJsb2Mi...   │
│        ↓                                                                 │
│  Shell (apps/src/app/) parses startapp, loads component in iframe       │
│        ↓                                                                 │
│  Component (apps/src/weather/) reads data from URL hash (#data=...)     │
└──────────────────────────────────────────────────────────────────────────┘
```

**Directory structure:**
```
apps/
├── package.json              # Vite + TypeScript
├── vite.config.ts            # Multi-page app config
├── tsconfig.json
└── src/
    ├── lib/                  # SHARED LIBRARY
    │   ├── telegram.ts       # initTelegram(), applyTheme(), getStartParam()
    │   ├── base64url.ts      # encode(), decode()
    │   ├── data.ts           # getData<T>() from URL hash
    │   ├── base.css          # Shared styles, CSS variables
    │   └── types/            # TypeScript interfaces (WeatherData, etc.)
    ├── app/                  # Shell router
    │   ├── index.html
    │   └── main.ts
    ├── weather/              # Weather component
    │   ├── index.html
    │   ├── main.ts
    │   └── weather.css
    └── {component}/          # Add new components here
```

**Commands:**
```bash
cd apps && npm run dev        # Vite dev server on port 8788
cd apps && npm run build      # Build to dist/
cd apps && npm run preview    # Preview built files locally
cd apps && npm run typecheck  # TypeScript validation
cd apps && npm run deploy     # Build + deploy to Cloudflare Pages
```

**Adding a new component:**
1. Create directory: `mkdir -p apps/src/{component-name}`
2. Create `index.html` (minimal HTML entry)
3. Create `main.ts` importing shared utilities:
   ```typescript
   import { initTelegram, getData } from '../lib';
   import type { MyData } from '../lib/types/mydata';

   initTelegram();
   const { data, error } = getData<MyData>();
   // ... render component
   ```
4. Add entry to `vite.config.ts` rollupOptions.input
5. Add TypeScript interface in `apps/src/lib/types/`
6. Deploy: `cd apps && npm run deploy`
7. Update skill to generate links with new component name

## Key Files

- `claude-sandbox-worker/src/index.ts` - Worker with `PERSISTENT_SERVER_SCRIPT` (streaming input mode), endpoints, Sandbox SDK orchestration
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
