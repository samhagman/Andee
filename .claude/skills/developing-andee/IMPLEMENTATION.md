# Implementation Guide

How to build features for Andee.

## Contents

- [Creating Skills](#creating-skills)
- [Direct Link Mini Apps](#direct-link-mini-apps)
- [Mini Apps Architecture](#mini-apps-architecture)
- [Creating Mini Apps](#creating-mini-apps)
- [Available Container Tools](#available-container-tools)
- [File Locations](#file-locations)
- [Container Scripts](#container-scripts)
- [Development Workflow](#development-workflow)
- [Skill Pattern Examples](#skill-pattern-examples)

---

## Creating Skills

Skills go in `claude-sandbox-worker/.claude/skills/` and are copied into the Docker container.

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

**For production:** Deploy and reset sandboxes to pick up new skills:
```bash
cd claude-sandbox-worker && npx wrangler deploy
```

---

## Direct Link Mini Apps

To provide rich UI through Telegram Mini Apps, Claude returns Direct Link URLs:

```markdown
[Button Text](https://t.me/HeyAndee_bot/app?startapp={component}_{base64url_data})
```

This opens the shell Mini App which loads the requested component.

### Link Format

```
https://t.me/HeyAndee_bot/app?startapp={component}_{base64url_data}
```

- `component`: Folder name in `apps/src/` (e.g., `weather`)
- `_`: Separator
- `base64url_data`: Base64url-encoded JSON (replace `+` with `-`, `/` with `_`, remove `=`)

### How It Works

1. User taps link → Telegram opens shell (`apps/src/app/`)
2. Shell parses startapp → extracts component + data
3. Shell loads component in iframe: `https://andee-7rd.pages.dev/{component}/#data={data}`
4. Component reads data from URL hash

### Example

```markdown
[View Weather](https://t.me/HeyAndee_bot/app?startapp=weather_eyJ0ZW1wIjoyMn0)
```

Where `eyJ0ZW1wIjoyMn0` is base64url encoded `{"temp":22}`.

### Why Direct Links?

- Works in **group chats** (WebApp buttons only work in private chats)
- No special parsing needed (regular clickable link)
- One shell Mini App handles all components

---

## Mini Apps Architecture

Mini Apps use **Vite + TypeScript** with a shared library and shell architecture on Cloudflare Pages:

```
apps/
├── package.json              # Vite + TypeScript
├── vite.config.ts            # Multi-page app config (add entries here)
├── tsconfig.json
└── src/
    ├── lib/                  # SHARED LIBRARY
    │   ├── telegram.ts       # initTelegram(), applyTheme(), getStartParam()
    │   ├── base64url.ts      # encode(), decode()
    │   ├── data.ts           # getData<T>() from URL hash
    │   ├── base.css          # Shared styles, CSS variables
    │   └── types/            # TypeScript interfaces (WeatherData, etc.)
    ├── app/                  # Shell router
    │   ├── index.html        → https://t.me/HeyAndee_bot/app?startapp=...
    │   └── main.ts
    ├── weather/              # Weather component
    │   ├── index.html        → https://andee-7rd.pages.dev/weather/#data=...
    │   ├── main.ts
    │   └── weather.css
    └── {component}/          # Add new components here
        ├── index.html
        └── main.ts
```

**How it works:**
1. User taps Direct Link: `https://t.me/HeyAndee_bot/app?startapp=weather_BASE64`
2. Telegram opens shell Mini App
3. Shell parses startapp, loads component in iframe
4. Component reads data from URL hash using shared `getData<T>()` function

**Benefits:**
- TypeScript with typed data contracts
- Shared library (no code duplication)
- Vite dev server with hot reload
- `npm run typecheck` catches errors before deploy

---

## Creating Mini Apps

### 1. Create Component Directory

```bash
mkdir -p apps/src/{component-name}
```

### 2. Add TypeScript Interface

Create `apps/src/lib/types/{component}.ts`:

```typescript
export interface MyComponentData {
  title: string;
  value: number;
}
```

Export from `apps/src/lib/types/index.ts`:

```typescript
export * from './mycomponent';
```

### 3. Create index.html

Minimal HTML entry point:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>My Component</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <link rel="stylesheet" href="../lib/base.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

### 4. Create main.ts

```typescript
import { initTelegram, getData } from '../lib';
import type { MyComponentData } from '../lib/types';

initTelegram();

const { data, error } = getData<MyComponentData>();

if (error) {
  document.getElementById('app')!.innerHTML = `Error: ${error.message}`;
} else if (data) {
  document.getElementById('app')!.innerHTML = `
    <h1>${data.title}</h1>
    <p>Value: ${data.value}</p>
  `;
}
```

### 5. Add to Vite Config

Edit `apps/vite.config.ts`:

```typescript
rollupOptions: {
  input: {
    app: resolve(__dirname, "src/app/index.html"),
    weather: resolve(__dirname, "src/weather/index.html"),
    mycomponent: resolve(__dirname, "src/mycomponent/index.html"),  // Add this
  },
},
```

### 6. Test & Deploy

```bash
cd apps
npm run typecheck    # Verify types
npm run dev          # Test at http://localhost:8788/mycomponent/#data={base64url}
npm run deploy       # Build + deploy
```

### 7. Update Skill

Generate Direct Links in your skill:
```markdown
[Button](https://t.me/HeyAndee_bot/app?startapp=mycomponent_{base64url})
```

For full details, see [guides/mini-apps.md](guides/mini-apps.md).

---

## Available Container Tools

The Agent SDK has these tools enabled inside the container:

| Tool | Purpose |
|------|---------|
| `Read` | Read file contents |
| `Write` | Write new files |
| `Edit` | Edit existing files |
| `Bash` | Shell commands |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents |
| `WebSearch` | Search the web |
| `WebFetch` | Fetch URLs |
| `Task` | Launch subagents |
| `Skill` | Invoke other skills |

---

## File Locations

Paths inside the container:

| Path | Purpose |
|------|---------|
| `/workspace/files/` | Working directory for file operations |
| `/home/claude/.claude/skills/` | Skill definitions |
| `/home/claude/.claude/PERSONALITY.md` | Personality/style prompt (appended to system prompt) |
| `/workspace/persistent_server.mjs` | HTTP server script (written by Worker) |
| `/workspace/telegram_agent.log` | Agent logs (view via `/logs` endpoint) |

**Important:** Port 3000 is reserved by Cloudflare Sandbox. Use port 8080 for internal services.

---

## Customizing Personality

Andee's personality is defined in `claude-sandbox-worker/.claude/PERSONALITY.md` and appended to Claude's system prompt via `systemPrompt.append`.

**What it controls:**
- Identity & pronouns
- Voice & tone (warm, grounded, late millennial)
- Communication style (concise, mobile-friendly)
- Telegram formatting awareness
- Proactive helpfulness guidelines

**To modify:**
1. Edit `claude-sandbox-worker/.claude/PERSONALITY.md`
2. Rebuild container: `npm run dev` (local) or `npx wrangler deploy` (production)

**How it works:**
The agent scripts (`persistent-server.script.js`, `agent-telegram.script.js`) load PERSONALITY.md at startup and pass it to the SDK:

```javascript
const personalityPrompt = readFileSync('/home/claude/.claude/PERSONALITY.md', 'utf-8');
query({
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: personalityPrompt
    }
  }
});
```

This preserves Claude Code's base instructions while adding Andee's personality on top.

---

## Container Scripts

Scripts that run inside the Docker container are stored as `.script.js` files and imported as raw text using Wrangler's `[[rules]]` feature.

### Why .script.js?

Previously scripts were embedded as template literal strings (no syntax highlighting). Now they're real JavaScript files with full editor support:

| Feature | Old (template literal) | New (.script.js) |
|---------|------------------------|------------------|
| Syntax highlighting | No | Yes |
| ESLint linting | No | Yes |
| JSDoc types | No | Yes |
| Escape hell | `\\n`, `\${` | Normal JS |

### Script Files

```
claude-sandbox-worker/src/scripts/           # Wrangler-imported scripts (.script.js)
├── persistent-server.script.js              # Main HTTP server (streaming input mode)
├── agent-telegram.script.js                 # Fallback one-shot agent
├── scripts.d.ts                             # TypeScript: declare module '*.script.js'
└── index.ts                                 # Re-exports scripts as strings

claude-sandbox-worker/.claude/scripts/       # Container-resident scripts (copied by Dockerfile)
└── ws-terminal.js                           # WebSocket terminal with PTY (port 8081)
```

### Terminal Script Details

The `ws-terminal.js` script provides the WebSocket terminal for the Sandbox IDE:

| Feature | Implementation |
|---------|----------------|
| PTY support | node-pty (not child_process.spawn) |
| Port | 8081 |
| Protocol | ttyd-compatible ('0' = I/O, '1' = resize JSON) |
| Resize | `shell.resize(cols, rows)` works correctly |
| Claude Code TUI | Works (isatty() returns true) |

**Dependencies in Dockerfile:**
```dockerfile
RUN apt-get update && apt-get install -y build-essential python3  # For node-pty compilation
RUN npm install -g ws node-pty
```

### How It Works

1. **Wrangler rule** in `wrangler.toml`:
   ```toml
   [[rules]]
   type = "Text"
   globs = ["**/*.script.js"]
   fallthrough = true
   ```

2. **Import as text** in TypeScript:
   ```typescript
   import PERSISTENT_SERVER_SCRIPT from './persistent-server.script.js';
   // PERSISTENT_SERVER_SCRIPT is now a string containing the file contents
   ```

3. **Write to container** at runtime via Sandbox SDK's `writeFile()` or `startProcess()`

### Adding a New Script

1. Create `src/scripts/my-script.script.js` (use `.script.js` extension)
2. Write normal JavaScript with shebang:
   ```javascript
   #!/usr/bin/env node
   // Your script here - full syntax highlighting!
   ```
3. Export from `src/scripts/index.ts`:
   ```typescript
   import MY_SCRIPT from './my-script.script.js';
   export { MY_SCRIPT };
   ```
4. Use in handler: write to container filesystem, then execute

---

## Development Workflow

### Start Local Development

```bash
# Terminal 1: Start worker (rebuilds Docker)
cd claude-sandbox-worker && npm run dev

# Terminal 2: Start bot
cd claude-telegram-bot && npm run start

# Terminal 3: Mini App dev server (serves ALL apps)
cd apps && npm run dev
# Access at http://localhost:8788/weather/, http://localhost:8788/recipe/, etc.
```

### Test via Telegram

Send a message that triggers your skill.

### Test Worker Directly

```bash
# Test without Telegram
curl -X POST http://localhost:8787/ask \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"test","message":"trigger your skill","claudeSessionId":null}'
```

---

## Skill Pattern Examples

### Data Retrieval + Mini App

1. Skill fetches data via WebFetch
2. Processes and summarizes for conversational response
3. Encodes data as base64url in Direct Link
4. Returns text + link

```markdown
Here's today's weather summary: 22°C and sunny.

[View Full Forecast](https://t.me/HeyAndee_bot/app?startapp=weather_eyJ0ZW1wIjoyMn0)
```

### Interactive Workflow

1. Skill guides multi-step process
2. Uses Read/Write to persist state
3. Each step updates progress

### External Integration

1. Skill calls external API via WebFetch
2. Transforms response
3. Returns formatted output
