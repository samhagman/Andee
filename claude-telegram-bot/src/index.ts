import { Bot, webhookCallback, InlineKeyboard, type Transformer } from "grammy";
import type { PhotoSize } from "@grammyjs/types";
import {
  SessionData,
  createDefaultSession,
  getSessionKey,
} from "../../shared/types/session";
import { ImageData, DocumentData, VideoData } from "../../shared/types/api";
import { TEST_USER_1, TEST_USER_2, TEST_GROUP_CHAT } from "../../shared/constants/testing";

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

// Test user detection for skipping Telegram API calls
const TEST_CHAT_IDS = new Set([TEST_USER_1, TEST_USER_2, TEST_GROUP_CHAT]);

function isTestChat(chatId: string | number | undefined): boolean {
  if (chatId === undefined) return false;
  return TEST_CHAT_IDS.has(chatId.toString());
}

// Mock results for Grammy API calls (must satisfy Grammy's type expectations)
function getMockResult(method: string, payload: Record<string, unknown>): unknown {
  switch (method) {
    case "sendMessage":
      return {
        message_id: Date.now(),
        chat: { id: payload.chat_id, type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: payload.text,
      };
    case "setMessageReaction":
      return true;
    default:
      return true;
  }
}

// Grammy API Transformer: Skip Telegram calls for test users
const testUserTransformer: Transformer = (prev, method, payload, signal) => {
  const chatId = (payload as Record<string, unknown>)?.chat_id as string | number | undefined;

  if (isTestChat(chatId)) {
    console.log(`[TEST] Skipping ${method} for test chat ${chatId}`);
    return Promise.resolve({
      ok: true as const,
      result: getMockResult(method, payload as Record<string, unknown>)
    });
  }

  return prev(method, payload, signal);
};

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

// Chat-level photo buffer for albums and overflow handling
// Buffers by chatId (not mediaGroupId) to catch overflow photos when Telegram splits >10 photo albums
// Key insight: Buffer starts when we see a media_group_id, but catches ANY photo in the chat within the window
interface BufferedPhoto {
  fileId: string;
  width: number;
  height: number;
  fileSize?: number;
}

interface ChatPhotoBuffer {
  photos: BufferedPhoto[];
  captions: string[];             // Collect ALL captions (could have multiple from overflow albums)
  mediaGroupIds: Set<string>;     // Track album IDs for logging
  chatId: number;
  senderId: string;
  isGroup: boolean;
  userMessageId: number;          // First message (for reaction)
  resolveFlush: (() => void) | null;  // Resolve the ctx.waitUntil promise when flush completes
}

const chatPhotoBuffer = new Map<string, ChatPhotoBuffer>();  // Keyed by chatId (string)
const PHOTO_FLUSH_DELAY_MS = 3000;  // Wait 3s after last photo before flushing

async function factoryResetSandbox(
  env: Env,
  chatId: string,
  senderId: string,
  isGroup: boolean
): Promise<ResetResponse> {
  const response = await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/factory-reset", {
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

async function restartSandbox(
  env: Env,
  chatId: string,
  senderId: string,
  isGroup: boolean
): Promise<ResetResponse> {
  const response = await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/restart", {
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

interface RestoreResponse {
  success: boolean;
  restoredFrom?: string;
  newSnapshotKey?: string;
  error?: string;
}

async function restoreSnapshot(
  env: Env,
  chatId: string,
  senderId: string,
  isGroup: boolean,
  snapshotKey: string
): Promise<RestoreResponse> {
  const response = await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/restore", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.ANDEE_API_KEY || ""
      },
      body: JSON.stringify({ chatId, senderId, isGroup, snapshotKey })
    })
  );
  return response.json() as Promise<RestoreResponse>;
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
  const response = await env.SANDBOX_WORKER.fetch(
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

  // Check for error responses - don't silently swallow errors
  if (!response.ok) {
    const body = await response.text().catch(() => "Unknown error");
    console.error(`[${chatId}] Sandbox worker error: ${response.status} - ${body}`);
    throw new Error(`Sandbox returned ${response.status}: ${body}`);
  }
}

/**
 * Download a file from Telegram's servers.
 * Returns the file data as ArrayBuffer or an error.
 */
async function downloadTelegramFile(
  botToken: string,
  fileId: string
): Promise<{ data: ArrayBuffer; error?: string }> {
  try {
    // Step 1: Get file path from Telegram
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );
    const fileResult = (await fileResponse.json()) as {
      ok: boolean;
      result?: { file_path: string };
    };

    if (!fileResult.ok || !fileResult.result?.file_path) {
      return { data: new ArrayBuffer(0), error: "Failed to get file path from Telegram" };
    }

    // Step 2: Download the file
    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileResult.result.file_path}`;
    const downloadResponse = await fetch(downloadUrl);

    if (!downloadResponse.ok) {
      return {
        data: new ArrayBuffer(0),
        error: `Download failed with status ${downloadResponse.status}`,
      };
    }

    const data = await downloadResponse.arrayBuffer();
    return { data };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { data: new ArrayBuffer(0), error: message };
  }
}

/**
 * Fire-and-forget: Send voice message to sandbox worker for transcription and processing.
 */
async function fireAndForgetVoiceToSandbox(
  env: Env,
  chatId: string,
  audioBase64: string,
  audioDurationSeconds: number,
  claudeSessionId: string | null,
  userMessageId: number,
  senderId: string,
  isGroup: boolean
): Promise<void> {
  const response = await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.ANDEE_API_KEY || "",
      },
      body: JSON.stringify({
        chatId,
        audioBase64,
        audioDurationSeconds,
        claudeSessionId,
        botToken: env.BOT_TOKEN,
        userMessageId,
        senderId,
        isGroup,
      }),
    })
  );

  // Check for error responses - don't silently swallow errors
  if (!response.ok) {
    const body = await response.text().catch(() => "Unknown error");
    console.error(`[${chatId}] Sandbox worker voice error: ${response.status} - ${body}`);
    throw new Error(`Sandbox returned ${response.status}: ${body}`);
  }
}

/**
 * Get the largest photo variant from Telegram's array of PhotoSize.
 * Telegram sends multiple sizes; we want the original (largest).
 */
function getLargestPhoto(photos: PhotoSize[]): PhotoSize {
  return photos.reduce((largest, current) =>
    (current.file_size || 0) > (largest.file_size || 0) ? current : largest
  );
}

/**
 * Detect MIME type from Telegram file path extension.
 * Defaults to image/jpeg if unknown.
 */
function getMediaType(filePath: string | undefined): string {
  if (!filePath) return "image/jpeg";
  const ext = filePath.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return types[ext || ""] || "image/jpeg";
}

/**
 * Fire-and-forget: Send photo(s) to sandbox worker for processing.
 */
async function fireAndForgetPhotosToSandbox(
  env: Env,
  chatId: string,
  images: ImageData[],
  caption: string | undefined,
  mediaGroupId: string | undefined,
  claudeSessionId: string | null,
  userMessageId: number,
  senderId: string,
  isGroup: boolean
): Promise<void> {
  const response = await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.ANDEE_API_KEY || "",
      },
      body: JSON.stringify({
        chatId,
        message: caption,
        images,
        mediaGroupId,
        claudeSessionId,
        botToken: env.BOT_TOKEN,
        userMessageId,
        senderId,
        isGroup,
      }),
    })
  );

  // Check for error responses - don't silently swallow errors
  if (!response.ok) {
    const body = await response.text().catch(() => "Unknown error");
    console.error(`[${chatId}] Sandbox worker photos error: ${response.status} - ${body}`);
    throw new Error(`Sandbox returned ${response.status}: ${body}`);
  }
}

/**
 * Fire-and-forget: Send document to sandbox worker for processing.
 */
async function fireAndForgetDocumentToSandbox(
  env: Env,
  chatId: string,
  document: DocumentData,
  caption: string | undefined,
  claudeSessionId: string | null,
  userMessageId: number,
  senderId: string,
  isGroup: boolean
): Promise<void> {
  const response = await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.ANDEE_API_KEY || "",
      },
      body: JSON.stringify({
        chatId,
        message: caption,
        document,
        claudeSessionId,
        botToken: env.BOT_TOKEN,
        userMessageId,
        senderId,
        isGroup,
      }),
    })
  );

  // Check for error responses - don't silently swallow errors
  if (!response.ok) {
    const body = await response.text().catch(() => "Unknown error");
    console.error(`[${chatId}] Sandbox worker document error: ${response.status} - ${body}`);
    throw new Error(`Sandbox returned ${response.status}: ${body}`);
  }
}

/**
 * Fire-and-forget: Send video to sandbox worker for processing.
 */
async function fireAndForgetVideoToSandbox(
  env: Env,
  chatId: string,
  video: VideoData,
  caption: string | undefined,
  claudeSessionId: string | null,
  userMessageId: number,
  senderId: string,
  isGroup: boolean
): Promise<void> {
  const response = await env.SANDBOX_WORKER.fetch(
    new Request("https://internal/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.ANDEE_API_KEY || "",
      },
      body: JSON.stringify({
        chatId,
        message: caption,
        video,
        claudeSessionId,
        botToken: env.BOT_TOKEN,
        userMessageId,
        senderId,
        isGroup,
      }),
    })
  );

  // Check for error responses - don't silently swallow errors
  if (!response.ok) {
    const body = await response.text().catch(() => "Unknown error");
    console.error(`[${chatId}] Sandbox worker video error: ${response.status} - ${body}`);
    throw new Error(`Sandbox returned ${response.status}: ${body}`);
  }
}

/**
 * Buffer a photo in the chat-level buffer.
 * Key insight: Buffer by chatId (not mediaGroupId) to catch overflow photos
 * when Telegram splits albums >10 photos into multiple messages.
 *
 * Returns true if this is the first photo (caller should use ctx.waitUntil).
 */
function bufferChatPhoto(
  chatId: string,
  photo: BufferedPhoto,
  caption: string | undefined,
  mediaGroupId: string | undefined,
  senderId: string,
  isGroup: boolean,
  userMessageId: number
): boolean {
  const existing = chatPhotoBuffer.get(chatId);

  if (existing) {
    // Add to existing buffer
    existing.photos.push(photo);
    if (caption) {
      existing.captions.push(caption);
    }
    if (mediaGroupId) {
      existing.mediaGroupIds.add(mediaGroupId);
    }
    const albumInfo = mediaGroupId ? ` (album: ${mediaGroupId})` : ' (overflow)';
    console.log(`[${chatId}] [ALBUM] Buffered photo ${existing.photos.length}${albumInfo}`);
    return false;  // Not the first photo
  } else {
    // Start new buffer (timer handled by caller via ctx.waitUntil)
    chatPhotoBuffer.set(chatId, {
      photos: [photo],
      captions: caption ? [caption] : [],
      mediaGroupIds: mediaGroupId ? new Set([mediaGroupId]) : new Set(),
      chatId: Number(chatId),
      senderId,
      isGroup,
      userMessageId,
      resolveFlush: null,
    });
    const albumInfo = mediaGroupId ? ` for album ${mediaGroupId}` : '';
    console.log(`[${chatId}] [ALBUM] Started buffer${albumInfo}`);
    return true;  // First photo - caller should start the flush timer
  }
}

/**
 * Flush the chat photo buffer: download all photos and send to worker.
 * Handles multiple albums and overflow photos as a single batch.
 */
async function flushChatPhotoBuffer(
  chatId: string,
  env: Env
): Promise<void> {
  const buffer = chatPhotoBuffer.get(chatId);
  if (!buffer) return;

  chatPhotoBuffer.delete(chatId);

  const albumIds = Array.from(buffer.mediaGroupIds).join(', ') || 'none';
  console.log(`[${chatId}] [ALBUM] Flushing ${buffer.photos.length} photos (albums: ${albumIds})`);

  // Download all photos concurrently
  const downloadResults = await Promise.allSettled(
    buffer.photos.map(async (photo) => {
      const { data, error } = await downloadTelegramFile(env.BOT_TOKEN, photo.fileId);
      if (error || data.byteLength === 0) {
        throw new Error(`Download failed for ${photo.fileId}: ${error}`);
      }

      // Get media type
      const fileResponse = await fetch(
        `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${photo.fileId}`
      );
      const fileResult = (await fileResponse.json()) as { result?: { file_path: string } };
      const mediaType = getMediaType(fileResult.result?.file_path);

      // Convert to base64
      const bytes = new Uint8Array(data);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }

      return {
        base64: btoa(binary),
        mediaType,
        fileId: photo.fileId,
        width: photo.width,
        height: photo.height,
      } as ImageData;
    })
  );

  // Filter successful downloads
  const images = downloadResults
    .filter((r): r is PromiseFulfilledResult<ImageData> => r.status === "fulfilled")
    .map(r => r.value);

  if (images.length === 0) {
    console.error(`[${chatId}] [ALBUM] All downloads failed (albums: ${albumIds})`);
    // Resolve the waitUntil promise even on failure
    if (buffer.resolveFlush) buffer.resolveFlush();
    return;
  }

  console.log(`[${chatId}] [ALBUM] Downloaded ${images.length}/${buffer.photos.length} photos`);

  // Get session and send to worker
  const session = await getSession(env, buffer.chatId.toString(), buffer.senderId, buffer.isGroup);

  // Combine all captions (from multiple albums/overflow)
  const combinedCaption = buffer.captions.filter(Boolean).join('\n') || undefined;

  // Send all images in one request (caller keeps worker alive via ctx.waitUntil)
  await fireAndForgetPhotosToSandbox(
    env,
    buffer.chatId.toString(),
    images,
    combinedCaption,
    albumIds,  // For logging - could be multiple IDs
    session.claudeSessionId,
    buffer.userMessageId,
    buffer.senderId,
    buffer.isGroup
  );

  console.log(`[${chatId}] [ALBUM] Sent ${images.length} photos to worker`);

  // Resolve the waitUntil promise
  if (buffer.resolveFlush) buffer.resolveFlush();
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

    // Skip Telegram API calls for test users
    bot.api.config.use(testUserTransformer);

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
        "/restart - Restart container (keeps conversation)\n" +
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

      const result = await factoryResetSandbox(env, chatId, senderId, isGroup);
      // Note: factoryResetSandbox already deletes the session

      if (result.snapshotKey) {
        await ctx.reply(
          "🔄 Started a new conversation!\n\n" +
          "✅ Previous workspace saved as snapshot\n" +
          "Use /restore to recover it if needed."
        );
      } else {
        await ctx.reply("🔄 Started a new conversation! Session cleared.");
      }
    });

    // /restart command - soft restart (keeps conversation)
    bot.command("restart", async (ctx) => {
      if (!isUserAllowed(ctx.from?.id)) {
        await ctx.reply("I'm currently in private testing mode and not available for public use.");
        return;
      }
      const chatId = ctx.chat.id.toString();
      const senderId = ctx.from?.id?.toString() || chatId;
      const isGroup = isGroupChat(ctx.chat.type);

      const result = await restartSandbox(env, chatId, senderId, isGroup);

      if (result.snapshotKey) {
        await ctx.reply(
          "🔄 Container restarted!\n\n" +
          "✅ Workspace saved as snapshot\n" +
          "✅ Conversation preserved\n\n" +
          "Send a message to continue."
        );
      } else {
        await ctx.reply("🔄 Container restarted. Conversation preserved.");
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

    // /restore command - restore from latest snapshot immediately
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

        // Get the latest snapshot
        const latestSnapshot = snapshots.snapshots[0];

        await ctx.reply("🔄 Restoring from snapshot...");

        // Actually restore immediately (calls POST /restore)
        const result = await restoreSnapshot(
          env, chatId, senderId, isGroup, latestSnapshot.key
        );

        if (result.success) {
          const timestamp = new Date(latestSnapshot.uploaded).toLocaleString();
          await ctx.reply(
            `✅ Restored from snapshot!\n\n` +
            `📅 Snapshot from: ${timestamp}\n` +
            `📦 Size: ${Math.round(latestSnapshot.size / 1024)} KB`
          );
        } else {
          await ctx.reply(`❌ Restore failed: ${result.error || "Unknown error"}`);
        }
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

          // Skip error message for test users
          if (isTestChat(chatId)) {
            console.log(`[TEST] Would have sent error to ${chatId}: ${err.message || "Failed to process message"}`);
            return;
          }

          // Try to send error message to real users
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

    // Handle voice messages - download, send to worker for transcription
    bot.on("message:voice", async (botCtx) => {
      const chatId = botCtx.chat.id;
      const senderIdNum = botCtx.from?.id;
      const senderId = senderIdNum?.toString() || chatId.toString();
      const isGroup = isGroupChat(botCtx.chat.type);
      const userMessageId = botCtx.message.message_id;
      const voice = botCtx.message.voice;

      // Log user info
      console.log(
        `[AUTH] User ${botCtx.from?.username || "unknown"} (ID: ${senderId}) sent voice in chat ${chatId}`
      );

      // Auth check
      if (!isUserAllowed(senderIdNum)) {
        console.log(`[AUTH] Rejected voice from user ${senderId}`);
        await botCtx.reply(
          "I'm currently in private testing mode and not available for public use."
        );
        return;
      }

      console.log(
        `[${chatId}] [VOICE] Received voice message: duration=${voice.duration}s, file_size=${voice.file_size || "?"} bytes, file_id=${voice.file_id.substring(0, 20)}...`
      );

      // React with eyes to show we're processing
      try {
        await botCtx.api.setMessageReaction(chatId, userMessageId, [
          { type: "emoji", emoji: "👀" },
        ]);
      } catch (err) {
        console.error(`[${chatId}] Failed to set reaction:`, err);
      }

      // Download the voice file
      console.log(`[${chatId}] [VOICE] Downloading voice file from Telegram...`);
      const downloadStart = Date.now();
      const { data, error: downloadError } = await downloadTelegramFile(
        env.BOT_TOKEN,
        voice.file_id
      );

      if (downloadError || data.byteLength === 0) {
        console.error(`[${chatId}] [VOICE] Download failed after ${Date.now() - downloadStart}ms: ${downloadError}`);
        await botCtx.reply(
          "Sorry, I couldn't download that voice message. Please try again."
        );
        return;
      }

      console.log(`[${chatId}] [VOICE] Download complete in ${Date.now() - downloadStart}ms: ${data.byteLength} bytes`);

      // Convert to base64
      const bytes = new Uint8Array(data);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const audioBase64 = btoa(binary);

      console.log(
        `[${chatId}] [VOICE] Encoded to base64: ${audioBase64.length} chars (~${Math.round(audioBase64.length * 0.75 / 1024)} KB)`
      );

      // Get current session
      const session = await getSession(env, chatId.toString(), senderId, isGroup);

      console.log(`[${chatId}] [VOICE] Forwarding to sandbox-worker for transcription (session: ${session.claudeSessionId || "new"})`);

      // Fire and forget - sandbox will handle transcription, Claude, and response
      ctx.waitUntil(
        fireAndForgetVoiceToSandbox(
          env,
          chatId.toString(),
          audioBase64,
          voice.duration,
          session.claudeSessionId,
          userMessageId,
          senderId,
          isGroup
        ).catch((err) => {
          console.error(`[${chatId}] Error processing voice:`, err);

          // Skip error message for test users
          if (isTestChat(chatId)) {
            console.log(
              `[TEST] Would have sent voice error to ${chatId}: ${err.message || "Unknown error"}`
            );
            return;
          }

          // Try to send error message to real users
          return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `Error processing voice: ${err.message || "Unknown error"}`,
            }),
          });
        })
      );

      // Return immediately - don't block the webhook
    });

    // Handle photo messages - download and forward to worker for Claude vision
    bot.on("message:photo", async (botCtx) => {
      const chatId = botCtx.chat.id;
      const senderIdNum = botCtx.from?.id;
      const senderId = senderIdNum?.toString() || chatId.toString();
      const isGroup = isGroupChat(botCtx.chat.type);
      const userMessageId = botCtx.message.message_id;
      const photos = botCtx.message.photo;
      const caption = botCtx.message.caption;
      const mediaGroupId = botCtx.message.media_group_id;

      // Log user info
      console.log(
        `[AUTH] User ${botCtx.from?.username || "unknown"} (ID: ${senderId}) sent photo in chat ${chatId}` +
        (mediaGroupId ? ` (album: ${mediaGroupId})` : "") +
        (caption ? ` with caption: "${caption.substring(0, 30)}..."` : "")
      );

      // Auth check
      if (!isUserAllowed(senderIdNum)) {
        console.log(`[AUTH] Rejected photo from user ${senderId}`);
        await botCtx.reply(
          "I'm currently in private testing mode and not available for public use."
        );
        return;
      }

      // Get largest photo variant (Telegram sends multiple sizes)
      const largestPhoto = getLargestPhoto(photos);

      console.log(
        `[${chatId}] [PHOTO] Received photo: ${photos.length} variants, ` +
        `largest=${largestPhoto.width}x${largestPhoto.height}, ` +
        `file_size=${largestPhoto.file_size || "?"} bytes`
      );

      // Album photo OR overflow from previous album - buffer it
      // Key insight: Buffer if mediaGroupId present OR if there's already a buffer for this chat
      // This catches overflow photos that Telegram sends separately when album exceeds 10 photos
      const chatIdStr = chatId.toString();
      const hasActiveBuffer = chatPhotoBuffer.has(chatIdStr);

      if (mediaGroupId || hasActiveBuffer) {
        // Only set reaction on the FIRST photo entering the buffer (not per-album, per-chat)
        const isFirstPhoto = !hasActiveBuffer;
        if (isFirstPhoto) {
          try {
            await botCtx.api.setMessageReaction(chatId, userMessageId, [
              { type: "emoji", emoji: "👀" },
            ]);
          } catch (err) {
            console.error(`[${chatId}] Failed to set reaction:`, err);
          }
        }

        // Buffer the photo metadata (not the actual image data)
        const wasFirstPhoto = bufferChatPhoto(
          chatIdStr,
          {
            fileId: largestPhoto.file_id,
            width: largestPhoto.width,
            height: largestPhoto.height,
            fileSize: largestPhoto.file_size,
          },
          caption,
          mediaGroupId,  // Could be undefined for overflow photos
          senderId,
          isGroup,
          userMessageId
        );

        // For the first photo, use ctx.waitUntil to keep worker alive until flush
        // This ensures the setTimeout callback actually runs
        if (wasFirstPhoto) {
          ctx.waitUntil(
            new Promise<void>((resolve) => {
              // Store resolve function so flush can complete the promise
              const buffer = chatPhotoBuffer.get(chatIdStr);
              if (buffer) {
                buffer.resolveFlush = resolve;
              }

              setTimeout(async () => {
                try {
                  await flushChatPhotoBuffer(chatIdStr, env);
                } catch (err) {
                  console.error(`[${chatId}] [ALBUM] Flush error:`, err);
                  resolve();  // Resolve even on error
                }
              }, PHOTO_FLUSH_DELAY_MS);
            })
          );
        }

        // Return immediately - flush will happen after 3s
        return;
      }

      // Single photo (no album) - process immediately
      // React with eyes to show we're processing
      try {
        await botCtx.api.setMessageReaction(chatId, userMessageId, [
          { type: "emoji", emoji: "👀" },
        ]);
      } catch (err) {
        console.error(`[${chatId}] Failed to set reaction:`, err);
      }

      // Download the photo file
      console.log(`[${chatId}] [PHOTO] Downloading photo from Telegram...`);
      const downloadStart = Date.now();
      const { data, error: downloadError } = await downloadTelegramFile(
        env.BOT_TOKEN,
        largestPhoto.file_id
      );

      if (downloadError || data.byteLength === 0) {
        console.error(`[${chatId}] [PHOTO] Download failed after ${Date.now() - downloadStart}ms: ${downloadError}`);
        await botCtx.reply(
          "Sorry, I couldn't download that photo. Please try again."
        );
        return;
      }

      console.log(`[${chatId}] [PHOTO] Download complete in ${Date.now() - downloadStart}ms: ${data.byteLength} bytes`);

      // Convert to base64
      const bytes = new Uint8Array(data);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const photoBase64 = btoa(binary);

      console.log(
        `[${chatId}] [PHOTO] Encoded to base64: ${photoBase64.length} chars (~${Math.round(photoBase64.length * 0.75 / 1024)} KB)`
      );

      // Get file path to detect media type
      const fileResponse = await fetch(
        `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${largestPhoto.file_id}`
      );
      const fileResult = (await fileResponse.json()) as { result?: { file_path: string } };
      const mediaType = getMediaType(fileResult.result?.file_path);

      // Build ImageData object
      const imageData: ImageData = {
        base64: photoBase64,
        mediaType,
        fileId: largestPhoto.file_id,
        width: largestPhoto.width,
        height: largestPhoto.height,
      };

      // Get current session
      const session = await getSession(env, chatId.toString(), senderId, isGroup);

      console.log(
        `[${chatId}] [PHOTO] Forwarding to sandbox-worker (session: ${session.claudeSessionId || "new"}, mediaType: ${mediaType})`
      );

      // Fire and forget - sandbox will handle Claude vision and response
      ctx.waitUntil(
        fireAndForgetPhotosToSandbox(
          env,
          chatId.toString(),
          [imageData],
          caption,
          undefined,  // No mediaGroupId for single photos
          session.claudeSessionId,
          userMessageId,
          senderId,
          isGroup
        ).catch((err) => {
          console.error(`[${chatId}] Error processing photo:`, err);

          // Skip error message for test users
          if (isTestChat(chatId)) {
            console.log(
              `[TEST] Would have sent photo error to ${chatId}: ${err.message || "Unknown error"}`
            );
            return;
          }

          // Try to send error message to real users
          return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `Error processing photo: ${err.message || "Unknown error"}`,
            }),
          });
        })
      );

      // Return immediately - don't block the webhook
    });

    // Handle document messages - download and forward to worker
    bot.on("message:document", async (botCtx) => {
      const chatId = botCtx.chat.id;
      const senderIdNum = botCtx.from?.id;
      const senderId = senderIdNum?.toString() || chatId.toString();
      const isGroup = isGroupChat(botCtx.chat.type);
      const userMessageId = botCtx.message.message_id;
      const doc = botCtx.message.document;
      const caption = botCtx.message.caption;

      // Log user info
      console.log(
        `[AUTH] User ${botCtx.from?.username || "unknown"} (ID: ${senderId}) ` +
        `sent document "${doc.file_name}" (${doc.mime_type}) in chat ${chatId}`
      );

      // Auth check
      if (!isUserAllowed(senderIdNum)) {
        console.log(`[AUTH] Rejected document from user ${senderId}`);
        await botCtx.reply(
          "I'm currently in private testing mode and not available for public use."
        );
        return;
      }

      console.log(
        `[${chatId}] [DOC] Received document: ${doc.file_name}, ` +
        `mime=${doc.mime_type}, size=${doc.file_size || "?"} bytes`
      );

      // React with eyes to show we're processing
      try {
        await botCtx.api.setMessageReaction(chatId, userMessageId, [
          { type: "emoji", emoji: "👀" },
        ]);
      } catch (err) {
        console.error(`[${chatId}] Failed to set reaction:`, err);
      }

      // Download the document file
      console.log(`[${chatId}] [DOC] Downloading document from Telegram...`);
      const downloadStart = Date.now();
      const { data, error: downloadError } = await downloadTelegramFile(
        env.BOT_TOKEN,
        doc.file_id
      );

      if (downloadError || data.byteLength === 0) {
        console.error(`[${chatId}] [DOC] Download failed after ${Date.now() - downloadStart}ms: ${downloadError}`);
        await botCtx.reply(
          "Sorry, I couldn't download that document. Please try again."
        );
        return;
      }

      console.log(`[${chatId}] [DOC] Download complete in ${Date.now() - downloadStart}ms: ${data.byteLength} bytes`);

      // Convert to base64
      const bytes = new Uint8Array(data);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const docBase64 = btoa(binary);

      console.log(
        `[${chatId}] [DOC] Encoded to base64: ${docBase64.length} chars (~${Math.round(docBase64.length * 0.75 / 1024)} KB)`
      );

      // Build DocumentData object
      const documentData: DocumentData = {
        base64: docBase64,
        mimeType: doc.mime_type || "application/octet-stream",
        fileName: doc.file_name || "document",
        fileId: doc.file_id,
        fileSize: doc.file_size,
      };

      // Get current session
      const session = await getSession(env, chatId.toString(), senderId, isGroup);

      console.log(
        `[${chatId}] [DOC] Forwarding "${doc.file_name}" to sandbox-worker (session: ${session.claudeSessionId || "new"})`
      );

      // Fire and forget - sandbox will handle processing and response
      ctx.waitUntil(
        fireAndForgetDocumentToSandbox(
          env,
          chatId.toString(),
          documentData,
          caption,
          session.claudeSessionId,
          userMessageId,
          senderId,
          isGroup
        ).catch((err) => {
          console.error(`[${chatId}] Error processing document:`, err);

          // Skip error message for test users
          if (isTestChat(chatId)) {
            console.log(
              `[TEST] Would have sent document error to ${chatId}: ${err.message || "Unknown error"}`
            );
            return;
          }

          // Try to send error message to real users
          return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `Error processing document: ${err.message || "Unknown error"}`,
            }),
          });
        })
      );

      // Return immediately - don't block the webhook
    });

    // Handle video messages - download and forward to worker for Gemini analysis
    bot.on("message:video", async (botCtx) => {
      const chatId = botCtx.chat.id;
      const senderIdNum = botCtx.from?.id;
      const senderId = senderIdNum?.toString() || chatId.toString();
      const isGroup = isGroupChat(botCtx.chat.type);
      const userMessageId = botCtx.message.message_id;
      const video = botCtx.message.video;
      const caption = botCtx.message.caption;

      // Log user info
      console.log(
        `[AUTH] User ${botCtx.from?.username || "unknown"} (ID: ${senderId}) ` +
        `sent video (${video.duration}s, ${video.file_size ? Math.round(video.file_size / 1024 / 1024) + "MB" : "?MB"}) in chat ${chatId}`
      );

      // Auth check
      if (!isUserAllowed(senderIdNum)) {
        console.log(`[AUTH] Rejected video from user ${senderId}`);
        await botCtx.reply(
          "I'm currently in private testing mode and not available for public use."
        );
        return;
      }

      // Size limit: 50MB for videos (Gemini API limit)
      const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
      if (video.file_size && video.file_size > MAX_VIDEO_SIZE) {
        console.log(`[${chatId}] [VIDEO] Rejected: too large (${Math.round(video.file_size / 1024 / 1024)}MB, max 50MB)`);
        await botCtx.reply("Video too large (max 50MB). Try a shorter clip!");
        return;
      }

      console.log(
        `[${chatId}] [VIDEO] Received video: ${video.duration}s, ` +
        `${video.width}x${video.height}, ${video.file_size ? Math.round(video.file_size / 1024 / 1024) + "MB" : "?MB"}`
      );

      // React with eyes to show we're processing
      try {
        await botCtx.api.setMessageReaction(chatId, userMessageId, [
          { type: "emoji", emoji: "👀" },
        ]);
      } catch (err) {
        console.error(`[${chatId}] Failed to set reaction:`, err);
      }

      // Download the video file
      console.log(`[${chatId}] [VIDEO] Downloading video from Telegram...`);
      const downloadStart = Date.now();
      const { data, error: downloadError } = await downloadTelegramFile(
        env.BOT_TOKEN,
        video.file_id
      );

      if (downloadError || data.byteLength === 0) {
        console.error(`[${chatId}] [VIDEO] Download failed after ${Date.now() - downloadStart}ms: ${downloadError}`);
        await botCtx.reply(
          "Sorry, I couldn't download that video. Please try again."
        );
        return;
      }

      console.log(`[${chatId}] [VIDEO] Download complete in ${Date.now() - downloadStart}ms: ${data.byteLength} bytes`);

      // Convert to base64
      const bytes = new Uint8Array(data);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const videoBase64 = btoa(binary);

      console.log(
        `[${chatId}] [VIDEO] Encoded to base64: ${videoBase64.length} chars (~${Math.round(videoBase64.length * 0.75 / 1024 / 1024)}MB)`
      );

      // Build VideoData object
      const videoData: VideoData = {
        base64: videoBase64,
        mediaType: video.mime_type || "video/mp4",
        fileId: video.file_id,
        duration: video.duration,
        width: video.width,
        height: video.height,
        fileSize: video.file_size,
        fileName: video.file_name,
      };

      // Get current session
      const session = await getSession(env, chatId.toString(), senderId, isGroup);

      console.log(
        `[${chatId}] [VIDEO] Forwarding to sandbox-worker (session: ${session.claudeSessionId || "new"}, mediaType: ${videoData.mediaType})`
      );

      // Fire and forget - sandbox will handle Gemini analysis and response
      ctx.waitUntil(
        fireAndForgetVideoToSandbox(
          env,
          chatId.toString(),
          videoData,
          caption,
          session.claudeSessionId,
          userMessageId,
          senderId,
          isGroup
        ).catch((err) => {
          console.error(`[${chatId}] Error processing video:`, err);

          // Skip error message for test users
          if (isTestChat(chatId)) {
            console.log(
              `[TEST] Would have sent video error to ${chatId}: ${err.message || "Unknown error"}`
            );
            return;
          }

          // Try to send error message to real users
          return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `Error processing video: ${err.message || "Unknown error"}`,
            }),
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
