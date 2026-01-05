# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start both services for local development
cd claude-sandbox-worker && npm run dev  # Terminal 1 (builds Docker on first run ~2-3 min)
cd claude-telegram-bot && npm run start  # Terminal 2

# Test worker directly (no Telegram needed)
curl http://localhost:8787/                                    # Health check
curl -X POST http://localhost:8787/ask \
  -H "Content-Type: application/json" \
  -d '{"chatId":"test","message":"Say hello","claudeSessionId":null}'

# Streaming test
curl -X POST http://localhost:8787/ask-stream \
  -H "Content-Type: application/json" \
  -d '{"chatId":"test","message":"Say hello","claudeSessionId":null}'
curl "http://localhost:8787/poll?chatId=test"

# Debug container issues
curl http://localhost:8787/diag | jq .

# Reset a chat's sandbox
curl -X POST http://localhost:8787/reset \
  -H "Content-Type: application/json" \
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
- `claude-telegram-bot/.env`: `SANDBOX_WORKER_URL=http://localhost:8787`

Both files have comments pointing to each other.

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
└── andee-dev/SKILL.md                  to build Andee on your machine

/Andee/claude-sandbox-worker/.claude/skills/  ← FOR ANDEE (the bot) when
└── weather/SKILL.md                             responding to Telegram users
```

Andee IS a Claude Code-based bot. It has its own skills that get copied into its Docker container.

**To add a new skill for Andee (the bot):**
1. Create directory: `claude-sandbox-worker/.claude/skills/{skill-name}/`
2. Create `SKILL.md` with YAML frontmatter (`name`, `description`) and instructions
3. Rebuild container: `cd claude-sandbox-worker && npm run dev`

**For developer guidance:** Use the `andee-dev` skill in `/Andee/.claude/skills/` or ask "How do I add a new skill to Andee?"

## Mini Apps (Telegram Web Apps)

Skills can provide rich UI via Telegram Mini Apps. Claude returns links in the format:
```markdown
[Button Text](webapp:https://andee-7rd.pages.dev/{app-name}/?data=...)
```

The bot parses these and creates InlineKeyboard buttons. All Mini Apps are deployed together to a single Cloudflare Pages project.

**Unified Mini Apps structure (`/Andee/apps/`):**
```
apps/
├── package.json        # Single deployment for ALL apps
└── src/
    ├── weather/        → https://andee-7rd.pages.dev/weather/
    │   └── index.html
    └── {new-app}/      → https://andee-7rd.pages.dev/{new-app}/
        └── index.html
```

**Commands:**
```bash
cd apps && npm run dev      # Local dev on port 8788 (all apps)
                            # Access: http://localhost:8788/weather/
cd apps && npm run deploy   # Deploy ALL apps to Cloudflare Pages
```

**Adding a new Mini App:**
1. Create directory: `mkdir -p apps/src/{app-name}`
2. Create `index.html` with Telegram WebApp SDK
3. Deploy: `cd apps && npm run deploy`

## Key Files

- `claude-sandbox-worker/src/index.ts` - Worker with `PERSISTENT_SERVER_SCRIPT` (streaming input mode), endpoints, Sandbox SDK orchestration
- `claude-sandbox-worker/Dockerfile` - Container image with Claude CLI, Agent SDK, port 8080 exposed
- `claude-sandbox-worker/.claude/skills/` - Andee's runtime skills (for responding to users)
- `claude-telegram-bot/src/index.ts` - Grammy bot with webhook handler and InlineKeyboard support
- `apps/src/weather/index.html` - Weather Mini App
- `apps/package.json` - Unified Mini Apps deployment config
- `.claude/skills/` - Developer skills (for you when building Andee)
- `.claude/skills/andee-ops/` - Operations guide for debugging/deploying

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
