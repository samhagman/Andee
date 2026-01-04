# TAD_3: Claude Code Telegram Bot - Production Deployment

> **Goal**: Deploy the Claude Telegram Bot to Cloudflare's edge infrastructure for 24/7 availability, with persistent session storage and proper secrets management.
>
> **Why**: Phase 2 works locally but requires your machine to be running. Phase 3 deploys everything to Cloudflare - the Grammy bot becomes a webhook-based Worker, the sandbox runs on edge containers, and sessions persist in R2 storage.
>
> **Prerequisite**: Phase 2 (TAD_2) must be working - local sandbox worker + Grammy bot.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 3: PRODUCTION DEPLOYMENT                               │
├────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  CLOUDFLARE EDGE (Global)                                                           │
│  ════════════════════════                                                           │
│                                                                                     │
│  ┌─────────────────┐                                                                │
│  │  Your Phone     │                                                                │
│  │  ┌───────────┐  │                                                                │
│  │  │ Telegram  │  │                                                                │
│  │  │   App     │  │                                                                │
│  │  └─────┬─────┘  │                                                                │
│  └────────┼────────┘                                                                │
│           │ HTTPS                                                                   │
│           ▼                                                                         │
│  ┌──────────────────────┐     webhook POST      ┌─────────────────────────────────┐│
│  │   Telegram Servers   │ ───────────────────►  │  WORKER 1: Grammy Bot           ││
│  │                      │                       │  claude-telegram-bot.workers.dev││
│  └──────────────────────┘                       │                                 ││
│                                                 │  ┌───────────────────────────┐  ││
│                                                 │  │  Webhook Handler          │  ││
│                                                 │  │  - Receives updates       │  ││
│                                                 │  │  - Session from R2        │  ││
│                                                 │  │  - Commands: /start, /new │  ││
│                                                 │  └─────────┬─────────────────┘  ││
│                                                 │            │                     ││
│                                                 │  ┌─────────▼─────────────────┐  ││
│                                                 │  │  R2 Binding (sessions)    │  ││
│                                                 │  │  sessions/${chatId}.json  │  ││
│                                                 │  └───────────────────────────┘  ││
│                                                 └───────────────┬─────────────────┘│
│                                                                 │                   │
│                                                   Service Binding / HTTP           │
│                                                                 │                   │
│                                                                 ▼                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │  WORKER 2: Sandbox Worker                                                   │   │
│  │  claude-sandbox-worker.workers.dev                                          │   │
│  │                                                                             │   │
│  │  ┌───────────────────────────────────────────────────────────────────────┐ │   │
│  │  │  Durable Object: Sandbox                                              │ │   │
│  │  │  - One per chat ID                                                    │ │   │
│  │  │  - Manages container lifecycle                                        │ │   │
│  │  │  - 10-min sleep timeout                                               │ │   │
│  │  └───────────────────────────────────────────────────────────────────────┘ │   │
│  │                        │                                                     │   │
│  │                        │ Container API                                       │   │
│  │                        ▼                                                     │   │
│  │  ┌───────────────────────────────────────────────────────────────────────┐ │   │
│  │  │  EDGE CONTAINER (Cloudflare Containers)                               │ │   │
│  │  │                                                                       │ │   │
│  │  │  ┌─────────────────────────────────────────────────────────────────┐ │ │   │
│  │  │  │  /workspace/                                                    │ │ │   │
│  │  │  │  ├── agent.mjs        (Claude Agent SDK script)                 │ │ │   │
│  │  │  │  ├── input.json       (User message + session ID)               │ │ │   │
│  │  │  │  ├── output.json      (Claude's response)                       │ │ │   │
│  │  │  │  ├── progress.json    (Streaming status for polling)            │ │ │   │
│  │  │  │  └── files/           (Isolated workspace)                      │ │ │   │
│  │  │  └─────────────────────────────────────────────────────────────────┘ │ │   │
│  │  │                                                                       │ │   │
│  │  │  ┌─────────────────────────────────────────────────────────────────┐ │ │   │
│  │  │  │  /home/claude/.claude/  (Session transcripts)                   │ │ │   │
│  │  │  └─────────────────────────────────────────────────────────────────┘ │ │   │
│  │  │                                                                       │ │   │
│  │  └───────────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                             │   │
│  │  ┌───────────────────────────────────────────────────────────────────────┐ │   │
│  │  │  R2 Binding (transcripts)                                             │ │   │
│  │  │  transcripts/${chatId}/   (Persisted Claude sessions)                 │ │   │
│  │  └───────────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                     │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Differences from Phase 2

| Aspect | Phase 2 (Local) | Phase 3 (Production) |
|--------|-----------------|----------------------|
| Grammy Bot | Local Node.js process | Cloudflare Worker |
| Telegram Connection | Long-polling | Webhook |
| Sandbox Worker | Local wrangler dev | Deployed Worker |
| Container Runtime | Local Docker | Cloudflare Containers |
| Session Storage | In-memory | R2 bucket |
| Availability | When laptop runs | 24/7 global edge |
| Worker Communication | localhost HTTP | Service Binding |
| Secrets | .env / .dev.vars | Cloudflare Secrets |

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PRODUCTION MESSAGE FLOW                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. USER SENDS MESSAGE                                                      │
│     ────────────────────                                                    │
│     Phone ──► Telegram Servers ──► Webhook POST to Grammy Worker            │
│                                    https://claude-telegram-bot.workers.dev  │
│                                                                             │
│  2. SESSION LOOKUP (R2)                                                     │
│     ───────────────────                                                     │
│     Grammy Worker reads from R2: sessions/${chatId}.json                    │
│     └─► Found: Get stored claudeSessionId                                   │
│     └─► Not found: Create new session object                                │
│                                                                             │
│  3. CALL SANDBOX WORKER (Service Binding)                                   │
│     ─────────────────────────────────────                                   │
│     Service Binding: env.SANDBOX_WORKER.fetch(request)                      │
│     └─► Lower latency than HTTP (same Cloudflare network)                   │
│     └─► No public URL exposure needed                                       │
│                                                                             │
│  4. SANDBOX PROCESSING (Same as Phase 2)                                    │
│     ──────────────────────────────────────                                  │
│     a) getSandbox(env.Sandbox, `chat-${chatId}`)                            │
│        └─► Container wakes from sleep or creates new                        │
│                                                                             │
│     b) Write input, execute agent, read output                              │
│                                                                             │
│     c) Return response to Grammy Worker                                     │
│                                                                             │
│  5. SAVE SESSION & RESPOND                                                  │
│     ─────────────────────                                                   │
│     Grammy Worker writes to R2: sessions/${chatId}.json                     │
│     Grammy Worker returns 200 OK to Telegram                                │
│     Telegram delivers response to user's phone                              │
│                                                                             │
│  6. /new COMMAND (Reset)                                                    │
│     ─────────────────────                                                   │
│     Grammy Worker:                                                          │
│     └─► Calls SANDBOX_WORKER /reset endpoint                                │
│     └─► Deletes R2 session: sessions/${chatId}.json                         │
│     └─► Next message starts completely fresh                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure (Phase 3)

```
~/projects/Andee/
├── CLAUDE.md
├── TAD_1.md                       # Phase 1 plan
├── TAD_2.md                       # Phase 2 plan
├── TAD_3.md                       # Phase 3 plan (this file)
│
├── claude-telegram-bot/           # MODIFIED: Now a Cloudflare Worker
│   ├── src/
│   │   └── index.ts               # Webhook-based Worker
│   ├── wrangler.toml              # NEW: Worker config with R2 + Service Binding
│   ├── package.json               # MODIFIED: Add wrangler, remove grammy deps
│   └── .dev.vars                  # Local secrets
│
└── claude-sandbox-worker/         # UNCHANGED: Already Worker-ready
    ├── src/
    │   └── index.ts               # Worker with sandbox orchestration
    ├── Dockerfile
    ├── wrangler.toml              # Add R2 binding for transcripts
    ├── package.json
    └── .dev.vars
```

---

## Implementation Steps

### Step 1: Create R2 Buckets (~3 min)

Create two R2 buckets for persistent storage:

```bash
# Login to Cloudflare (if not already)
npx wrangler login

# Create bucket for Grammy bot sessions (chatId → claudeSessionId mapping)
npx wrangler r2 bucket create andee-sessions

# Create bucket for Claude transcripts (optional - for session restore across container restarts)
npx wrangler r2 bucket create andee-transcripts

# Verify buckets created
npx wrangler r2 bucket list
```

**Expected output:**
```
Creating bucket andee-sessions...
Created bucket andee-sessions
Creating bucket andee-transcripts...
Created bucket andee-transcripts
```

---

### Step 2: Update Sandbox Worker for Production (~5 min)

Update `claude-sandbox-worker/wrangler.toml` to add R2 binding:

**claude-sandbox-worker/wrangler.toml** (updated):
```toml
name = "claude-sandbox-worker"
main = "src/index.ts"
compatibility_date = "2024-12-01"

# Remove [dev] section for production (optional - keep for local dev)
[dev]
port = 8787

# Durable Object binding for Sandbox
[durable_objects]
bindings = [
  { name = "Sandbox", class_name = "Sandbox" }
]

# Migrations - Sandbox requires SQLite storage
[[migrations]]
tag = "v1"
new_sqlite_classes = ["Sandbox"]

# Container configuration
[[containers]]
class_name = "Sandbox"
image = "./Dockerfile"

# R2 binding for transcript persistence (optional enhancement)
[[r2_buckets]]
binding = "TRANSCRIPTS"
bucket_name = "andee-transcripts"
```

Set production secrets:

```bash
cd ~/projects/Andee/claude-sandbox-worker

# Set Anthropic API key as secret (NOT in wrangler.toml)
npx wrangler secret put ANTHROPIC_API_KEY
# Paste your API key when prompted
```

---

### Step 3: Deploy Sandbox Worker (~5 min)

```bash
cd ~/projects/Andee/claude-sandbox-worker

# Deploy to Cloudflare
npx wrangler deploy

# Expected output:
# Uploading claude-sandbox-worker...
# Building container image...
# Published claude-sandbox-worker (X.XX sec)
# https://claude-sandbox-worker.<your-subdomain>.workers.dev
```

**Save the deployed URL** - you'll need it for the Grammy Worker.

Test the deployment:
```bash
# Health check
curl https://claude-sandbox-worker.<your-subdomain>.workers.dev/

# Should return: {"status":"ok","service":"claude-sandbox-worker"}
```

---

### Step 4: Convert Grammy Bot to Cloudflare Worker (~15 min)

The Grammy bot needs significant changes to work as a webhook-based Worker.

#### 4.1 Update package.json

**claude-telegram-bot/package.json** (updated):
```json
{
  "name": "claude-telegram-bot",
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "set-webhook": "node scripts/set-webhook.mjs"
  },
  "dependencies": {
    "grammy": "^1.39.2"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241230.0",
    "typescript": "^5.9.3",
    "wrangler": "^4.0.0"
  }
}
```

```bash
cd ~/projects/Andee/claude-telegram-bot

# Remove Node.js-only dependencies
npm uninstall dotenv @anthropic-ai/claude-agent-sdk tsx @types/node

# Install Cloudflare dependencies
npm install -D wrangler @cloudflare/workers-types

# Update Grammy (already compatible with Workers)
npm update grammy
```

#### 4.2 Create wrangler.toml

**claude-telegram-bot/wrangler.toml** (new file):
```toml
name = "claude-telegram-bot"
main = "src/index.ts"
compatibility_date = "2024-12-01"

# R2 binding for session storage
[[r2_buckets]]
binding = "SESSIONS"
bucket_name = "andee-sessions"

# Service Binding to Sandbox Worker (lower latency than HTTP)
[[services]]
binding = "SANDBOX_WORKER"
service = "claude-sandbox-worker"
```

#### 4.3 Create tsconfig.json (if not exists)

**claude-telegram-bot/tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*"]
}
```

#### 4.4 Rewrite src/index.ts for Webhook Mode

**claude-telegram-bot/src/index.ts** (complete rewrite):
```typescript
import { Bot, webhookCallback, Context } from "grammy";

// Type definitions
interface Env {
  BOT_TOKEN: string;
  SESSIONS: R2Bucket;
  SANDBOX_WORKER: Fetcher;
}

interface SessionData {
  claudeSessionId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface SandboxResponse {
  success: boolean;
  response: string;
  claudeSessionId: string | null;
}

// Session helpers
async function getSession(env: Env, chatId: string): Promise<SessionData> {
  const key = `sessions/${chatId}.json`;
  const object = await env.SESSIONS.get(key);

  if (object) {
    const data = await object.json() as SessionData;
    return data;
  }

  // Return default session
  return {
    claudeSessionId: null,
    messageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function saveSession(env: Env, chatId: string, session: SessionData): Promise<void> {
  const key = `sessions/${chatId}.json`;
  session.updatedAt = new Date().toISOString();
  await env.SESSIONS.put(key, JSON.stringify(session));
}

async function deleteSession(env: Env, chatId: string): Promise<void> {
  const key = `sessions/${chatId}.json`;
  await env.SESSIONS.delete(key);
}

// Call sandbox worker via Service Binding
async function callSandbox(
  env: Env,
  chatId: string,
  message: string,
  claudeSessionId: string | null
): Promise<SandboxResponse> {
  const response = await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        message,
        claudeSessionId
      })
    })
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sandbox error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<SandboxResponse>;
}

async function resetSandbox(env: Env, chatId: string): Promise<void> {
  await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId })
    })
  );
}

// Split long messages for Telegram's 4096 char limit
function splitMessage(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at newline
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  return chunks;
}

// Create bot handler
function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  // /start command
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hello! I'm a Claude Code assistant running on Cloudflare's edge.\n\n" +
      "Send me any message and I'll process it with Claude's full capabilities:\n" +
      "- Read/write files (sandboxed)\n" +
      "- Run bash commands\n" +
      "- Search the web\n" +
      "- And more!\n\n" +
      "Commands:\n" +
      "/new - Start a fresh conversation\n" +
      "/status - Check session status"
    );
  });

  // /new command
  bot.command("new", async (ctx) => {
    const chatId = ctx.chat.id.toString();

    // Reset sandbox container
    await resetSandbox(env, chatId);

    // Delete R2 session
    await deleteSession(env, chatId);

    await ctx.reply("Started a new conversation! Sandbox reset and context cleared.");
  });

  // /status command
  bot.command("status", async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const session = await getSession(env, chatId);

    await ctx.reply(
      `Session Status:\n` +
      `- Active session: ${session.claudeSessionId ? "Yes" : "No"}\n` +
      `- Messages in session: ${session.messageCount}\n` +
      `- Session ID: ${session.claudeSessionId || "None"}\n` +
      `- Created: ${session.createdAt}\n` +
      `- Last updated: ${session.updatedAt}`
    );
  });

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const userMessage = ctx.message.text;

    console.log(`[${chatId}] Received: ${userMessage.substring(0, 50)}...`);

    // Send typing indicator
    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    // Get session from R2
    const session = await getSession(env, chatId);

    try {
      // Call sandbox worker
      const result = await callSandbox(
        env,
        chatId,
        userMessage,
        session.claudeSessionId
      );

      if (!result.success) {
        throw new Error(result.response);
      }

      // Update session
      session.claudeSessionId = result.claudeSessionId;
      session.messageCount++;
      await saveSession(env, chatId, session);

      // Send response (split if needed)
      const chunks = splitMessage(result.response);
      for (const chunk of chunks) {
        await ctx.reply(chunk, {
          link_preview_options: { is_disabled: true }
        });
      }

      console.log(`[${chatId}] Responded successfully`);

    } catch (error) {
      console.error(`[${chatId}] Error:`, error);
      await ctx.reply(
        "Sorry, an error occurred while processing your message.\n" +
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  });

  return bot;
}

// Export Worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Health check
    if (new URL(request.url).pathname === "/") {
      return new Response(JSON.stringify({
        status: "ok",
        service: "claude-telegram-bot"
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Handle webhook
    const bot = createBot(env);
    const handler = webhookCallback(bot, "cloudflare-mod");
    return handler(request);
  }
};
```

#### 4.5 Create Webhook Setup Script

**claude-telegram-bot/scripts/set-webhook.mjs** (new file):
```javascript
#!/usr/bin/env node

// Run this after deploying to set up the Telegram webhook
// Usage: BOT_TOKEN=xxx WEBHOOK_URL=https://... node scripts/set-webhook.mjs

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!BOT_TOKEN || !WEBHOOK_URL) {
  console.error("Usage: BOT_TOKEN=xxx WEBHOOK_URL=https://... node scripts/set-webhook.mjs");
  process.exit(1);
}

async function setWebhook() {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      allowed_updates: ["message"],
      drop_pending_updates: true
    })
  });

  const result = await response.json();
  console.log("Set webhook result:", JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.error("Failed to set webhook!");
    process.exit(1);
  }

  // Verify webhook
  const infoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
  const infoResponse = await fetch(infoUrl);
  const info = await infoResponse.json();
  console.log("\nWebhook info:", JSON.stringify(info, null, 2));
}

setWebhook();
```

#### 4.6 Create .dev.vars for Local Development

**claude-telegram-bot/.dev.vars** (new file):
```
BOT_TOKEN=your_telegram_bot_token_here
```

Add to `.gitignore`:
```bash
echo ".dev.vars" >> ~/projects/Andee/claude-telegram-bot/.gitignore
```

---

### Step 5: Deploy Grammy Worker (~5 min)

```bash
cd ~/projects/Andee/claude-telegram-bot

# Set bot token as secret
npx wrangler secret put BOT_TOKEN
# Paste your Telegram bot token when prompted

# Deploy
npx wrangler deploy

# Expected output:
# Uploading claude-telegram-bot...
# Published claude-telegram-bot (X.XX sec)
# https://claude-telegram-bot.<your-subdomain>.workers.dev
```

**Save the deployed URL** - you'll need it for the webhook.

---

### Step 6: Set Telegram Webhook (~2 min)

```bash
cd ~/projects/Andee/claude-telegram-bot

# Set the webhook URL (replace with your actual values)
BOT_TOKEN=your_bot_token \
WEBHOOK_URL=https://claude-telegram-bot.<your-subdomain>.workers.dev \
node scripts/set-webhook.mjs

# Expected output:
# Set webhook result: { "ok": true, "result": true, "description": "Webhook was set" }
# Webhook info: { "ok": true, "result": { "url": "https://...", "has_custom_certificate": false, ... } }
```

Alternative using curl:
```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://claude-telegram-bot.<your-subdomain>.workers.dev", "allowed_updates": ["message"]}'
```

---

### Step 7: Test Production Deployment (~5 min)

#### Test 1: Health Checks
```bash
# Grammy Worker
curl https://claude-telegram-bot.<your-subdomain>.workers.dev/
# Should return: {"status":"ok","service":"claude-telegram-bot"}

# Sandbox Worker
curl https://claude-sandbox-worker.<your-subdomain>.workers.dev/
# Should return: {"status":"ok","service":"claude-sandbox-worker"}
```

#### Test 2: Basic Message
1. Open Telegram on your phone
2. Send any message to your bot
3. Should receive a response (may take a few seconds for cold start)

#### Test 3: Session Persistence
1. Send: "Remember the number 42"
2. Wait a few minutes
3. Send: "What number did I mention?"
4. Should correctly recall 42

#### Test 4: Session Reset
1. Send: `/new`
2. Send: "What number did I mention?"
3. Should NOT remember (session cleared)

#### Test 5: Container Persistence
1. Send a message
2. Note response time (cold start may be slow)
3. Send another message immediately
4. Should be faster (container still warm)

---

### Step 8: Configure Custom Domain (Optional) (~10 min)

For a cleaner URL like `bot.yourdomain.com`:

#### 8.1 Add Custom Domain to Worker

```bash
npx wrangler domains add claude-telegram-bot bot.yourdomain.com
```

Or via Cloudflare Dashboard:
1. Go to Workers & Pages → claude-telegram-bot
2. Settings → Triggers → Custom Domains
3. Add `bot.yourdomain.com`

#### 8.2 Update Webhook URL

```bash
BOT_TOKEN=your_bot_token \
WEBHOOK_URL=https://bot.yourdomain.com \
node scripts/set-webhook.mjs
```

---

### Step 9: Set Up Monitoring (Optional) (~5 min)

#### 9.1 Enable Workers Analytics

Analytics are automatic. View in Cloudflare Dashboard:
- Workers & Pages → claude-telegram-bot → Analytics
- View requests, errors, CPU time

#### 9.2 Add Error Alerting

Via Cloudflare Dashboard:
1. Go to Notifications → Create
2. Select "Workers" → "Script Errors"
3. Choose claude-telegram-bot and claude-sandbox-worker
4. Set email notification

#### 9.3 Check Logs

Real-time logs:
```bash
# Grammy Worker logs
npx wrangler tail claude-telegram-bot

# Sandbox Worker logs
npx wrangler tail claude-sandbox-worker
```

---

## Configuration Reference

| Setting | Value | Rationale |
|---------|-------|-----------|
| Grammy Worker | Webhook mode | Cloudflare Workers can't do long-polling |
| Session Storage | R2 bucket | Persistent across deployments |
| Worker Communication | Service Binding | Lower latency than HTTP |
| Container sleep | 10 minutes | Balance responsiveness vs resources |
| Secrets | Cloudflare Secrets | Not in code, encrypted at rest |

---

## Deployment Commands Summary

```bash
# One-time setup
npx wrangler login
npx wrangler r2 bucket create andee-sessions
npx wrangler r2 bucket create andee-transcripts

# Deploy Sandbox Worker
cd ~/projects/Andee/claude-sandbox-worker
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy

# Deploy Grammy Worker
cd ~/projects/Andee/claude-telegram-bot
npx wrangler secret put BOT_TOKEN
npx wrangler deploy

# Set webhook
BOT_TOKEN=xxx WEBHOOK_URL=https://claude-telegram-bot.xxx.workers.dev \
node scripts/set-webhook.mjs

# View logs
npx wrangler tail claude-telegram-bot
npx wrangler tail claude-sandbox-worker
```

---

## Troubleshooting

| Problem | Error | Solution |
|---------|-------|----------|
| Webhook not receiving | Telegram returns error | Verify URL is HTTPS and accessible |
| Service binding fails | "Binding not found" | Ensure sandbox worker is deployed first |
| R2 access denied | "No access to R2" | Check binding name matches wrangler.toml |
| Container timeout | Request exceeds 30s | Increase `request_timeout` or break into smaller requests |
| Cold start slow | First request 5-10s | Expected; container needs to start |
| Secret not found | "BOT_TOKEN undefined" | Run `npx wrangler secret put BOT_TOKEN` |
| "Cannot find package" in container | Container missing deps | Check Dockerfile has all npm installs |
| Webhook SSL error | Certificate invalid | Use workers.dev domain or properly configured custom domain |

---

## Cost Estimation

| Resource | Free Tier | Paid Tier | Notes |
|----------|-----------|-----------|-------|
| Workers Requests | 100K/day | $0.50/M | Grammy Worker + Sandbox Worker |
| Workers CPU | 10ms avg | $0.02/M ms | Webhook handling is fast |
| R2 Storage | 10 GB | $0.015/GB | Sessions are tiny (~1KB each) |
| R2 Operations | 1M Class A, 10M Class B | $4.50/M, $0.36/M | Read/write sessions |
| Containers | See pricing | Per-second billing | Main cost driver |
| Durable Objects | 1M requests | $0.15/M | Sandbox orchestration |

For light personal use, you'll likely stay within free tiers. Containers are the primary cost for heavier use.

---

## Security Considerations

| Aspect | Implementation |
|--------|----------------|
| API Keys | Cloudflare Secrets (encrypted, not in code) |
| Bot Token | Cloudflare Secrets |
| Webhook Verification | Grammy handles automatically |
| Code Execution | Sandboxed in containers |
| File Access | Container-isolated `/workspace/files` |
| Network | Container has internet but isolated from Cloudflare |
| R2 Access | Worker-only via bindings |

---

## Rollback Procedure

If something goes wrong:

```bash
# Revert Grammy Worker to previous version
npx wrangler rollback claude-telegram-bot

# Revert Sandbox Worker to previous version
npx wrangler rollback claude-sandbox-worker

# Or delete webhook and run locally again
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
cd ~/projects/Andee/claude-telegram-bot && npm run start  # Local mode
```

---

## Local Development with Production R2

You can test locally while using production R2:

```bash
cd ~/projects/Andee/claude-telegram-bot

# Run locally with remote R2 (requires --remote flag)
npx wrangler dev --remote

# This uses your deployed R2 buckets but runs code locally
```

---

## What's Next: Phase 4 Ideas

Future enhancements to consider:

1. **Streaming Responses** - Edit messages as Claude generates tokens (requires raw API)
2. **Multi-user Authentication** - Restrict bot to specific Telegram users
3. **Usage Tracking** - Log costs per user/chat
4. **File Sharing** - Allow uploading files to Claude's workspace
5. **Image Understanding** - Send images to Claude for analysis
6. **Voice Messages** - Transcribe voice and send to Claude
7. **Web UI** - Alternative interface alongside Telegram

---

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DEPLOYMENT CHECKLIST                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  □ 1. Login to Cloudflare CLI                                               │
│       npx wrangler login                                                    │
│                                                                             │
│  □ 2. Create R2 buckets                                                     │
│       npx wrangler r2 bucket create andee-sessions                          │
│       npx wrangler r2 bucket create andee-transcripts                       │
│                                                                             │
│  □ 3. Deploy Sandbox Worker                                                 │
│       cd claude-sandbox-worker                                              │
│       npx wrangler secret put ANTHROPIC_API_KEY                             │
│       npx wrangler deploy                                                   │
│                                                                             │
│  □ 4. Update Grammy Bot code                                                │
│       - Convert to webhook mode                                             │
│       - Add wrangler.toml                                                   │
│       - Update dependencies                                                 │
│                                                                             │
│  □ 5. Deploy Grammy Worker                                                  │
│       cd claude-telegram-bot                                                │
│       npx wrangler secret put BOT_TOKEN                                     │
│       npx wrangler deploy                                                   │
│                                                                             │
│  □ 6. Set Telegram webhook                                                  │
│       BOT_TOKEN=xxx WEBHOOK_URL=https://... node scripts/set-webhook.mjs    │
│                                                                             │
│  □ 7. Test end-to-end                                                       │
│       - Send message from phone                                             │
│       - Verify response                                                     │
│       - Test /new command                                                   │
│       - Test /status command                                                │
│                                                                             │
│  □ 8. Set up monitoring (optional)                                          │
│       - Enable error alerts                                                 │
│       - Review analytics                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

Plan link: /Users/sam/projects/Andee/TAD_3.md
