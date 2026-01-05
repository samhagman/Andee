---
name: andee-dev
description: Development guide for adding new capabilities to Andee bot. Use when asked about how to add features, create new skills, modify the bot architecture, extend functionality, or implement new Mini Apps.
---

# Andee Development Guide

This skill provides guidance for extending Andee's capabilities.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ANDEE ARCHITECTURE (Persistent Server)               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Phone ──► Telegram ──► Grammy Bot (Worker) ──► Sandbox Worker ──►      │
│                              │                      │                   │
│                              │   Service Binding    │                   │
│                              └──────────────────────┘                   │
│                                                                         │
│  Sandbox Container (per-user, stays alive 1 hour):                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  HTTP Server (port 8080)  ◄─── Worker POSTs messages via curl   │   │
│  │       │                                                         │   │
│  │       ▼                                                         │   │
│  │  Async Generator (streaming input mode)                         │   │
│  │       │                                                         │   │
│  │       ▼                                                         │   │
│  │  Claude Agent SDK ──► query() ──► Claude CLI (starts ONCE)      │   │
│  │       │                                                         │   │
│  │       ▼                                                         │   │
│  │  Response ──► Telegram API (directly from container)            │   │
│  │                                                                 │   │
│  │  /workspace/files/    (working directory)                       │   │
│  │  ~/.claude/skills/    (skill definitions)                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Performance: First message ~7s, subsequent ~3.5s (50% faster!)         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key insight:** Claude CLI starts once and stays alive via async generator. Subsequent messages are 50% faster because they skip CLI startup overhead.

## Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Grammy Bot | `claude-telegram-bot/src/index.ts` | Telegram webhook, InlineKeyboards, service binding |
| Sandbox Worker | `claude-sandbox-worker/src/index.ts` | `PERSISTENT_SERVER_SCRIPT`, Sandbox SDK orchestration |
| Dockerfile | `claude-sandbox-worker/Dockerfile` | Container with Claude CLI, SDK, port 8080 |
| Andee's Skills | `claude-sandbox-worker/.claude/skills/` | Skills for Andee (the bot) |
| Mini Apps | `apps/` | Telegram Mini App frontends (Cloudflare Pages) |

**Key code in `src/index.ts`:**
- `PERSISTENT_SERVER_SCRIPT` - HTTP server (port 8080) with streaming input mode
- `/ask-telegram` endpoint - Uses `startProcess()` + `waitForPort(8080)`
- `getSandbox(..., { sleepAfter: "1h" })` - Container stays alive 1 hour

## Adding a New Skill

### 1. Create Skill Directory

```bash
mkdir -p claude-sandbox-worker/.claude/skills/{skill-name}
```

### 2. Create SKILL.md

Every skill requires a `SKILL.md` with YAML frontmatter:

```markdown
---
name: skill-name
description: One-line description that helps Claude decide when to use this skill. Include trigger words and use cases.
---

# Skill Title

## Instructions
Step-by-step guide for Claude to follow when this skill is invoked...
```

**Naming rules:**
- `name`: lowercase letters, numbers, hyphens only (max 64 chars)
- `description`: non-empty, max 1024 chars, be specific about triggers

### 3. Rebuild Container

After adding skills, rebuild the Docker container:

```bash
cd claude-sandbox-worker && npm run dev
```

The Dockerfile copies skills into `/home/claude/.claude/skills/`.

## webapp: Link Convention

To provide rich UI through Telegram Mini Apps, Claude returns specially formatted links:

```markdown
[Button Text](webapp:https://andee-7rd.pages.dev/{app-name}/?data=...)
```

The Grammy bot parses these and creates InlineKeyboard buttons:

```typescript
// Bot parses webapp: links and creates:
const keyboard = new InlineKeyboard()
  .webApp("Button Text", "https://andee-7rd.pages.dev/{app-name}/?data=...");
```

**Data passing options:**
1. **URL params** (recommended): Base64 encode JSON, pass as `?data=...`
2. **Client fetch**: Pass location/ID, let frontend fetch data

## Mini Apps Architecture

All Mini Apps are served from a single Cloudflare Pages deployment with path-based routing:

```
apps/
├── package.json              # Unified: deploys ALL apps at once
└── src/
    ├── weather/
    │   └── index.html        → https://andee-7rd.pages.dev/weather/
    ├── recipe/
    │   └── index.html        → https://andee-7rd.pages.dev/recipe/
    └── {new-app}/
        └── index.html        → https://andee-7rd.pages.dev/{new-app}/
```

**Benefits:**
- One deployment for all apps (`npm run deploy`)
- One Cloudflare Pages project
- Consistent URL pattern: `andee-7rd.pages.dev/{app-name}/`
- Add new app = add folder + redeploy

## Creating a Mini App

### 1. Create App Directory

```bash
mkdir -p apps/src/{app-name}
```

### 2. Create index.html

Single HTML file with embedded CSS/JS:

```html
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
  <script>
    // Initialize Telegram WebApp
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();

    // Apply Telegram theme colors
    if (tg.themeParams.bg_color) {
      document.body.style.background = tg.themeParams.bg_color;
      document.body.style.color = tg.themeParams.text_color;
    }

    // Parse data from URL
    const params = new URLSearchParams(window.location.search);
    const data = JSON.parse(atob(params.get('data')));

    // Render your UI...
  </script>
</body>
</html>
```

### 3. Deploy All Apps

From the `apps/` directory:

```bash
cd apps && npm run deploy
```

This deploys ALL Mini Apps in `apps/src/` at once.

### 4. Update Skill

Add the Mini App URL to your skill's instructions: `https://andee-7rd.pages.dev/{app-name}/`

### 5. Local Development

```bash
cd apps && npm run dev
# Access at http://localhost:8788/{app-name}/
```

## Available Tools in Container

The Agent SDK has these tools enabled:

- `Read`, `Write`, `Edit` - File operations
- `Bash` - Shell commands
- `Glob`, `Grep` - Search
- `WebSearch`, `WebFetch` - Web access
- `Task` - Subagents
- `Skill` - Invoke other skills

## File Locations (Inside Container)

| Path | Purpose |
|------|---------|
| `/workspace/files/` | Working directory for file operations |
| `/home/claude/.claude/skills/` | Skill definitions |
| `/workspace/persistent_server.mjs` | HTTP server script (written by Worker) |
| `/workspace/telegram_agent.log` | Agent logs (view via `/logs` endpoint) |

**Important:** Port 3000 is reserved by Cloudflare Sandbox. Use port 8080 for internal services.

## Development Workflow

```bash
# Terminal 1: Start worker (rebuilds Docker)
cd claude-sandbox-worker && npm run dev

# Terminal 2: Start bot
cd claude-telegram-bot && npm run start

# Terminal 3: Mini App dev server (serves ALL apps)
cd apps && npm run dev
# Access at http://localhost:8788/weather/, http://localhost:8788/recipe/, etc.

# Test via Telegram
# Send message that triggers your skill
```

## Skill Pattern Examples

### Data Retrieval + Mini App

1. Skill fetches data via WebFetch
2. Processes and summarizes for conversational response
3. Encodes full data in webapp: URL
4. Returns text + button

### Interactive Workflow

1. Skill guides multi-step process
2. Uses Read/Write to persist state
3. Each step updates progress

### External Integration

1. Skill calls external API via WebFetch
2. Transforms response
3. Returns formatted output

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Skill not found | Check SKILL.md syntax, rebuild container |
| webapp: button not appearing | Check link format, verify bot parsing |
| Mini App data error | Verify base64 encoding, check URL length |
| Container errors | Check Dockerfile, verify npm packages |
| Port 3000 in use | Use port 8080 - 3000 is reserved by Sandbox |
| Slow responses | Check if persistent server is reusing (wrangler tail) |
| Process exited with code 1 | Check env vars in startProcess(), port conflicts |

## Performance Tips

- **Persistent server**: Subsequent messages are ~50% faster
- **Container lifecycle**: `sleepAfter: "1h"` keeps container alive
- **Cold starts**: First message after idle takes ~7s
- **Check logs**: Use `/logs?chatId=X` to verify server state
