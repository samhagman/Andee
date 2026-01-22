/**
 * Scheduled task endpoint: POST /scheduled-task
 * Called by RecurringSchedulesDO when a schedule alarm fires.
 * Similar to /ask but specifically for automated scheduled prompts.
 */

import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import {
  CORS_HEADERS,
  HandlerContext,
  Env,
  ScheduledTaskRequest,
  getSnapshotPrefix,
} from "../types";
import {
  SANDBOX_SLEEP_AFTER,
  PERSISTENT_SERVER_PORT,
  QUICK_COMMAND_TIMEOUT_MS,
  CURL_TIMEOUT_MS,
  SERVER_STARTUP_TIMEOUT_MS,
  SNAPSHOT_TMP_PATH,
  TAR_TIMEOUT_MS,
  buildRestoreExcludeFlags,
} from "../../../shared/config";
import { PERSISTENT_SERVER_SCRIPT } from "../scripts";
import { mountMediaBucket } from "../lib/media";


/**
 * Build environment variables for Claude SDK.
 */
function buildSdkEnv(env: Env, userTimezone: string): Record<string, string> {
  const baseEnv: Record<string, string> = {
    HOME: "/home/claude",
    TZ: userTimezone,
  };

  if (env.USE_OPENROUTER === "true") {
    return {
      ...baseEnv,
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: env.OPENROUTER_API_KEY || "",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_DEFAULT_SONNET_MODEL: env.OPENROUTER_MODEL || "z-ai/glm-4.7",
    };
  } else {
    return {
      ...baseEnv,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    };
  }
}

/**
 * Restore filesystem from the latest snapshot if one exists.
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
    const prefix = getSnapshotPrefix(chatId, senderId, isGroup);
    const listResult = await env.SNAPSHOTS.list({ prefix });

    if (listResult.objects.length === 0) {
      console.log(`[Worker] No snapshots found for chat ${chatId}`);
      return false;
    }

    const latestKey = listResult.objects
      .sort((a, b) => b.key.localeCompare(a.key))[0].key;

    console.log(`[Worker] Restoring from snapshot: ${latestKey}`);

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

    await sandbox.writeFile(SNAPSHOT_TMP_PATH, base64Data, {
      encoding: "base64",
    });

    // Extract snapshot (excluding system files that come from Dockerfile)
    const restoreExcludes = buildRestoreExcludeFlags();
    const extractResult = await sandbox.exec(
      `cd / && tar -xzf ${SNAPSHOT_TMP_PATH} ${restoreExcludes}`,
      { timeout: TAR_TIMEOUT_MS }
    );

    if (extractResult.exitCode !== 0) {
      console.error(`[Worker] Snapshot extract failed: ${extractResult.stderr}`);
      return false;
    }

    await sandbox.exec(`rm -f ${SNAPSHOT_TMP_PATH}`, { timeout: 5000 });

    console.log(`[Worker] Snapshot restored successfully for chat ${chatId}`);
    return true;
  } catch (error) {
    console.error(`[Worker] Restore error:`, error);
    return false;
  }
}

/**
 * Handle a scheduled task execution.
 * Called by RecurringSchedulesDO when alarm fires.
 */
export async function handleScheduledTask(
  ctx: HandlerContext
): Promise<Response> {
  try {
    // Allow internal scheduled task calls (from DO) - check header
    const isInternalCall = ctx.request.headers.get("X-Scheduled-Task") === "true";

    // If not internal, require API key
    if (!isInternalCall && ctx.env.ANDEE_API_KEY) {
      const providedKey = ctx.request.headers.get("X-API-Key");
      if (providedKey !== ctx.env.ANDEE_API_KEY) {
        return Response.json(
          { error: "Unauthorized" },
          { status: 401, headers: CORS_HEADERS }
        );
      }
    }

    const body = (await ctx.request.json()) as ScheduledTaskRequest;
    const { chatId, senderId, isGroup, scheduleId, prompt, botToken } = body;

    // Validate required fields
    if (!chatId || !scheduleId || !prompt || !botToken) {
      return Response.json(
        { error: "Missing required fields: chatId, scheduleId, prompt, botToken" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log(
      `[${chatId}] [SCHEDULED] Executing schedule: ${scheduleId}`
    );

    // Get sandbox
    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Mount media bucket
    try {
      await mountMediaBucket(sandbox, ctx.env);
    } catch (err) {
      console.warn(`[${chatId}] Media mount failed:`, err);
    }

    // Check if persistent server is running
    const processes = await sandbox.listProcesses();
    const serverProcess = processes.find((p) =>
      p.command?.includes("persistent_server.mjs")
    );

    const PRODUCTION_WORKER_URL = "https://claude-sandbox-worker.samuel-hagman.workers.dev";
    const requestUrl = new URL(ctx.request.url);
    const workerUrl = requestUrl.host === "internal"
      ? PRODUCTION_WORKER_URL
      : `${requestUrl.protocol}//${requestUrl.host}`;

    if (!serverProcess) {
      console.log(`[Worker] [SCHEDULED] Starting persistent server for chat ${chatId}`);

      // Restore from snapshot
      // senderId "system" is a first-class sender, handled by getSnapshotPrefix
      const restored = await restoreFromSnapshot(sandbox, chatId, senderId, isGroup, ctx.env);
      if (restored) {
        console.log(`[Worker] [SCHEDULED] Filesystem restored for chat ${chatId}`);
      }

      // Read chat's default timezone from first user's preferences or use UTC
      let chatTimezone = "UTC";
      // For scheduled tasks, try to read timezone from schedule config in R2
      try {
        const configKey = `schedules/${chatId}/recurring.yaml`;
        const configObj = await ctx.env.SESSIONS.get(configKey);
        if (configObj) {
          const yamlText = await configObj.text();
          const match = yamlText.match(/timezone:\s*["']?([^\n"']+)/);
          if (match) {
            chatTimezone = match[1].trim();
            console.log(`[Worker] [SCHEDULED] Using timezone from config: ${chatTimezone}`);
          }
        }
      } catch (e) {
        console.log(`[Worker] [SCHEDULED] Could not read timezone, using UTC`);
      }

      // Write the persistent server script
      await sandbox.writeFile(
        "/workspace/persistent_server.mjs",
        PERSISTENT_SERVER_SCRIPT
      );

      await sandbox.exec("mkdir -p /workspace/files", {
        timeout: QUICK_COMMAND_TIMEOUT_MS,
      });

      // Start the persistent server
      const server = await sandbox.startProcess(
        "node /workspace/persistent_server.mjs",
        {
          env: buildSdkEnv(ctx.env, chatTimezone),
        }
      );

      await server.waitForPort(PERSISTENT_SERVER_PORT, {
        path: "/health",
        timeout: SERVER_STARTUP_TIMEOUT_MS,
        status: { min: 200, max: 299 },
      });

      console.log(`[Worker] [SCHEDULED] Persistent server ready for chat ${chatId}`);
    } else {
      console.log(
        `[Worker] [SCHEDULED] Persistent server already running for chat ${chatId}`
      );
    }

    // Format the scheduled message with context
    const scheduledMessage = `[SCHEDULED: ${scheduleId}]\n\n${prompt}`;

    // POST message to the internal server
    const messagePayload = JSON.stringify({
      text: scheduledMessage,
      botToken,
      chatId,
      userMessageId: null, // No user message to reply to
      workerUrl,
      claudeSessionId: null, // Use existing session if any
      senderId: "system",
      isGroup,
      apiKey: ctx.env.ANDEE_API_KEY,
      isScheduledTask: true, // Flag for special handling
      scheduleId,
    });

    await sandbox.writeFile("/tmp/message.json", messagePayload);

    const curlResult = await sandbox.exec(
      `curl -s -X POST http://localhost:${PERSISTENT_SERVER_PORT}/message -H 'Content-Type: application/json' -d @/tmp/message.json`,
      { timeout: CURL_TIMEOUT_MS }
    );

    if (curlResult.exitCode !== 0) {
      console.error(`[Worker] [SCHEDULED] Failed to post message: ${curlResult.stderr}`);
      return Response.json(
        { error: "Failed to post message to container" },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    console.log(`[Worker] [SCHEDULED] Message queued for ${chatId}/${scheduleId}`);

    return Response.json(
      { success: true, chatId, scheduleId },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Worker] [SCHEDULED] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
