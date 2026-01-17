# CLAUDE.md

Telegram bot powered by Claude Code Agent SDK with persistent server in Cloudflare Sandbox containers.

## Quick Start

```bash
cd claude-sandbox-worker && npm run dev  # Terminal 1 (builds Docker ~2-3 min first time)
cd claude-telegram-bot && npm run start  # Terminal 2
```

## Local Development Prerequisites (Apple Silicon)

**Docker Desktop Rosetta Setting:** The container uses x86_64 binaries. Rosetta emulation has issues with AVX instructions that cause Bun to crash.

**Required setting:**
- Docker Desktop → Settings → General
- **Uncheck** "Use Rosetta for x86_64/amd64 emulation on Apple Silicon"
- Apply & Restart

If you see `CPU lacks AVX support` or `Illegal instruction` errors, this setting is the cause.

See `/developing-andee` → DEBUGGING.md for full troubleshooting details.

## Architecture

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
│  │  Message Queue ──► while(true) loop ──► query() per message     │   │
│  │       │                    │                                    │   │
│  │       │                    ▼                                    │   │
│  │       │           Claude Agent SDK (session resumption)         │   │
│  │       │                    │                                    │   │
│  │       ▼                    ▼                                    │   │
│  │  Response ──► Telegram API (direct from container)              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Key: One query() call per message with session resumption.             │
│       Messages queued while busy are processed after current completes. │
└─────────────────────────────────────────────────────────────────────────┘
```

## Critical Configuration

**Port must match between services** (frequent source of `ECONNREFUSED` errors):
- `claude-sandbox-worker/wrangler.toml`: `[dev] port = 8787`
- `claude-telegram-bot/.dev.vars`: Local development secrets

Both services use port 8787 for local development.

## Developer Skills

Use these skills for detailed guidance:

| Task | Skill | What it covers |
|------|-------|----------------|
| Building features | `/developing-andee` | Creating skills, Mini Apps, personality, container tools, file locations |
| Debugging issues | `/developing-andee` | Log tailing, agent logs, common issues, snapshot management, testing |
| Deploying to prod | `/deploying-andee` | Worker deploy, secrets, webhooks, instance types, R2 setup |
| Sandbox SDK APIs | `/cloudflare-sandbox-sdk` | startProcess, exec, writeFile, exposePort, etc. |

## Test Users

| Constant | ID | Purpose |
|----------|-----|---------|
| TEST_USER_1 | 999999999 | Primary testing (nine 9s) |
| TEST_USER_2 | 888888888 | Multi-user isolation (nine 8s) |

Import: `import { TEST_USER_1, TEST_USER_2 } from '@andee/shared/constants';`

See `/developing-andee` for curl examples and test patterns.

## R2 Storage Structure

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
│  RECURRING SCHEDULES (per-chat):                                        │
│  └── schedules/{chatId}/recurring.yaml                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

Key generation: `shared/types/session.ts` has `getSessionKey()`, `getSnapshotKey()`, `getSnapshotPrefix()`.

## Skills System

**Two different `.claude` directories:**

```
/Andee/.claude/skills/               ← FOR YOU (developer) using Claude Code
├── deploying-andee/                    to build Andee on your machine
└── developing-andee/

/Andee/claude-sandbox-worker/.claude/skills/  ← FOR ANDEE (the bot) when
├── weather/SKILL.md                             responding to Telegram users
├── searching-memories/SKILL.md
├── managing-artifacts/SKILL.md
└── telegram-response/SKILL.md
```

To add a new skill for Andee: create `claude-sandbox-worker/.claude/skills/{name}/SKILL.md` with YAML frontmatter, then rebuild container.

## Memory System

```
┌─────────────────────────────────────────────────────────────────────────┐
│  MEMORY ARCHITECTURE                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  /media/ (R2-mounted, auto-persists)                                    │
│  ├── conversation-history/{chatId}/memory.mv2   # Memvid search         │
│  └── .memvid/models/                            # Embeddings (~133MB)   │
│                                                                         │
│  /home/claude/ (backed up in snapshots)                                 │
│  ├── shared/lists/                              # Shared artifacts      │
│  └── private/{senderId}/                        # Per-user storage      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

See `ANDEE_MEMORY_TAD.md` for full architecture details.

## Key Files

**Worker + Container:**
- `claude-sandbox-worker/src/index.ts` - Worker endpoints, Sandbox SDK
- `claude-sandbox-worker/src/handlers/ask.ts` - handleAsk() + voice transcription
- `claude-sandbox-worker/src/scripts/persistent-server.script.js` - Main execution path
- `claude-sandbox-worker/Dockerfile` - Container image

**Telegram Bot:**
- `claude-telegram-bot/src/index.ts` - Grammy bot with webhook handler

**Mini Apps:**
- `apps/src/lib/` - Shared library
- `apps/vite.config.ts` - Multi-page app config

**IDE:**
- `sandbox-ide/` - Browser IDE (https://andee-ide.pages.dev/)

## Endpoints Reference

### claude-sandbox-worker

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Health check |
| `/ask` | POST | Process message or voice |
| `/logs?chatId=X` | GET | Read agent logs |
| `/restart` | POST | Snapshot + restart container |
| `/factory-reset` | POST | Snapshot + destroy + wipe session |
| `/diag` | GET | Run diagnostics |
| `/snapshot` | POST | Create filesystem snapshot |
| `/snapshots?chatId=X` | GET | List snapshots |
| `/restore` | POST | Restore snapshot |
| `/schedule-reminder` | POST | Schedule reminder |
| `/reminders?senderId=X` | GET | List reminders |
| `/schedule-config?chatId=X` | GET | Get schedule config |
| `/schedule-config-yaml` | PUT | Save schedule config |
| `/run-schedule-now` | POST | Execute schedule immediately |

### IDE Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sandboxes` | GET | List R2 sessions |
| `/ws` | WS | WebSocket terminal |
| `/files` | GET | List directory |
| `/file` | GET/PUT | Read/write file |

## LLM Context

`llm_context/Cloudflare-developer-platform-guide-full.md` is **12MB** - never read the entire file. Use Grep with context flags to search within it, or use the `cloudflare-sandbox-sdk` skill.
