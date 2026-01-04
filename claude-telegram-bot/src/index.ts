import "dotenv/config";
import { Bot, Context, session, SessionFlavor } from "grammy";
import { handleClaudeMessage, resetSandbox } from "./claude-handler.js";

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
  const chatId = ctx.chat.id;

  // Reset sandbox (destroy container)
  await resetSandbox(chatId.toString());

  // Clear local session
  ctx.session.claudeSessionId = null;
  ctx.session.messageCount = 0;

  await ctx.reply("Started a new conversation! Sandbox reset and context cleared.");
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
  await ctx.reply("Processing with Claude (sandboxed)...");

  try {
    const { response, sessionId } = await handleClaudeMessage(
      userMessage,
      ctx.session.claudeSessionId,
      chatId.toString()  // Pass chat ID for sandbox routing
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
