import "dotenv/config";
import { Bot, Context, session, SessionFlavor } from "grammy";
import { handleClaudeMessageStreaming, resetSandbox } from "./claude-handler.js";

// Session type
interface SessionData {
  claudeSessionId: string | null;
  messageCount: number;
}

type MyContext = Context & SessionFlavor<SessionData>;

// Telegram limits and streaming config
const TG_LIMIT = 4096;
const TAIL_CHARS = 3;        // Keep last 3 chars visible when splitting
const ELLIPSIS = "...";      // Inserted before the tail
const THROTTLE_MS = 500;     // Edit at most ~2x/sec
const TYPING_EVERY_MS = 4000; // sendChatAction lasts ~5s

// Helper: sleep
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Split text into a displayChunk that fits TG_LIMIT with "..." before last 3 chars,
 * and carry (the hidden chars + remainder) for the next message.
 */
function splitWithEllipsisTail(text: string): { displayChunk: string; carry: string } {
  const first = text.slice(0, TG_LIMIT);
  const remainder = text.slice(TG_LIMIT);

  const prefixLen = TG_LIMIT - (ELLIPSIS.length + TAIL_CHARS); // e.g. 4096 - 6 = 4090
  const prefix = first.slice(0, prefixLen);
  const hidden = first.slice(prefixLen, TG_LIMIT - TAIL_CHARS); // 3 chars hidden
  const tail = first.slice(TG_LIMIT - TAIL_CHARS);              // last 3 chars

  const displayChunk = prefix + ELLIPSIS + tail; // total length == TG_LIMIT
  const carry = hidden + remainder;               // continue with hidden + rest

  return { displayChunk, carry };
}

/**
 * Edit message with retry on rate limit (429 errors)
 */
async function editWithRetry(
  api: Context["api"],
  chatId: number,
  messageId: number,
  text: string,
  tries = 3
): Promise<boolean> {
  const safeText = text.length ? text : "…";
  try {
    await api.editMessageText(chatId, messageId, safeText, {
      link_preview_options: { is_disabled: true },
    });
    return true;
  } catch (err: unknown) {
    // Check for rate limit (429)
    const error = err as { parameters?: { retry_after?: number } };
    const retryAfter = error?.parameters?.retry_after;
    if (tries > 0 && typeof retryAfter === "number") {
      await sleep((retryAfter + 0.2) * 1000);
      return editWithRetry(api, chatId, messageId, text, tries - 1);
    }
    // Ignore "message is not modified" errors
    return false;
  }
}

/**
 * Send new message with retry on rate limit
 */
async function sendWithRetry(
  api: Context["api"],
  chatId: number,
  text: string,
  tries = 3
): Promise<number> {
  const safeText = text.length ? text : "…";
  try {
    const msg = await api.sendMessage(chatId, safeText, {
      link_preview_options: { is_disabled: true },
    });
    return msg.message_id;
  } catch (err: unknown) {
    const error = err as { parameters?: { retry_after?: number } };
    const retryAfter = error?.parameters?.retry_after;
    if (tries > 0 && typeof retryAfter === "number") {
      await sleep((retryAfter + 0.2) * 1000);
      return sendWithRetry(api, chatId, text, tries - 1);
    }
    throw err;
  }
}

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

// Handle text messages - with streaming updates
bot.on("message:text", async (ctx) => {
  const userMessage = ctx.message.text;
  const chatId = ctx.chat.id;

  console.log(`[${chatId}] Received: ${userMessage.substring(0, 50)}...`);

  // Send initial placeholder message
  const statusMsg = await ctx.reply("…");
  let currentMessageId = statusMsg.message_id;

  // Keep typing indicator alive while streaming
  const typingTimer = setInterval(() => {
    ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  }, TYPING_EVERY_MS);

  // Streaming state
  let displayedText = "";          // What's currently shown in the current message
  let lastFlushAt = 0;
  let consumedChars = 0;           // How many chars have been "finalized" in previous messages
  const sentMessages: number[] = [currentMessageId]; // Track all message IDs we've sent

  try {
    const { response, sessionId } = await handleClaudeMessageStreaming(
      userMessage,
      ctx.session.claudeSessionId,
      chatId.toString(),
      async (fullText) => {
        // Throttle updates
        const now = Date.now();
        if (now - lastFlushAt < THROTTLE_MS) return;
        lastFlushAt = now;

        // Calculate what text belongs to the current message
        // consumedChars tracks how much has been finalized in previous messages
        // Each finalized message consumed (TG_LIMIT - ELLIPSIS.length) chars of original text
        // because we replace 3 chars with "..." + those 3 chars go to next message

        let buffer = fullText.slice(consumedChars);

        // Process any overflows - roll over into new messages
        while (buffer.length > TG_LIMIT) {
          const { displayChunk, carry } = splitWithEllipsisTail(buffer);

          // Finalize current message with "...XYZ"
          await editWithRetry(ctx.api, chatId, currentMessageId, displayChunk);

          // Track how much of original text we consumed (the prefix part)
          // displayChunk has TG_LIMIT chars, but ELLIPSIS replaced 3 chars that go to carry
          const charsConsumed = TG_LIMIT - ELLIPSIS.length; // 4093 chars consumed per message
          consumedChars += charsConsumed;

          // Start a new message for the continuation
          currentMessageId = await sendWithRetry(ctx.api, chatId, "…");
          sentMessages.push(currentMessageId);

          buffer = carry;
          await sleep(50); // Tiny pause to reduce burstiness
        }

        // Normal streaming update - only edit if text changed
        if (buffer !== displayedText) {
          await editWithRetry(ctx.api, chatId, currentMessageId, buffer);
          displayedText = buffer;
        }
      }
    );

    // Final update with complete response
    // Account for already-consumed chars from streaming overflow handling
    let finalBuffer = response.slice(consumedChars);

    while (finalBuffer.length > TG_LIMIT) {
      const { displayChunk, carry } = splitWithEllipsisTail(finalBuffer);
      await editWithRetry(ctx.api, chatId, currentMessageId, displayChunk);
      currentMessageId = await sendWithRetry(ctx.api, chatId, "…");
      sentMessages.push(currentMessageId);
      finalBuffer = carry;
    }

    // Final edit
    if (finalBuffer.length > 0) {
      await editWithRetry(ctx.api, chatId, currentMessageId, finalBuffer);
    }

    // Update session
    ctx.session.claudeSessionId = sessionId;
    ctx.session.messageCount++;

    console.log(`[${chatId}] Responded successfully (${sentMessages.length} message(s))`);
  } catch (error) {
    console.error(`[${chatId}] Error:`, error);
    const errorMsg = "Sorry, an error occurred while processing your message.\n" +
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
    await editWithRetry(ctx.api, chatId, currentMessageId, errorMsg);
  } finally {
    clearInterval(typingTimer);
  }
});

// Error handler
bot.catch((err) => {
  console.error("Bot error:", err.error);
});

// Start bot
console.log("Starting Claude Telegram Bot...");
console.log(`Workspace: ${process.env.CLAUDE_WORKSPACE}`);
bot.start();
console.log("Bot is running! Send a message to your bot on Telegram.");
