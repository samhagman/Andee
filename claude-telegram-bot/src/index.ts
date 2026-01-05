import { Bot, webhookCallback, InlineKeyboard } from "grammy";

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

// Session helpers using R2
async function getSession(env: Env, chatId: string): Promise<SessionData> {
  const key = `sessions/${chatId}.json`;
  const object = await env.SESSIONS.get(key);

  if (object) {
    return await object.json() as SessionData;
  }

  return {
    claudeSessionId: null,
    messageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function deleteSession(env: Env, chatId: string): Promise<void> {
  const key = `sessions/${chatId}.json`;
  await env.SESSIONS.delete(key);
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

// Fire-and-forget: Call sandbox worker which will handle everything including sending to Telegram
async function fireAndForgetToSandbox(
  env: Env,
  chatId: string,
  message: string,
  claudeSessionId: string | null,
  userMessageId: number
): Promise<void> {
  // This call returns quickly - the sandbox worker handles the rest
  await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/ask-telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        message,
        claudeSessionId,
        botToken: env.BOT_TOKEN,
        userMessageId
      })
    })
  );
}

// Export Worker
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Health check (GET only)
    if (request.method === "GET" && new URL(request.url).pathname === "/") {
      return new Response(JSON.stringify({
        status: "ok",
        service: "claude-telegram-bot"
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Create bot for webhook handling
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
      await resetSandbox(env, chatId);
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

    // Handle text messages - fire and forget to sandbox
    bot.on("message:text", async (botCtx) => {
      const chatId = botCtx.chat.id;
      const userMessage = botCtx.message.text;
      const userMessageId = botCtx.message.message_id;

      console.log(`[${chatId}] Received: ${userMessage.substring(0, 50)}...`);

      // React with eyes to show we're processing
      try {
        await botCtx.api.setMessageReaction(chatId, userMessageId, [{ type: "emoji", emoji: "👀" }]);
      } catch (err) {
        console.error(`[${chatId}] Failed to set reaction:`, err);
      }

      // Get current session for claudeSessionId
      const session = await getSession(env, chatId.toString());

      // Fire and forget - sandbox will handle response + session update
      // Use waitUntil to ensure the request completes even after we return
      ctx.waitUntil(
        fireAndForgetToSandbox(
          env,
          chatId.toString(),
          userMessage,
          session.claudeSessionId,
          userMessageId
        ).catch(err => {
          console.error(`[${chatId}] Error calling sandbox:`, err);
          // Try to send error message
          return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `Error: ${err.message || "Failed to process message"}`
            })
          });
        })
      );

      // Return immediately - don't block the webhook
    });

    // Handle webhook
    const handler = webhookCallback(bot, "cloudflare-mod");
    return handler(request);
  }
};
