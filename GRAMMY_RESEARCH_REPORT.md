# Grammy.dev Research Report

> **Purpose**: Condensed reference for building Telegram bots with Grammy on Cloudflare Workers
> **Package**: `grammy`
> **Docs**: https://grammy.dev

---

## Quick Start

```bash
npm install grammy
```

```typescript
import { Bot } from "grammy";

const bot = new Bot("YOUR_BOT_TOKEN");

bot.command("start", (ctx) => ctx.reply("Hello!"));
bot.on("message", (ctx) => ctx.reply("Got your message!"));

// Long-polling (development)
bot.start();

// OR Webhook (production - see below)
```

---

## Core Concepts

### Bot Instance
```typescript
import { Bot, Context } from "grammy";

// Basic bot
const bot = new Bot("TOKEN");

// With custom context type
type MyContext = Context & SessionFlavor<SessionData>;
const bot = new Bot<MyContext>("TOKEN");
```

### Context Object (`ctx`)
Every update handler receives a context object with:

```typescript
bot.on("message", async (ctx) => {
  ctx.message        // The message object
  ctx.from           // Sender info
  ctx.chat           // Chat info
  ctx.msg            // Shorthand for ctx.message

  // Reply methods
  await ctx.reply("Text");
  await ctx.replyWithPhoto(file);
  await ctx.replyWithDocument(file);

  // Direct API access
  await ctx.api.sendMessage(chatId, "Direct");
});
```

---

## Cloudflare Workers Deployment (CRITICAL)

### Project Structure
```
my-bot/
├── src/
│   └── index.ts
├── wrangler.toml
├── .dev.vars          # Local secrets (gitignored)
└── package.json
```

### wrangler.toml
```toml
name = "telegram-bot"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
BOT_INFO = """{
  "id": 1234567890,
  "is_bot": true,
  "first_name": "MyBot",
  "username": "MyBotUsername",
  "can_join_groups": true,
  "can_read_all_group_messages": false,
  "supports_inline_queries": false
}"""

# R2 bucket binding (if using)
[[r2_buckets]]
binding = "SESSIONS_BUCKET"
bucket_name = "bot-sessions"
```

### .dev.vars (local development)
```
BOT_TOKEN=your_bot_token_here
```

### Worker Code (src/index.ts)
```typescript
import { Bot, webhookCallback, Context, SessionFlavor } from "grammy";

export interface Env {
  BOT_TOKEN: string;
  BOT_INFO: string;
  SESSIONS_BUCKET?: R2Bucket;  // Optional R2 binding
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const bot = new Bot(env.BOT_TOKEN, {
      botInfo: JSON.parse(env.BOT_INFO)
    });

    // Setup handlers
    bot.command("start", (ctx) => ctx.reply("Hello!"));
    bot.on("message:text", (ctx) => ctx.reply(`Echo: ${ctx.message.text}`));

    // CRITICAL: Use "cloudflare-mod" adapter for Workers
    return webhookCallback(bot, "cloudflare-mod")(request);
  }
};
```

### Deployment Commands
```bash
# Deploy worker
npm run deploy  # or: npx wrangler deploy

# Set secret (never in wrangler.toml!)
npx wrangler secret put BOT_TOKEN

# Set webhook with Telegram
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<WORKER>.<SUBDOMAIN>.workers.dev/"
```

---

## Session Management

### Basic Sessions (In-Memory)
```typescript
import { Bot, Context, session, SessionFlavor } from "grammy";

interface SessionData {
  messageCount: number;
  lastMessage?: string;
  claudeSessionId?: string;  // For Agent SDK integration!
}

type MyContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<MyContext>("TOKEN");

bot.use(session({
  initial: (): SessionData => ({
    messageCount: 0
  })
}));

bot.on("message", async (ctx) => {
  ctx.session.messageCount++;
  ctx.session.lastMessage = ctx.message.text;
  await ctx.reply(`Message #${ctx.session.messageCount}`);
});
```

### R2 Storage Adapter (CRITICAL FOR PERSISTENCE)
```typescript
import { StorageAdapter } from "grammy";

interface SessionData {
  claudeSessionId: string | null;
  createdAt: number;
  lastActivity: number;
}

class R2StorageAdapter implements StorageAdapter<SessionData> {
  constructor(private bucket: R2Bucket) {}

  async read(key: string): Promise<SessionData | undefined> {
    const obj = await this.bucket.get(`sessions/${key}.json`);
    if (!obj) return undefined;
    return obj.json();
  }

  async write(key: string, value: SessionData): Promise<void> {
    await this.bucket.put(
      `sessions/${key}.json`,
      JSON.stringify(value),
      { httpMetadata: { contentType: "application/json" } }
    );
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(`sessions/${key}.json`);
  }
}

// Usage in worker
bot.use(session({
  initial: (): SessionData => ({
    claudeSessionId: null,
    createdAt: Date.now(),
    lastActivity: Date.now()
  }),
  storage: new R2StorageAdapter(env.SESSIONS_BUCKET)
}));
```

### Session Key Strategies
```typescript
// Per chat (default) - best for group bots
getSessionKey: (ctx) => ctx.chat?.id.toString()

// Per user - best for DM bots
getSessionKey: (ctx) => ctx.from?.id.toString()

// Per user+chat combo
getSessionKey: (ctx) => ctx.from && ctx.chat
  ? `${ctx.from.id}_${ctx.chat.id}`
  : undefined
```

---

## Message Handling Patterns

### Commands
```typescript
bot.command("start", (ctx) => ctx.reply("Welcome!"));
bot.command("help", (ctx) => ctx.reply("Help text..."));
bot.command("new", (ctx) => {
  ctx.session.claudeSessionId = null;  // Reset Claude session
  ctx.reply("Started new conversation!");
});
```

### Text Messages
```typescript
// Any text message
bot.on("message:text", async (ctx) => {
  const userMessage = ctx.message.text;
  // Process with Claude Agent SDK...
});

// Specific text patterns
bot.hears(/^\/run (.+)/, async (ctx) => {
  const command = ctx.match[1];
  // Execute command...
});
```

### Reply with Formatting
```typescript
// Markdown
await ctx.reply("**Bold** and _italic_", { parse_mode: "Markdown" });

// HTML
await ctx.reply("<b>Bold</b> and <i>italic</i>", { parse_mode: "HTML" });

// Long messages (Telegram limit: 4096 chars)
const chunks = splitMessage(longResponse, 4000);
for (const chunk of chunks) {
  await ctx.reply(chunk);
}
```

### Inline Keyboards
```typescript
import { InlineKeyboard } from "grammy";

const keyboard = new InlineKeyboard()
  .text("Option 1", "callback_1")
  .text("Option 2", "callback_2")
  .row()
  .text("Cancel", "cancel");

await ctx.reply("Choose:", { reply_markup: keyboard });

// Handle callbacks
bot.callbackQuery("callback_1", async (ctx) => {
  await ctx.answerCallbackQuery("Selected option 1!");
  await ctx.editMessageText("You chose option 1");
});
```

---

## Error Handling

```typescript
// Global error handler
bot.catch((err) => {
  console.error("Bot error:", err);
  // err.ctx is the context that caused the error
});

// Per-handler error handling
bot.on("message", async (ctx) => {
  try {
    // Your logic
  } catch (error) {
    await ctx.reply("Sorry, an error occurred.");
    console.error(error);
  }
});
```

---

## Local Development

### Long-Polling Mode (No Webhook Needed)
```typescript
// For local development only!
import { Bot } from "grammy";

const bot = new Bot(process.env.BOT_TOKEN!);

bot.command("start", (ctx) => ctx.reply("Hello!"));

// Starts polling - blocks until stopped
bot.start();
```

### With wrangler dev
```bash
# Start local worker
npm run dev

# Use ngrok to expose locally
ngrok http 8787

# Set webhook to ngrok URL
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://abc123.ngrok.io/"
```

### Get Bot Info (for BOT_INFO var)
```bash
curl "https://api.telegram.org/bot<TOKEN>/getMe"
# Copy the "result" object into wrangler.toml
```

---

## Complete Worker Template for Claude Bot

```typescript
import { Bot, webhookCallback, Context, session, SessionFlavor } from "grammy";

// Types
interface SessionData {
  claudeSessionId: string | null;
  lastActivity: number;
}

type MyContext = Context & SessionFlavor<SessionData>;

interface Env {
  BOT_TOKEN: string;
  BOT_INFO: string;
  SESSIONS_BUCKET: R2Bucket;
  Sandbox: DurableObjectNamespace;
}

// R2 Storage Adapter
class R2Storage {
  constructor(private bucket: R2Bucket) {}

  async read(key: string): Promise<SessionData | undefined> {
    const obj = await this.bucket.get(`sessions/${key}.json`);
    return obj ? obj.json() : undefined;
  }

  async write(key: string, value: SessionData): Promise<void> {
    await this.bucket.put(`sessions/${key}.json`, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(`sessions/${key}.json`);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const bot = new Bot<MyContext>(env.BOT_TOKEN, {
      botInfo: JSON.parse(env.BOT_INFO)
    });

    // Session middleware with R2
    bot.use(session({
      initial: (): SessionData => ({
        claudeSessionId: null,
        lastActivity: Date.now()
      }),
      storage: new R2Storage(env.SESSIONS_BUCKET),
      getSessionKey: (ctx) => ctx.chat?.id.toString()
    }));

    // Commands
    bot.command("start", (ctx) => ctx.reply("Hello! Send me a message."));
    bot.command("new", async (ctx) => {
      ctx.session.claudeSessionId = null;
      await ctx.reply("Started new conversation!");
    });

    // Message handler - integrate with Claude here
    bot.on("message:text", async (ctx) => {
      const userMessage = ctx.message.text;
      const sessionId = ctx.session.claudeSessionId;

      await ctx.reply("Processing...");

      // TODO: Call Claude Agent SDK here
      // const { response, newSessionId } = await handleClaude(userMessage, sessionId);
      // ctx.session.claudeSessionId = newSessionId;
      // await ctx.reply(response);
    });

    // Error handler
    bot.catch((err) => console.error("Bot error:", err));

    return webhookCallback(bot, "cloudflare-mod")(request);
  }
};
```

---

## Key Considerations

1. **webhookCallback adapter**: Must use `"cloudflare-mod"` for Cloudflare Workers
2. **BOT_INFO required**: Workers need pre-loaded bot info (no getMe call)
3. **Secret management**: Use `wrangler secret put` for BOT_TOKEN
4. **Message limits**: Telegram max message length is 4096 characters
5. **Timeout**: Telegram expects response within 60 seconds
6. **Session persistence**: Use R2 or KV, not in-memory for Workers

---

## Quick Reference Links

- Core: https://grammy.dev/guide/
- Sessions: https://grammy.dev/plugins/session
- Cloudflare Workers: https://grammy.dev/hosting/cloudflare-workers-nodejs
- API Reference: https://doc.deno.land/https://deno.land/x/grammy/mod.ts
