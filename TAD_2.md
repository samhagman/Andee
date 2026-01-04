# TAD_2: Claude Code Telegram Bot - Local Sandbox Isolation

> **Goal**: Add isolation by running Claude Code inside Docker containers using the Cloudflare Sandbox SDK, while keeping the Grammy bot running locally with long-polling.
>
> **Why**: Phase 1 runs Claude directly on your host machine - Claude can read/write any files, run any commands. Phase 2 sandboxes Claude inside containers where file operations and commands are isolated from your system.
>
> **Prerequisite**: Phase 1 (TAD_1) must be working - local Grammy bot + Claude Agent SDK.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 2: LOCAL SANDBOX ISOLATION                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  YOUR LOCAL MACHINE                                                             │
│  ══════════════════                                                             │
│                                                                                 │
│  ┌─────────────────┐                                                            │
│  │  Your Phone     │                                                            │
│  │  ┌───────────┐  │                                                            │
│  │  │ Telegram  │  │                                                            │
│  │  │   App     │  │                                                            │
│  │  └─────┬─────┘  │                                                            │
│  └────────┼────────┘                                                            │
│           │ long-polling                                                        │
│           ▼                                                                     │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  PROCESS 1: Grammy Bot (claude-telegram-bot/)                            │  │
│  │  ┌────────────────────────────────────────────────────────────────────┐  │  │
│  │  │  Grammy Framework                                                  │  │  │
│  │  │  - Long-polling mode (same as Phase 1)                             │  │  │
│  │  │  - In-memory sessions (same as Phase 1)                            │  │  │
│  │  │  - Commands: /start, /new, /status                                 │  │  │
│  │  └──────────────────────────────┬─────────────────────────────────────┘  │  │
│  │                                 │                                         │  │
│  │  ┌──────────────────────────────▼─────────────────────────────────────┐  │  │
│  │  │  Claude Handler (MODIFIED)                                         │  │  │
│  │  │  - HTTP POST to localhost:8787/ask                                 │  │  │
│  │  │  - Sends: { chatId, message, claudeSessionId }                     │  │  │
│  │  │  - Receives: { response, claudeSessionId, success }                │  │  │
│  │  └────────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                 │                                               │
│                                 │ HTTP (localhost:8787)                         │
│                                 ▼                                               │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  PROCESS 2: Sandbox Worker (claude-sandbox-worker/)                      │  │
│  │  Running via: npx wrangler dev                                           │  │
│  │  ┌────────────────────────────────────────────────────────────────────┐  │  │
│  │  │  Cloudflare Worker (local)                                         │  │  │
│  │  │  - Endpoint: POST /ask                                             │  │  │
│  │  │  - getSandbox() per chat ID                                        │  │  │
│  │  │  - Writes agent script + input to container                        │  │  │
│  │  │  - Executes and captures output                                    │  │  │
│  │  └──────────────────────────────┬─────────────────────────────────────┘  │  │
│  └─────────────────────────────────┼────────────────────────────────────────┘  │
│                                    │ Docker API                                 │
│                                    ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  DOCKER CONTAINER (one per chat, managed by Sandbox SDK)                 │  │
│  │  Base: cloudflare/sandbox:0.6.7                                          │  │
│  │                                                                          │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │  │
│  │  │  Installed:                                                     │    │  │
│  │  │  - Node.js (from base image)                                    │    │  │
│  │  │  - @anthropic-ai/claude-code (CLI runtime)                      │    │  │
│  │  │  - @anthropic-ai/claude-agent-sdk                               │    │  │
│  │  └─────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                          │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │  │
│  │  │  /workspace/                                                    │    │  │
│  │  │  ├── agent.mjs         (Agent SDK script, written per request)  │    │  │
│  │  │  ├── input.json        (User message + session ID)              │    │  │
│  │  │  ├── output.json       (Response from Claude)                   │    │  │
│  │  │  └── files/            (Claude's working directory - ISOLATED)  │    │  │
│  │  └─────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                          │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │  │
│  │  │  ~/.claude/            (Session transcripts - persists in       │    │  │
│  │  │                         container while alive, enables          │    │  │
│  │  │                         multi-turn conversations)               │    │  │
│  │  └─────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                          │  │
│  │  ISOLATION BOUNDARY: Claude cannot access host filesystem!               │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Differences from Phase 1

| Aspect | Phase 1 | Phase 2 |
|--------|---------|---------|
| Claude Execution | Direct on host | Inside Docker container |
| File Access | Full host filesystem | Isolated `/workspace/files/` |
| Bash Commands | Run on host | Run in container |
| Session Transcripts | `~/.claude/` on host | `~/.claude/` in container |
| Architecture | Single process | Two processes (Grammy + Worker) |
| Dependencies | Agent SDK in bot | Agent SDK in container |

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MESSAGE FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. USER SENDS MESSAGE                                                      │
│     ────────────────────                                                    │
│     Phone ──► Telegram ──► Grammy Bot (long-poll receives)                  │
│                                                                             │
│  2. SESSION LOOKUP (Same as Phase 1)                                        │
│     ──────────────────────────────────                                      │
│     Grammy checks in-memory session for chat_id                             │
│     └─► Found: Get stored claudeSessionId                                   │
│     └─► Not found: claudeSessionId = null                                   │
│                                                                             │
│  3. CALL SANDBOX WORKER (NEW IN PHASE 2)                                    │
│     ─────────────────────────────────────                                   │
│     POST http://localhost:8787/ask                                          │
│     Body: {                                                                 │
│       chatId: "123456789",                                                  │
│       message: "Create a hello.txt file",                                   │
│       claudeSessionId: "existing-session-id" | null                         │
│     }                                                                       │
│                                                                             │
│  4. SANDBOX WORKER PROCESSING                                               │
│     ─────────────────────────────                                           │
│     a) getSandbox(env.Sandbox, `chat-${chatId}`)                            │
│        └─► Same chatId = same container (reused)                            │
│        └─► New chatId = new container (created)                             │
│                                                                             │
│     b) sandbox.writeFile("/workspace/input.json", {                         │
│          message: userMessage,                                              │
│          claudeSessionId: existingId                                        │
│        })                                                                   │
│                                                                             │
│     c) sandbox.exec("node /workspace/agent.mjs")                            │
│        └─► Agent script runs query() with Agent SDK                         │
│        └─► Claude processes message, uses tools                             │
│        └─► All file operations in /workspace/files/                         │
│        └─► Writes result to /workspace/output.json                          │
│                                                                             │
│     d) sandbox.readFile("/workspace/output.json")                           │
│        └─► { response: "...", claudeSessionId: "..." }                      │
│                                                                             │
│     e) Return response to Grammy bot                                        │
│        (Container stays alive for future messages)                          │
│                                                                             │
│  5. RESPONSE                                                                │
│     ──────────                                                              │
│     Grammy updates session, sends reply to Telegram                         │
│                                                                             │
│  6. /new COMMAND (Reset)                                                    │
│     ─────────────────────                                                   │
│     POST http://localhost:8787/reset                                        │
│     Body: { chatId: "123456789" }                                           │
│     └─► sandbox.destroy() - kills container                                 │
│     └─► Next message creates fresh container                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
~/projects/Andee/
├── CLAUDE.md                      # Project context
├── TAD_1.md                       # Phase 1 plan (local bot)
├── TAD_2.md                       # Phase 2 plan (sandbox isolation)
├── *_RESEARCH_REPORT.md           # Research documentation
│
├── claude-telegram-bot/           # EXISTING (Phase 1) - Modified
│   ├── src/
│   │   ├── index.ts               # Grammy bot (minor changes)
│   │   └── claude-handler.ts      # MODIFIED: calls sandbox worker
│   ├── package.json
│   ├── tsconfig.json
│   └── .env
│
└── claude-sandbox-worker/         # NEW (Phase 2)
    ├── src/
    │   └── index.ts               # Worker: sandbox orchestration
    ├── scripts/
    │   └── agent.mjs              # Agent script (copied to container)
    ├── Dockerfile                 # Container definition
    ├── wrangler.toml              # Cloudflare config
    ├── .dev.vars                  # Local secrets (ANTHROPIC_API_KEY)
    ├── package.json
    └── tsconfig.json
```

---

## Implementation Steps

### Step 1: Create Sandbox Worker Project (~5 min)

```bash
# Navigate to Andee project root
cd ~/projects/Andee

# Create new project
mkdir claude-sandbox-worker && cd claude-sandbox-worker

# Initialize
npm init -y
npm pkg set type="module"

# Install dependencies
npm install @cloudflare/sandbox
npm install -D wrangler typescript @types/node

# Create directories
mkdir -p src scripts
```

### Step 2: Configure Wrangler (~2 min)

**wrangler.toml**:
```toml
name = "claude-sandbox-worker"
main = "src/index.ts"
compatibility_date = "2024-12-01"

# Enable containers
[containers]
dockerfile = "Dockerfile"
```

**tsconfig.json**:
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

**package.json** scripts:
```bash
npm pkg set scripts.dev="wrangler dev"
npm pkg set scripts.deploy="wrangler deploy"
```

### Step 3: Create Dockerfile (~3 min)

**Dockerfile**:
```dockerfile
# Base image with Node.js and sandbox runtime
FROM docker.io/cloudflare/sandbox:0.6.7

# Install Claude Code CLI (required runtime for Agent SDK)
RUN npm install -g @anthropic-ai/claude-code

# Install Agent SDK globally for the agent script
RUN npm install -g @anthropic-ai/claude-agent-sdk

# Create workspace directory
RUN mkdir -p /workspace/files

# Set working directory for Claude operations
WORKDIR /workspace/files
```

### Step 4: Create Agent Script (~5 min)

This script runs INSIDE the container and executes Claude queries.

**scripts/agent.mjs**:
```javascript
#!/usr/bin/env node

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync } from "fs";

// Read input from file (safer than command line args for long messages)
const input = JSON.parse(readFileSync("/workspace/input.json", "utf-8"));
const { message, claudeSessionId } = input;

async function main() {
  let sessionId = claudeSessionId;
  let response = "";
  let errorMessage = "";

  console.error(`[Agent] Starting query (resume: ${claudeSessionId ? "yes" : "no"})`);

  try {
    for await (const msg of query({
      prompt: message,
      options: {
        // Session management
        resume: claudeSessionId || undefined,

        // Permissions - fully autonomous (required for automated operation)
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,

        // All tools available
        allowedTools: [
          "Read", "Write", "Edit",      // File operations
          "Bash",                        // Command execution
          "Glob", "Grep",               // Search
          "WebSearch", "WebFetch",      // Web access
          "Task"                         // Subagents
        ],

        // Working directory - isolated inside container
        cwd: "/workspace/files",

        // Model
        model: "claude-sonnet-4-5",

        // Reasonable turn limit
        maxTurns: 25
      }
    })) {
      // Capture session ID from init message
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id;
        console.error(`[Agent] Session initialized: ${sessionId}`);
      }

      // Capture result
      if (msg.type === "result") {
        if (msg.subtype === "success") {
          response = msg.result;
          console.error(`[Agent] Query completed. Cost: $${msg.total_cost_usd?.toFixed(4)}`);
        } else {
          errorMessage = `Query ended with: ${msg.subtype}`;
          if (msg.errors) {
            errorMessage += `\n${msg.errors.join("\n")}`;
          }
        }
      }
    }
  } catch (error) {
    console.error("[Agent] Error:", error);
    errorMessage = error.message || "Unknown error";
  }

  // Write output
  const output = {
    success: !errorMessage,
    response: response || errorMessage || "No response from Claude",
    claudeSessionId: sessionId
  };

  writeFileSync("/workspace/output.json", JSON.stringify(output, null, 2));
  console.error("[Agent] Output written to /workspace/output.json");
}

main().catch(console.error);
```

### Step 5: Create Sandbox Worker (~10 min)

**src/index.ts**:
```typescript
import { getSandbox, Sandbox } from "@cloudflare/sandbox";

// Re-export Sandbox for Durable Object binding
export { Sandbox } from "@cloudflare/sandbox";

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ANTHROPIC_API_KEY: string;
}

interface AskRequest {
  chatId: string;
  message: string;
  claudeSessionId: string | null;
}

interface ResetRequest {
  chatId: string;
}

interface AgentOutput {
  success: boolean;
  response: string;
  claudeSessionId: string | null;
}

// Agent script content - embedded for simplicity
const AGENT_SCRIPT = `#!/usr/bin/env node

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync } from "fs";

const input = JSON.parse(readFileSync("/workspace/input.json", "utf-8"));
const { message, claudeSessionId } = input;

async function main() {
  let sessionId = claudeSessionId;
  let response = "";
  let errorMessage = "";

  console.error(\`[Agent] Starting query (resume: \${claudeSessionId ? "yes" : "no"})\`);

  try {
    for await (const msg of query({
      prompt: message,
      options: {
        resume: claudeSessionId || undefined,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: [
          "Read", "Write", "Edit",
          "Bash",
          "Glob", "Grep",
          "WebSearch", "WebFetch",
          "Task"
        ],
        cwd: "/workspace/files",
        model: "claude-sonnet-4-5",
        maxTurns: 25
      }
    })) {
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id;
        console.error(\`[Agent] Session initialized: \${sessionId}\`);
      }

      if (msg.type === "result") {
        if (msg.subtype === "success") {
          response = msg.result;
          console.error(\`[Agent] Query completed. Cost: $\${msg.total_cost_usd?.toFixed(4)}\`);
        } else {
          errorMessage = \`Query ended with: \${msg.subtype}\`;
          if (msg.errors) {
            errorMessage += "\\n" + msg.errors.join("\\n");
          }
        }
      }
    }
  } catch (error) {
    console.error("[Agent] Error:", error);
    errorMessage = error.message || "Unknown error";
  }

  const output = {
    success: !errorMessage,
    response: response || errorMessage || "No response from Claude",
    claudeSessionId: sessionId
  };

  writeFileSync("/workspace/output.json", JSON.stringify(output, null, 2));
  console.error("[Agent] Output written to /workspace/output.json");
}

main().catch(console.error);
`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers for local development
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", service: "claude-sandbox-worker" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Main endpoint: /ask
    if (url.pathname === "/ask" && request.method === "POST") {
      try {
        const body = await request.json() as AskRequest;
        const { chatId, message, claudeSessionId } = body;

        if (!chatId || !message) {
          return Response.json(
            { error: "Missing chatId or message" },
            { status: 400, headers: corsHeaders }
          );
        }

        console.log(`[Worker] Processing request for chat ${chatId}`);

        // Get or create sandbox for this chat
        // Same chatId = same container (persistent between messages)
        const sandbox = getSandbox(env.Sandbox, `chat-${chatId}`, {
          sleepAfter: 10 * 60 * 1000,  // Sleep after 10 min inactivity
        });

        // Write agent script to container
        await sandbox.writeFile("/workspace/agent.mjs", AGENT_SCRIPT);

        // Write input
        const input = { message, claudeSessionId };
        await sandbox.writeFile("/workspace/input.json", JSON.stringify(input));

        // Set API key and run agent
        const result = await sandbox.exec(
          `ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY} node /workspace/agent.mjs`,
          { timeout: 180000 }  // 3 minute timeout
        );

        console.log(`[Worker] Exec completed. Exit code: ${result.exitCode}`);
        if (result.stderr) {
          console.log(`[Worker] Stderr: ${result.stderr}`);
        }

        // Read output
        const outputFile = await sandbox.readFile("/workspace/output.json");
        const output: AgentOutput = JSON.parse(outputFile.content);

        console.log(`[Worker] Response ready for chat ${chatId}`);

        return Response.json(output, { headers: corsHeaders });

      } catch (error) {
        console.error("[Worker] Error:", error);
        return Response.json(
          {
            success: false,
            response: `Sandbox error: ${error instanceof Error ? error.message : "Unknown error"}`,
            claudeSessionId: null
          },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Reset endpoint: /reset (destroy sandbox for chat)
    if (url.pathname === "/reset" && request.method === "POST") {
      try {
        const body = await request.json() as ResetRequest;
        const { chatId } = body;

        if (!chatId) {
          return Response.json(
            { error: "Missing chatId" },
            { status: 400, headers: corsHeaders }
          );
        }

        console.log(`[Worker] Resetting sandbox for chat ${chatId}`);

        const sandbox = getSandbox(env.Sandbox, `chat-${chatId}`);
        await sandbox.destroy();

        console.log(`[Worker] Sandbox destroyed for chat ${chatId}`);

        return Response.json({ success: true, message: "Sandbox reset" }, { headers: corsHeaders });

      } catch (error) {
        console.error("[Worker] Reset error:", error);
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
};
```

### Step 6: Create .dev.vars (~1 min)

**.dev.vars** (local secrets, gitignored):
```
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

**.gitignore**:
```
node_modules/
dist/
.dev.vars
.wrangler/
```

### Step 7: Modify Grammy Bot's Claude Handler (~5 min)

Update `claude-telegram-bot/src/claude-handler.ts` to call the sandbox worker:

```typescript
// claude-telegram-bot/src/claude-handler.ts

const SANDBOX_WORKER_URL = process.env.SANDBOX_WORKER_URL || "http://localhost:8787";

export interface ClaudeResponse {
  response: string;
  sessionId: string;
}

export async function handleClaudeMessage(
  userMessage: string,
  existingSessionId: string | null,
  chatId: string  // NEW: need chat ID for sandbox routing
): Promise<ClaudeResponse> {

  console.log(`Calling sandbox worker for chat ${chatId}...`);

  const response = await fetch(`${SANDBOX_WORKER_URL}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: chatId.toString(),
      message: userMessage,
      claudeSessionId: existingSessionId
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sandbox worker error: ${response.status} - ${error}`);
  }

  const result = await response.json() as {
    success: boolean;
    response: string;
    claudeSessionId: string | null;
  };

  if (!result.success) {
    throw new Error(result.response);
  }

  return {
    response: result.response,
    sessionId: result.claudeSessionId || existingSessionId || ""
  };
}

export async function resetSandbox(chatId: string): Promise<void> {
  console.log(`Resetting sandbox for chat ${chatId}...`);

  const response = await fetch(`${SANDBOX_WORKER_URL}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: chatId.toString() })
  });

  if (!response.ok) {
    console.error(`Failed to reset sandbox: ${response.status}`);
  }
}
```

### Step 8: Update Grammy Bot index.ts (~3 min)

Modify `claude-telegram-bot/src/index.ts` to pass chatId and use reset:

```typescript
// Add to imports
import { handleClaudeMessage, resetSandbox } from "./claude-handler.js";

// Modify /new command to reset sandbox
bot.command("new", async (ctx) => {
  const chatId = ctx.chat.id;

  // Reset sandbox (destroy container)
  await resetSandbox(chatId.toString());

  // Clear local session
  ctx.session.claudeSessionId = null;
  ctx.session.messageCount = 0;

  await ctx.reply("Started a new conversation! Sandbox reset and context cleared.");
});

// Modify message handler to pass chatId
bot.on("message:text", async (ctx) => {
  const userMessage = ctx.message.text;
  const chatId = ctx.chat.id;

  console.log(`[${chatId}] Received: ${userMessage.substring(0, 50)}...`);

  await ctx.reply("Processing with Claude (sandboxed)...");

  try {
    const { response, sessionId } = await handleClaudeMessage(
      userMessage,
      ctx.session.claudeSessionId,
      chatId.toString()  // Pass chat ID for sandbox routing
    );

    ctx.session.claudeSessionId = sessionId;
    ctx.session.messageCount++;

    await sendLongMessage(ctx, response);

    console.log(`[${chatId}] Responded successfully`);
  } catch (error) {
    console.error(`[${chatId}] Error:`, error);
    await ctx.reply(
      "Sorry, an error occurred while processing your message.\n" +
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
});
```

### Step 9: First Run - Build Container (~5 min)

```bash
# Terminal 1: Start sandbox worker (first run builds Docker image)
cd ~/projects/Andee/claude-sandbox-worker
npm run dev

# Expected output:
# ⎔ Starting local server...
# Building container image... (takes 2-3 minutes first time)
# ✓ Container image built
# [mf:inf] Ready on http://localhost:8787
```

### Step 10: Start Grammy Bot (~1 min)

```bash
# Terminal 2: Start Grammy bot
cd ~/projects/Andee/claude-telegram-bot
npm run start

# Expected output:
# Starting Claude Telegram Bot...
# Bot is running! Send a message to your bot on Telegram.
```

---

## Testing

### Test 1: Basic Message
1. Send any message to your bot
2. Should see "Processing with Claude (sandboxed)..."
3. Should get response

### Test 2: File Isolation
1. Send: "Create a file called test.txt with 'Hello from sandbox'"
2. Send: "Read test.txt"
3. Check your host: `ls ~/claude-workspace/` - should be empty!
4. File exists only in container

### Test 3: Multi-turn Context
1. Send: "Remember the number 42"
2. Send: "What number did I ask you to remember?"
3. Should correctly recall 42 (same container, session preserved)

### Test 4: Session Reset
1. Send: /new
2. Send: "What number did I ask you to remember?"
3. Should NOT remember (new container, fresh context)

### Test 5: Container Persistence
1. Send a message
2. Wait a few seconds
3. Send another message
4. Should be fast (container reused, not recreated)

---

## Troubleshooting

### "Container build failed"
- Ensure Docker is running: `docker ps`
- Check Docker has enough resources (4GB+ RAM recommended)

### "ANTHROPIC_API_KEY not set" in container
- Check `.dev.vars` exists in `claude-sandbox-worker/`
- Ensure key is correct

### "Connection refused to localhost:8787"
- Ensure sandbox worker is running: `npm run dev` in `claude-sandbox-worker/`
- Check for errors in worker terminal

### Timeout errors
- Claude operations can take time; 3-minute timeout is set
- For very long operations, consider breaking into smaller requests

### "Sandbox not found" after restart
- Normal! Containers are ephemeral
- Next message creates new container

---

## Configuration Reference

| Setting | Value | Rationale |
|---------|-------|-----------|
| Container base | `cloudflare/sandbox:0.6.7` | Official sandbox image with Node.js |
| Sleep timeout | 10 minutes | Balance between responsiveness and resources |
| Exec timeout | 3 minutes | Allow complex Claude operations |
| Working directory | `/workspace/files` | Isolated, ephemeral |
| Sandbox ID | `chat-${chatId}` | One container per Telegram chat |

---

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and instructions |
| `/new` | Destroy sandbox, start fresh conversation |
| `/status` | Show current session info |

---

## Running Both Processes

For convenience, you can use a process manager or two terminal windows:

**Option A: Two Terminals**
```bash
# Terminal 1
cd ~/projects/Andee/claude-sandbox-worker && npm run dev

# Terminal 2
cd ~/projects/Andee/claude-telegram-bot && npm run start
```

**Option B: Create a start script** (in Andee directory)
```bash
#!/bin/bash
# ~/projects/Andee/start-phase2.sh

# Start sandbox worker in background
cd ~/projects/Andee/claude-sandbox-worker
npm run dev &
WORKER_PID=$!

# Wait for worker to be ready
sleep 5

# Start Grammy bot
cd ~/projects/Andee/claude-telegram-bot
npm run start

# Cleanup on exit
trap "kill $WORKER_PID" EXIT
```

---

## Security Improvements in Phase 2

| Risk | Phase 1 | Phase 2 |
|------|---------|---------|
| File access | Full host filesystem | Container only (`/workspace/files`) |
| Command execution | Runs on host | Runs in container |
| Network access | Host network | Container network (still has internet) |
| Process isolation | None | Docker process isolation |
| Resource limits | None | Docker resource limits |

---

## What's Next: Phase 3 Preview

Phase 3 will take this to production:

1. **Deploy Grammy to Cloudflare Workers** (webhook mode)
2. **Deploy Sandbox Worker to Cloudflare** (edge containers)
3. **Add R2 for session persistence** (survives deployments)
4. **Production secrets management**

The architecture established in Phase 2 maps directly to Phase 3 - the sandbox worker becomes a deployed Cloudflare Worker, and the Grammy bot becomes a webhook-based Worker.

---

## Appendix: Complete File Listing

### claude-sandbox-worker/package.json
```json
{
  "name": "claude-sandbox-worker",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "@cloudflare/sandbox": "^0.6.7"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241230.0",
    "typescript": "^5.7.2",
    "wrangler": "^4.0.0"
  }
}
```

### Updated claude-telegram-bot/.env
```bash
BOT_TOKEN=your_telegram_bot_token_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
SANDBOX_WORKER_URL=http://localhost:8787
```

---

Plan link: /Users/sam/projects/Andee/TAD_2.md
