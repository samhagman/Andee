import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import {
  SessionData,
  createDefaultSession,
  getSessionKey,
} from "../../shared/types/session";

// Type definitions
interface Env {
  BOT_TOKEN: string;
  SESSIONS: R2Bucket;
  SANDBOX_WORKER: Fetcher;
  ALLOWED_USER_IDS?: string;  // Comma-separated Telegram user IDs
  ANDEE_API_KEY?: string;     // API key for worker authentication
}

// Helper to determine if chat is a group
function isGroupChat(chatType: string | undefined): boolean {
  return chatType === "group" || chatType === "supergroup";
}

// Session helpers using R2
async function getSession(
  env: Env,
  chatId: string,
  senderId: string,
  isGroup: boolean
): Promise<SessionData> {
  const key = getSessionKey(chatId, senderId, isGroup);
  const object = await env.SESSIONS.get(key);

  if (object) {
    return await object.json() as SessionData;
  }

  return createDefaultSession();
}

async function deleteSession(
  env: Env,
  chatId: string,
  senderId: string,
  isGroup: boolean
): Promise<void> {
  const key = getSessionKey(chatId, senderId, isGroup);
  await env.SESSIONS.delete(key);
}

interface ResetResponse {
  success: boolean;
  message: string;
  snapshotKey?: string;
}

interface SnapshotResponse {
  success: boolean;
  key?: string;
  size?: number;
  error?: string;
}

interface SnapshotsListResponse {
  chatId: string;
  count: number;
  snapshots: Array<{
    key: string;
    size: number;
    uploaded: string;
  }>;
}

async function resetSandbox(
  env: Env,
  chatId: string,
  senderId: string,
  isGroup: boolean
): Promise<ResetResponse> {
  const response = await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.ANDEE_API_KEY || ""
      },
      body: JSON.stringify({ chatId, senderId, isGroup })
    })
  );
  return response.json() as Promise<ResetResponse>;
}

async function createSnapshot(
  env: Env,
  chatId: string,
  senderId: string,
  isGroup: boolean
): Promise<SnapshotResponse> {
  const response = await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/snapshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.ANDEE_API_KEY || ""
      },
      body: JSON.stringify({ chatId, senderId, isGroup })
    })
  );
  return response.json() as Promise<SnapshotResponse>;
}

async function listSnapshots(
  env: Env,
  chatId: string,
  senderId: string,
  isGroup: boolean
): Promise<SnapshotsListResponse> {
  const response = await env.SANDBOX_WORKER.fetch(
    new Request(`https://internal/snapshots?chatId=${chatId}&senderId=${senderId}&isGroup=${isGroup}`, {
      method: "GET",
      headers: {
        "X-API-Key": env.ANDEE_API_KEY || ""
      }
    })
  );
  return response.json() as Promise<SnapshotsListResponse>;
}

// Fire-and-forget: Call sandbox worker which will handle everything including sending to Telegram
async function fireAndForgetToSandbox(
  env: Env,
  chatId: string,
  message: string,
  claudeSessionId: string | null,
  userMessageId: number,
  senderId: string,
  isGroup: boolean
): Promise<void> {
  // This call returns quickly - the sandbox worker handles the rest
  await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.ANDEE_API_KEY || ""
      },
      body: JSON.stringify({
        chatId,
        message,
        claudeSessionId,
        botToken: env.BOT_TOKEN,
        userMessageId,
        senderId,
        isGroup
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

    // Auth helper: check if user is allowed
    const isUserAllowed = (userId: number | undefined): boolean => {
      const allowedUserIds = env.ALLOWED_USER_IDS?.split(',').map(id => id.trim()).filter(Boolean) || [];
      // If no allowlist configured, allow all (for initial setup/testing)
      if (allowedUserIds.length === 0) return true;
      return userId !== undefined && allowedUserIds.includes(userId.toString());
    };

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
        "/status - Check session status\n" +
        "/snapshot - Save workspace backup\n" +
        "/snapshots - List saved backups\n" +
        "/restore - Restore from backup"
      );
    });

    // /new command
    bot.command("new", async (ctx) => {
      if (!isUserAllowed(ctx.from?.id)) {
        await ctx.reply("I'm currently in private testing mode and not available for public use.");
        return;
      }
      const chatId = ctx.chat.id.toString();
      const senderId = ctx.from?.id?.toString() || chatId;
      const isGroup = isGroupChat(ctx.chat.type);

      const result = await resetSandbox(env, chatId, senderId, isGroup);
      await deleteSession(env, chatId, senderId, isGroup);

      if (result.snapshotKey) {
        await ctx.reply(
          "🔄 Started a new conversation!\n\n" +
          "✅ Previous workspace saved as snapshot\n" +
          "Use /restore to recover it if needed."
        );
      } else {
        await ctx.reply("🔄 Started a new conversation! Sandbox reset and context cleared.");
      }
    });

    // /snapshot command - manual snapshot
    bot.command("snapshot", async (ctx) => {
      if (!isUserAllowed(ctx.from?.id)) {
        await ctx.reply("I'm currently in private testing mode and not available for public use.");
        return;
      }
      const chatId = ctx.chat.id.toString();
      const senderId = ctx.from?.id?.toString() || chatId;
      const isGroup = isGroupChat(ctx.chat.type);

      await ctx.reply("📸 Creating snapshot...");

      try {
        const result = await createSnapshot(env, chatId, senderId, isGroup);
        if (result.success && result.key) {
          const sizeKB = result.size ? Math.round(result.size / 1024) : 0;
          await ctx.reply(
            `✅ Snapshot created!\n\n` +
            `Size: ${sizeKB} KB\n` +
            `Use /snapshots to see all backups.`
          );
        } else {
          await ctx.reply(`❌ Snapshot failed: ${result.error || "No content to backup"}`);
        }
      } catch (err) {
        await ctx.reply(`❌ Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    });

    // /snapshots command - list snapshots
    bot.command("snapshots", async (ctx) => {
      if (!isUserAllowed(ctx.from?.id)) {
        await ctx.reply("I'm currently in private testing mode and not available for public use.");
        return;
      }
      const chatId = ctx.chat.id.toString();
      const senderId = ctx.from?.id?.toString() || chatId;
      const isGroup = isGroupChat(ctx.chat.type);

      try {
        const result = await listSnapshots(env, chatId, senderId, isGroup);
        if (result.count === 0) {
          await ctx.reply("📭 No snapshots found.\n\nUse /snapshot to create one.");
          return;
        }

        // Format snapshot list
        const lines = result.snapshots.slice(0, 10).map((s, i) => {
          const date = new Date(s.uploaded);
          const dateStr = date.toLocaleDateString() + " " + date.toLocaleTimeString();
          const sizeKB = Math.round(s.size / 1024);
          return `${i + 1}. ${dateStr} (${sizeKB} KB)`;
        });

        await ctx.reply(
          `📦 Snapshots (${result.count} total):\n\n` +
          lines.join("\n") +
          (result.count > 10 ? `\n\n...and ${result.count - 10} more` : "") +
          "\n\nUse /restore to restore the latest."
        );
      } catch (err) {
        await ctx.reply(`❌ Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    });

    // /restore command - restore from snapshot
    bot.command("restore", async (ctx) => {
      if (!isUserAllowed(ctx.from?.id)) {
        await ctx.reply("I'm currently in private testing mode and not available for public use.");
        return;
      }
      const chatId = ctx.chat.id.toString();
      const senderId = ctx.from?.id?.toString() || chatId;
      const isGroup = isGroupChat(ctx.chat.type);

      try {
        // First check if there are any snapshots
        const snapshots = await listSnapshots(env, chatId, senderId, isGroup);
        if (snapshots.count === 0) {
          await ctx.reply("📭 No snapshots available to restore.");
          return;
        }

        // Reset sandbox (this will destroy current state but keep snapshots)
        // The next message will trigger restore-on-startup
        await resetSandbox(env, chatId, senderId, isGroup);
        await deleteSession(env, chatId, senderId, isGroup);

        await ctx.reply(
          "🔄 Sandbox reset. The latest snapshot will be restored when you send your next message.\n\n" +
          "Send any message to continue."
        );
      } catch (err) {
        await ctx.reply(`❌ Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    });

    // /status command
    bot.command("status", async (ctx) => {
      if (!isUserAllowed(ctx.from?.id)) {
        await ctx.reply("I'm currently in private testing mode and not available for public use.");
        return;
      }
      const chatId = ctx.chat.id.toString();
      const senderId = ctx.from?.id?.toString() || chatId;
      const isGroup = isGroupChat(ctx.chat.type);

      const session = await getSession(env, chatId, senderId, isGroup);
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
      const senderIdNum = botCtx.from?.id;
      const senderId = senderIdNum?.toString() || chatId.toString();
      const isGroup = isGroupChat(botCtx.chat.type);
      const userMessage = botCtx.message.text;
      const userMessageId = botCtx.message.message_id;

      // Log user info for ID discovery
      console.log(`[AUTH] User ${botCtx.from?.username || 'unknown'} (ID: ${senderId}) in chat ${chatId} (type: ${botCtx.chat.type}, isGroup: ${isGroup})`);

      // Auth check: only allowed users can interact
      if (!isUserAllowed(senderIdNum)) {
        console.log(`[AUTH] Rejected user ${botCtx.from?.username || 'unknown'} (ID: ${senderId})`);
        await botCtx.reply("I'm currently in private testing mode and not available for public use.");
        return;
      }

      console.log(`[${chatId}] Received: ${userMessage.substring(0, 50)}...`);

      // React with eyes to show we're processing
      try {
        await botCtx.api.setMessageReaction(chatId, userMessageId, [{ type: "emoji", emoji: "👀" }]);
      } catch (err) {
        console.error(`[${chatId}] Failed to set reaction:`, err);
      }

      // Get current session for claudeSessionId
      const session = await getSession(env, chatId.toString(), senderId, isGroup);

      // Fire and forget - sandbox will handle response + session update
      // Use waitUntil to ensure the request completes even after we return
      ctx.waitUntil(
        fireAndForgetToSandbox(
          env,
          chatId.toString(),
          userMessage,
          session.claudeSessionId,
          userMessageId,
          senderId,
          isGroup
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
