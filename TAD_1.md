# TAD_1: Claude Code Telegram Bot - End-to-End Demo Plan

> **Goal**: Get a working Telegram bot that connects to Claude Code Agent SDK, allowing you to message Claude from your phone with full conversation persistence.
>
> **Approach**: Phased implementation - start with simplest local demo, then add production features.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                         CLAUDE CODE TELEGRAM BOT                               │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  PHASE 1: LOCAL DEMO (Fastest Path - ~30 min to working bot)                  │
│  ═══════════════════════════════════════════════════════════                   │
│                                                                                │
│   ┌─────────────────┐                                                          │
│   │  Your Phone     │                                                          │
│   │  ┌───────────┐  │    long-polling    ┌──────────────────────────────────┐ │
│   │  │ Telegram  │◄─┼───────────────────►│  Local Node.js                   │ │
│   │  │   App     │  │                    │                                  │ │
│   │  └───────────┘  │                    │  ┌────────────────────────────┐  │ │
│   └─────────────────┘                    │  │  Grammy Bot                │  │ │
│                                          │  │  - Long-polling mode       │  │ │
│                                          │  │  - In-memory sessions      │  │ │
│                                          │  └──────────┬─────────────────┘  │ │
│                                          │             │                     │ │
│                                          │  ┌──────────▼─────────────────┐  │ │
│                                          │  │  Claude Agent SDK          │  │ │
│                                          │  │  - query() with resume     │  │ │
│                                          │  │  - ALL built-in tools      │  │ │
│                                          │  │  - bypassPermissions       │  │ │
│                                          │  └──────────┬─────────────────┘  │ │
│                                          │             │                     │ │
│                                          │  ┌──────────▼─────────────────┐  │ │
│                                          │  │  ~/claude-workspace/       │  │ │
│                                          │  │  Dedicated working dir     │  │ │
│                                          │  └────────────────────────────┘  │ │
│                                          └──────────────────────────────────┘ │
│                                                                                │
│                                                                                │
│  PHASE 2: CLOUDFLARE SANDBOX (Optional - Adds isolation)                      │
│  ════════════════════════════════════════════════════════                      │
│                                                                                │
│   Grammy Bot ──► Cloudflare Sandbox (Docker) ──► Claude Code in container     │
│                                                                                │
│                                                                                │
│  PHASE 3: PRODUCTION DEPLOYMENT (Full stack)                                  │
│  ═══════════════════════════════════════════                                   │
│                                                                                │
│   Telegram ──webhook──► CF Worker ──► CF Sandbox ──► Claude Code              │
│                              │                           │                     │
│                              └──── R2 Storage ◄──────────┘                     │
│                                (session persistence)                           │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow (Phase 1)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          MESSAGE FLOW                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. USER SENDS MESSAGE                                                  │
│     ────────────────────                                                │
│     Phone ──► Telegram Server ──► Grammy (long-poll receives)          │
│                                                                         │
│  2. SESSION LOOKUP                                                      │
│     ──────────────────                                                  │
│     Grammy checks in-memory session for chat_id                         │
│     └─► Found: Get stored claudeSessionId                              │
│     └─► Not found: Create new session, claudeSessionId = null          │
│                                                                         │
│  3. CLAUDE PROCESSING                                                   │
│     ────────────────────                                                │
│     query({                                                             │
│       prompt: userMessage,                                              │
│       options: {                                                        │
│         resume: claudeSessionId,     // Multi-turn context!            │
│         permissionMode: "bypassPermissions",                           │
│         allowedTools: [ALL TOOLS],                                     │
│         cwd: "~/claude-workspace"                                       │
│       }                                                                 │
│     })                                                                  │
│           │                                                             │
│           │  Stream of messages...                                      │
│           ▼                                                             │
│     ┌─────────────────────────────────────────┐                        │
│     │ message.type === "system" && "init"     │──► Save session_id     │
│     │ message.type === "result" && "success"  │──► Extract final text  │
│     └─────────────────────────────────────────┘                        │
│                                                                         │
│  4. RESPONSE                                                            │
│     ──────────                                                          │
│     Grammy ──► Telegram Server ──► Phone                               │
│     (chunks if > 4096 chars)                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Implementation Steps

### Step 1: Create Telegram Bot (~2 min)

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`
3. Enter a name (e.g., "My Claude Assistant")
4. Enter a username (e.g., "my_claude_assistant_bot")
5. **Save the token** - looks like: `7123456789:AAHxyz123...`

### Step 2: Project Setup (~5 min)

```bash
# Create project directory
mkdir claude-telegram-bot && cd claude-telegram-bot

# Initialize and install dependencies
npm init -y
npm install grammy @anthropic-ai/claude-agent-sdk dotenv
npm install -D typescript ts-node @types/node

# Create tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
EOF

# Update package.json type and scripts
npm pkg set type="module"
npm pkg set scripts.start="node --import tsx src/index.ts"
npm pkg set scripts.dev="node --import tsx --watch src/index.ts"
npm install -D tsx

# Create source directory
mkdir src

# Create workspace directory
mkdir -p ~/claude-workspace
```

### Step 3: Environment File (~1 min)

```bash
# Create .env file
cat > .env << 'EOF'
BOT_TOKEN=your_telegram_bot_token_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
CLAUDE_WORKSPACE=/Users/$(whoami)/claude-workspace
EOF

# Create .gitignore
cat > .gitignore << 'EOF'
node_modules/
dist/
.env
*.log
EOF
```

### Step 4: Main Bot Code (~10 min)

**src/index.ts**:
```typescript
import "dotenv/config";
import { Bot, Context, session, SessionFlavor } from "grammy";
import { handleClaudeMessage } from "./claude-handler.js";

// Session type
interface SessionData {
  claudeSessionId: string | null;
  messageCount: number;
}

type MyContext = Context & SessionFlavor<SessionData>;

// Validate environment
if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN not set");
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

// Create bot
const bot = new Bot<MyContext>(process.env.BOT_TOKEN);

// Session middleware (in-memory)
bot.use(session({
  initial: (): SessionData => ({
    claudeSessionId: null,
    messageCount: 0
  })
}));

// /start command
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Hello! I'm a Claude Code assistant.\n\n" +
    "Send me any message and I'll process it with Claude's full capabilities:\n" +
    "- Read/write files\n" +
    "- Run bash commands\n" +
    "- Search the web\n" +
    "- And more!\n\n" +
    "Commands:\n" +
    "/new - Start a fresh conversation\n" +
    "/status - Check session status"
  );
});

// /new command - reset conversation
bot.command("new", async (ctx) => {
  ctx.session.claudeSessionId = null;
  ctx.session.messageCount = 0;
  await ctx.reply("Started a new conversation! Previous context cleared.");
});

// /status command
bot.command("status", async (ctx) => {
  const hasSession = ctx.session.claudeSessionId !== null;
  await ctx.reply(
    `Session Status:\n` +
    `- Active session: ${hasSession ? "Yes" : "No"}\n` +
    `- Messages in session: ${ctx.session.messageCount}\n` +
    `- Session ID: ${ctx.session.claudeSessionId || "None"}`
  );
});

// Handle text messages
bot.on("message:text", async (ctx) => {
  const userMessage = ctx.message.text;
  const chatId = ctx.chat.id;

  console.log(`[${chatId}] Received: ${userMessage.substring(0, 50)}...`);

  // Send "thinking" indicator
  await ctx.reply("Processing with Claude...");

  try {
    const { response, sessionId } = await handleClaudeMessage(
      userMessage,
      ctx.session.claudeSessionId
    );

    // Update session
    ctx.session.claudeSessionId = sessionId;
    ctx.session.messageCount++;

    // Send response (split if too long)
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

// Helper: Send long messages in chunks
async function sendLongMessage(ctx: MyContext, text: string): Promise<void> {
  const MAX_LENGTH = 4000; // Telegram limit is 4096

  if (text.length <= MAX_LENGTH) {
    await ctx.reply(text);
    return;
  }

  // Split at newlines when possible
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIndex = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitIndex === -1 || splitIndex < MAX_LENGTH / 2) {
      splitIndex = MAX_LENGTH;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

// Error handler
bot.catch((err) => {
  console.error("Bot error:", err.error);
});

// Start bot
console.log("Starting Claude Telegram Bot...");
console.log(`Workspace: ${process.env.CLAUDE_WORKSPACE}`);
bot.start();
console.log("Bot is running! Send a message to your bot on Telegram.");
```

**src/claude-handler.ts**:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const WORKSPACE = process.env.CLAUDE_WORKSPACE || `${process.env.HOME}/claude-workspace`;

export interface ClaudeResponse {
  response: string;
  sessionId: string;
}

export async function handleClaudeMessage(
  userMessage: string,
  existingSessionId: string | null
): Promise<ClaudeResponse> {

  let sessionId = existingSessionId;
  let response = "";
  let errorMessage = "";

  console.log(`Claude query starting... (resume: ${existingSessionId ? "yes" : "no"})`);

  try {
    for await (const message of query({
      prompt: userMessage,
      options: {
        // Session management
        resume: existingSessionId || undefined,

        // Permissions - fully autonomous
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,

        // All tools available
        allowedTools: [
          "Read", "Write", "Edit",      // File operations
          "Bash",                         // Command execution
          "Glob", "Grep",                // Search
          "WebSearch", "WebFetch",       // Web access
          "Task"                          // Subagents
        ],

        // Working directory
        cwd: WORKSPACE,

        // Model
        model: "claude-sonnet-4-5",

        // No cost limit per user preference
        // maxBudgetUsd: undefined,

        // Reasonable turn limit
        maxTurns: 25
      }
    })) {
      // Capture session ID from init message
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        console.log(`Session initialized: ${sessionId}`);
      }

      // Capture result
      if (message.type === "result") {
        if (message.subtype === "success") {
          response = message.result;
          console.log(`Query completed. Cost: $${message.total_cost_usd?.toFixed(4)}`);
        } else {
          // Error cases
          errorMessage = `Query ended with: ${message.subtype}`;
          if ("errors" in message && message.errors) {
            errorMessage += `\n${message.errors.join("\n")}`;
          }
        }
      }
    }
  } catch (error) {
    console.error("Claude query error:", error);
    throw error;
  }

  if (!sessionId) {
    throw new Error("No session ID received from Claude");
  }

  if (errorMessage && !response) {
    response = `Error: ${errorMessage}`;
  }

  if (!response) {
    response = "Claude completed the task but didn't provide a text response.";
  }

  return { response, sessionId };
}
```

### Step 5: Install Claude Code Runtime (~2 min)

```bash
# Install Claude Code CLI globally (required by Agent SDK)
npm install -g @anthropic-ai/claude-code

# Verify installation
claude --version
```

### Step 6: Run and Test (~5 min)

```bash
# Start the bot
npm run start

# You should see:
# Starting Claude Telegram Bot...
# Workspace: /Users/your-username/claude-workspace
# Bot is running! Send a message to your bot on Telegram.
```

**Test in Telegram:**
1. Open Telegram, find your bot
2. Send `/start` - should get welcome message
3. Try: "What's 2 + 2?"
4. Try: "Create a file called hello.txt with 'Hello World' in it"
5. Try: "What files are in my workspace?"
6. Try: "Search the web for latest TypeScript 5.x features"

---

## Configuration Reference

| Setting | Value | Rationale |
|---------|-------|-----------|
| Working directory | `~/claude-workspace` | Dedicated, isolated workspace |
| Tool access | Full (all tools) | Maximum capability per user preference |
| Cost limit | None | Per user preference |
| Max turns | 25 | Allows complex multi-step tasks |
| Permission mode | `bypassPermissions` | Required for automated operation |
| Session storage | In-memory | Simplest for Phase 1 |

---

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and instructions |
| `/new` | Clear session, start fresh conversation |
| `/status` | Show current session info |

---

## Troubleshooting

### "BOT_TOKEN not set"
- Check `.env` file exists and has correct token

### "Cannot find module '@anthropic-ai/claude-agent-sdk'"
- Run `npm install @anthropic-ai/claude-agent-sdk`

### "Claude Code CLI not found"
- Run `npm install -g @anthropic-ai/claude-code`

### Bot doesn't respond
- Check console for errors
- Verify `ANTHROPIC_API_KEY` is valid
- Make sure bot is running (`npm run start`)

### Timeout errors
- Telegram expects responses within 60 seconds
- For long operations, Claude may timeout
- Consider breaking into smaller requests

---

## Phase 2 & 3 Preview

### Phase 2: Add Sandbox
- Install Docker
- Create `Dockerfile` with Claude Code
- Use `@cloudflare/sandbox` to run Claude in container
- Isolates execution from your local system

### Phase 3: Production
- Deploy to Cloudflare Workers
- Switch Grammy to webhook mode
- Use R2 for session persistence
- Mount R2 in Sandbox for transcript storage

---

## Research Reports

Detailed documentation for each component:
- `CLAUDE_AGENT_SDK_RESEARCH_REPORT.md` - Agent SDK API reference
- `GRAMMY_RESEARCH_REPORT.md` - Grammy bot framework guide
- `CLOUDFLARE_SANDBOX_RESEARCH_REPORT.md` - Sandbox SDK documentation
- `CLOUDFLARE_R2_RESEARCH_REPORT.md` - R2 storage patterns

---

Plan link: /Users/sam/projects/Andee/TAD_1.md
