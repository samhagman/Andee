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

// Snapshot configuration
const SNAPSHOT_TMP_PATH = "/tmp/snapshot.tar.gz";
const TAR_EXTRACT_TIMEOUT_MS = 60_000;

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

    // Convert to base64 for writeFile
    const arrayBuffer = await object.arrayBuffer();
    const base64Data = btoa(
      String.fromCharCode(...new Uint8Array(arrayBuffer))
    );

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
    } = body;

    // Validate required fields
    if (!chatId || !botToken) {
      return Response.json(
        { error: "Missing required fields (chatId, botToken)" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Validate: need either message OR audioBase64, not both, not neither
    if (!message && !audioBase64) {
      return Response.json(
        { error: "Must provide either message or audioBase64" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (message && audioBase64) {
      return Response.json(
        { error: "Cannot provide both message and audioBase64" },
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

    const inputType = audioBase64 ? "voice" : "text";
    console.log(`[${chatId}] Processing ${inputType} message (senderId: ${senderId}, isGroup: ${isGroup})`);

    // Get sandbox with configurable sleep timeout
    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Send typing indicator
    await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    }).catch(() => {});

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
          env: {
            ANTHROPIC_API_KEY: ctx.env.ANTHROPIC_API_KEY,
            HOME: "/home/claude",
            TZ: userTimezone,
          },
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

    // POST message to the internal server using exec + curl
    // This is the reliable way to communicate with the internal server
    const messagePayload = JSON.stringify({
      text: finalMessage,
      botToken,
      chatId,
      userMessageId,
      workerUrl,
      claudeSessionId,
      senderId,
      isGroup,
      apiKey: ctx.env.ANDEE_API_KEY,
    });

    // Escape the payload for shell
    const escapedPayload = messagePayload.replace(/'/g, "'\\''");

    const curlResult = await sandbox.exec(
      `curl -s -X POST http://localhost:${PERSISTENT_SERVER_PORT}/message -H 'Content-Type: application/json' -d '${escapedPayload}'`,
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
          message: finalMessage,
          claudeSessionId,
          botToken,
          chatId,
          userMessageId,
          workerUrl,
          senderId,
          isGroup,
          apiKey: ctx.env.ANDEE_API_KEY,
        })
      );

      await sandbox.exec(
        `ANTHROPIC_API_KEY=${ctx.env.ANTHROPIC_API_KEY} HOME=/home/claude nohup node /workspace/telegram_agent.mjs > /workspace/telegram_agent.log 2>&1 &`,
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
