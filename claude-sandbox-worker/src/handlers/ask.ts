/**
 * Ask endpoint: POST /ask
 * Fire-and-forget endpoint using persistent server.
 * Falls back to spawning agent process if needed.
 * Restores from snapshot if container is fresh.
 */

import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import {
  CORS_HEADERS,
  HandlerContext,
  AskTelegramRequest,
  Env,
  getSnapshotPrefix,
} from "../types";
import {
  SANDBOX_SLEEP_AFTER,
  PERSISTENT_SERVER_PORT,
  QUICK_COMMAND_TIMEOUT_MS,
  CURL_TIMEOUT_MS,
  SERVER_STARTUP_TIMEOUT_MS,
} from "../../../shared/config";
import { PERSISTENT_SERVER_SCRIPT, AGENT_TELEGRAM_SCRIPT } from "../scripts";
import {
  mountMediaBucket,
  saveAllMedia,
  type MediaStorageResult,
} from "../lib/media";
import type { VideoData } from "../../../shared/types/api";

/**
 * Build media context instruction for VIDEO ONLY.
 * Claude has native vision for images, but cannot process video natively.
 * This instructs Claude to use the analyze-video skill for video analysis.
 */
function buildVideoContextInstruction(
  mediaPaths: { path: string; type: string }[]
): string {
  // Filter to only video types
  const videoMedia = mediaPaths.filter((m) => m.type === "video");

  if (videoMedia.length === 0) return "";

  const mediaList = videoMedia
    .map((m) => `  - [video] path=${m.path}`)
    .join("\n");

  return `<media-context hidden="true">
This message includes video that requires analysis to respond properly.
Note: You cannot view videos directly - use the analyze-video skill.

Video attached:
${mediaList}

To analyze this video, use the analyze-video skill:
  bun /home/claude/.claude/skills/analyze-video/scripts/analyze-video.ts "<path>" "<your question>"

Run the script with an appropriate question based on what the user is asking.
</media-context>

`;
}

// Snapshot configuration
const SNAPSHOT_TMP_PATH = "/tmp/snapshot.tar.gz";
const TAR_EXTRACT_TIMEOUT_MS = 60_000;

/**
 * Build environment variables for Claude SDK based on provider toggle.
 * When USE_OPENROUTER=true, routes to OpenRouter with specified model.
 * Otherwise, uses Anthropic directly.
 */
function buildSdkEnv(env: Env, userTimezone: string): Record<string, string> {
  const baseEnv: Record<string, string> = {
    HOME: "/home/claude",
    TZ: userTimezone,
    // Always include OPENROUTER_API_KEY for analyze-video skill (Gemini via OpenRouter)
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY || "",
  };

  if (env.USE_OPENROUTER === "true") {
    // OpenRouter mode - route SDK through openrouter.ai
    console.log(`[Worker] Using OpenRouter with model: ${env.OPENROUTER_MODEL || "z-ai/glm-4.7"}`);
    return {
      ...baseEnv,
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: env.OPENROUTER_API_KEY || "",
      ANTHROPIC_API_KEY: "", // Must be blank for OpenRouter
      ANTHROPIC_DEFAULT_SONNET_MODEL: env.OPENROUTER_MODEL || "z-ai/glm-4.7",
    };
  } else {
    // Anthropic direct mode (default)
    return {
      ...baseEnv,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    };
  }
}

/**
 * Restore filesystem from the latest snapshot if one exists.
 * Returns true if restored, false otherwise.
 */
async function restoreFromSnapshot(
  sandbox: InstanceType<typeof Sandbox>,
  chatId: string,
  senderId: string | undefined,
  isGroup: boolean | undefined,
  env: Env
): Promise<boolean> {
  if (!env.SNAPSHOTS) {
    console.log(`[Worker] SNAPSHOTS binding not available, skipping restore`);
    return false;
  }

  try {
    // List snapshots for this chat using new prefix structure
    const prefix = getSnapshotPrefix(chatId, senderId, isGroup);
    const listResult = await env.SNAPSHOTS.list({ prefix });

    if (listResult.objects.length === 0) {
      console.log(`[Worker] No snapshots found for chat ${chatId}`);
      return false;
    }

    // Get latest snapshot (sorted by key which includes timestamp)
    const latestKey = listResult.objects
      .sort((a, b) => b.key.localeCompare(a.key))[0].key;

    console.log(`[Worker] Restoring from snapshot: ${latestKey}`);

    // Download snapshot from R2
    const object = await env.SNAPSHOTS.get(latestKey);
    if (!object) {
      console.log(`[Worker] Snapshot not found in R2: ${latestKey}`);
      return false;
    }

    // Convert to base64 using chunked approach to avoid stack overflow on large snapshots
    // The spread operator (...new Uint8Array(arrayBuffer)) causes "Maximum call stack size exceeded"
    // on files larger than ~500KB-1MB due to JavaScript's argument limit (~65K-130K)
    const arrayBuffer = await object.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const CHUNK_SIZE = 32768; // 32KB chunks
    let binaryString = '';
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
      binaryString += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const base64Data = btoa(binaryString);

    // Write snapshot to container
    await sandbox.writeFile(SNAPSHOT_TMP_PATH, base64Data, {
      encoding: "base64",
    });

    // Extract snapshot
    const extractResult = await sandbox.exec(
      `cd / && tar -xzf ${SNAPSHOT_TMP_PATH}`,
      { timeout: TAR_EXTRACT_TIMEOUT_MS }
    );

    if (extractResult.exitCode !== 0) {
      console.error(`[Worker] Snapshot extract failed: ${extractResult.stderr}`);
      return false;
    }

    // Clean up temp file
    await sandbox.exec(`rm -f ${SNAPSHOT_TMP_PATH}`, { timeout: 5000 });

    console.log(`[Worker] Snapshot restored successfully for chat ${chatId}`);
    return true;
  } catch (error) {
    console.error(`[Worker] Restore error:`, error);
    return false;
  }
}

/**
 * Transcribe audio using Cloudflare Workers AI (Whisper).
 * Returns the transcribed text or an error.
 */
async function transcribeAudio(
  ai: Ai,
  audioBase64: string,
  chatId: string
): Promise<{ text: string; error?: string }> {
  const startTime = Date.now();
  console.log(`[${chatId}] [VOICE] Starting transcription, audio size: ${audioBase64.length} base64 chars (~${Math.round(audioBase64.length * 0.75 / 1024)} KB)`);

  try {
    // Workers AI Whisper expects audio as base64 string directly
    const result = await ai.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioBase64,
    });

    const elapsed = Date.now() - startTime;
    console.log(`[${chatId}] [VOICE] Whisper API returned in ${elapsed}ms, result keys: ${Object.keys(result || {}).join(", ")}`);

    // Handle response - Whisper returns { text: string } or { vtt: string }
    const transcribedText = (result as { text?: string }).text;

    if (!transcribedText || transcribedText.trim() === "") {
      console.log(`[${chatId}] [VOICE] Transcription returned empty text, full result: ${JSON.stringify(result)}`);
      return { text: "", error: "Transcription returned empty text" };
    }

    console.log(`[${chatId}] [VOICE] Transcription successful: "${transcribedText.substring(0, 100)}${transcribedText.length > 100 ? "..." : ""}"`);
    return { text: transcribedText.trim() };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${chatId}] [VOICE] Transcription failed after ${elapsed}ms: ${message}`);
    if (error instanceof Error && error.stack) {
      console.error(`[${chatId}] [VOICE] Stack trace: ${error.stack}`);
    }
    return { text: "", error: message };
  }
}

export async function handleAsk(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as AskTelegramRequest;
    const {
      chatId,
      message,
      claudeSessionId,
      botToken,
      userMessageId,
      senderId,
      isGroup,
      audioBase64,
      audioDurationSeconds,
      images,
      mediaGroupId,
      document,
      video,
    } = body;

    // Validate required fields
    if (!chatId || !botToken) {
      return Response.json(
        { error: "Missing required fields (chatId, botToken)" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Validate: need at least one input type
    const hasText = Boolean(message);
    const hasAudio = Boolean(audioBase64);
    const hasImages = images && images.length > 0;
    const hasDocument = Boolean(document);
    const hasVideo = Boolean(video);

    if (!hasText && !hasAudio && !hasImages && !hasDocument && !hasVideo) {
      return Response.json(
        { error: "Must provide message, audioBase64, images, document, or video" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Cannot combine text with audio (voice messages are transcribed to text)
    if (hasText && hasAudio) {
      return Response.json(
        { error: "Cannot provide both message and audioBase64" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Cannot combine audio with images (voice notes with photos doesn't make sense)
    if (hasAudio && hasImages) {
      return Response.json(
        { error: "Cannot combine audio and images" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Cannot combine audio with video
    if (hasAudio && hasVideo) {
      return Response.json(
        { error: "Cannot combine audio and video" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Handle voice message transcription
    let finalMessage = message;
    if (audioBase64) {
      console.log(
        `[${chatId}] [VOICE] Received voice message: duration=${audioDurationSeconds || "?"}s, base64_length=${audioBase64.length}`
      );

      const { text, error } = await transcribeAudio(ctx.env.AI, audioBase64, chatId);

      if (error || !text) {
        console.error(`[${chatId}] [VOICE] Transcription failed, sending error to user: ${error}`);
        // Send error to Telegram and return
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `Sorry, I couldn't understand that voice message. ${error || "Please try again."}`,
            reply_to_message_id: userMessageId,
          }),
        }).catch(() => {});

        return Response.json(
          { error: "Transcription failed", details: error },
          { status: 422, headers: CORS_HEADERS }
        );
      }

      finalMessage = text;
      console.log(
        `[${chatId}] [VOICE] Transcription complete, passing to Claude: "${text.substring(0, 80)}${text.length > 80 ? "..." : ""}"`
      );
    }

    const inputType = audioBase64 ? "voice" : hasVideo ? "video" : hasImages ? "photo" : hasDocument ? "document" : "text";
    const imageInfo = hasImages ? ` (${images!.length} image(s)${mediaGroupId ? `, album: ${mediaGroupId}` : ""})` : "";
    const docInfo = hasDocument ? ` (${document!.fileName})` : "";
    const videoInfo = hasVideo ? ` (${video!.duration || "?"}s, ${video!.fileSize ? Math.round(video!.fileSize / 1024 / 1024) + "MB" : "?MB"})` : "";
    console.log(`[${chatId}] Processing ${inputType} message${imageInfo}${docInfo}${videoInfo} (senderId: ${senderId}, isGroup: ${isGroup})`);

    // Get sandbox with configurable sleep timeout
    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Mount R2 media bucket (or fallback to /tmp/media for local dev)
    let isLocalDev = false;
    let mediaPaths: MediaStorageResult[] = [];
    try {
      const mounted = await mountMediaBucket(sandbox, ctx.env);
      isLocalDev = !mounted;
    } catch (err) {
      console.warn(`[${chatId}] Media mount failed, using local fallback:`, err);
      isLocalDev = true;
    }

    // Save incoming media to storage (photos, voice, documents, video)
    const hasMedia = hasImages || audioBase64 || hasDocument || hasVideo;
    if (hasMedia && senderId) {
      try {
        mediaPaths = await saveAllMedia(sandbox, chatId, senderId, isLocalDev, {
          images,
          audioBase64,
          document,
          video,
        });
        console.log(`[${chatId}] Saved ${mediaPaths.length} media file(s) to ${isLocalDev ? "/tmp/media" : "/media"}`);
      } catch (err) {
        console.error(`[${chatId}] Media save failed (continuing without):`, err);
        // Continue anyway - media storage is an enhancement, not required
      }
    }

    // Send typing indicator
    await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    }).catch(() => {});

    // ===============================================================
    // CLAUDE SDK EXECUTION PATH
    // Uses persistent server with Claude Agent SDK
    // Claude has native vision for images; videos use analyze-video skill
    // ===============================================================
    console.log(`[${chatId}] Processing with Claude SDK`);

    // Service bindings use "internal" hostname which isn't resolvable from containers
    // Use production URL when hostname is "internal", otherwise derive from request
    const PRODUCTION_WORKER_URL = "https://claude-sandbox-worker.samuel-hagman.workers.dev";
    const requestUrl = new URL(ctx.request.url);
    const workerUrl = requestUrl.host === "internal"
      ? PRODUCTION_WORKER_URL
      : `${requestUrl.protocol}//${requestUrl.host}`;

    // Check if persistent server is running
    const processes = await sandbox.listProcesses();
    const serverProcess = processes.find((p) =>
      p.command?.includes("persistent_server.mjs")
    );

    if (!serverProcess) {
      console.log(`[Worker] Starting persistent server for chat ${chatId}`);

      // Restore from snapshot if available (fresh container)
      const restored = await restoreFromSnapshot(sandbox, chatId, senderId, isGroup, ctx.env);
      if (restored) {
        console.log(`[Worker] Filesystem restored from snapshot for chat ${chatId}`);
      }

      // Read user timezone from preferences (if they exist)
      let userTimezone = "UTC";
      if (senderId) {
        const prefsPath = `/home/claude/private/${senderId}/preferences.yaml`;
        const prefsResult = await sandbox.exec(
          `cat ${prefsPath} 2>/dev/null || echo ""`,
          { timeout: QUICK_COMMAND_TIMEOUT_MS }
        );

        if (prefsResult.stdout.includes("timezone:")) {
          const match = prefsResult.stdout.match(/timezone:\s*([^\n]+)/);
          if (match) {
            userTimezone = match[1].trim();
            console.log(`[Worker] User ${senderId} timezone: ${userTimezone}`);
          }
        }
      }

      // Write the persistent server script
      await sandbox.writeFile(
        "/workspace/persistent_server.mjs",
        PERSISTENT_SERVER_SCRIPT
      );

      // Ensure workspace/files directory exists
      await sandbox.exec("mkdir -p /workspace/files", {
        timeout: QUICK_COMMAND_TIMEOUT_MS,
      });

      // Start the persistent server with proper environment variables
      const server = await sandbox.startProcess(
        "node /workspace/persistent_server.mjs",
        {
          env: buildSdkEnv(ctx.env, userTimezone),
        }
      );

      // Wait for server to be ready on configured port (3000 is used by Sandbox infrastructure)
      console.log(`[Worker] Waiting for server to be ready...`);
      await server.waitForPort(PERSISTENT_SERVER_PORT, {
        path: "/health",
        timeout: SERVER_STARTUP_TIMEOUT_MS,
        status: { min: 200, max: 299 },
      });

      console.log(`[Worker] Persistent server ready for chat ${chatId}`);
    } else {
      console.log(
        `[Worker] Persistent server already running for chat ${chatId}`
      );
    }

    // Build media context for VIDEO only (Claude has native vision for images)
    // Video requires the analyze-video skill since Claude can't process video natively
    const needsVideoContext = mediaPaths.length > 0 && hasVideo;
    const videoContextPrefix = needsVideoContext
      ? buildVideoContextInstruction(mediaPaths)
      : "";

    // Prepend video context to user's message (only for video)
    // For images, Claude sees them directly via vision API - no context injection needed
    const messageWithContext = videoContextPrefix + (finalMessage || (hasImages ? "What's in this image?" : "Describe what you see in the attached media."));

    // POST message to the internal server using exec + curl
    // Write to file first to avoid shell argument length limits (important for albums with many images)
    const messagePayload = JSON.stringify({
      text: messageWithContext,
      botToken,
      chatId,
      userMessageId,
      workerUrl,
      claudeSessionId,
      senderId,
      isGroup,
      apiKey: ctx.env.ANDEE_API_KEY,
      images,
      mediaGroupId,
      document,
      video,
      // Media paths for artifact integration (stored in /media or /tmp/media)
      mediaPaths: mediaPaths.map((m) => ({
        path: m.path,
        type: m.type,
        originalName: m.originalName,
      })),
    });

    // Write payload to temp file (avoids "Argument list too long" for large payloads)
    await sandbox.writeFile("/tmp/message.json", messagePayload);

    const curlResult = await sandbox.exec(
      `curl -s -X POST http://localhost:${PERSISTENT_SERVER_PORT}/message -H 'Content-Type: application/json' -d @/tmp/message.json`,
      { timeout: CURL_TIMEOUT_MS }
    );

    if (curlResult.exitCode !== 0) {
      console.error(`[Worker] Failed to post message: ${curlResult.stderr}`);
      // Fall back to legacy agent approach
      console.log(`[Worker] Falling back to legacy agent for chat ${chatId}`);

      await sandbox.writeFile(
        "/workspace/telegram_agent.mjs",
        AGENT_TELEGRAM_SCRIPT
      );
      await sandbox.writeFile(
        "/workspace/input.json",
        JSON.stringify({
          message: messageWithContext,
          claudeSessionId,
          botToken,
          chatId,
          userMessageId,
          workerUrl,
          senderId,
          isGroup,
          apiKey: ctx.env.ANDEE_API_KEY,
          images,
          mediaGroupId,
          document,
          video,
          mediaPaths: mediaPaths.map((m) => ({
            path: m.path,
            type: m.type,
            originalName: m.originalName,
          })),
        })
      );

      // Build env vars string for legacy fallback (uses inline shell vars)
      const sdkEnv = buildSdkEnv(ctx.env, "UTC");
      const envVarsString = Object.entries(sdkEnv)
        .map(([k, v]) => `${k}=${v ? `'${v}'` : "''"}`)
        .join(" ");

      await sandbox.exec(
        `${envVarsString} nohup node /workspace/telegram_agent.mjs > /workspace/telegram_agent.log 2>&1 &`,
        { timeout: QUICK_COMMAND_TIMEOUT_MS }
      );
    } else {
      console.log(`[Worker] Message queued: ${curlResult.stdout}`);
    }

    return Response.json({ started: true, chatId }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Worker] Telegram endpoint error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
