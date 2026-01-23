/**
 * Scheduled task endpoint: POST /scheduled-task
 * Called by RecurringSchedulesDO when a schedule alarm fires.
 * Similar to /ask but specifically for automated scheduled prompts.
 */

import { getSandbox } from "@cloudflare/sandbox";
import {
  CORS_HEADERS,
  HandlerContext,
  ScheduledTaskRequest,
} from "../types";
import {
  SANDBOX_SLEEP_AFTER,
  PERSISTENT_SERVER_PORT,
  QUICK_COMMAND_TIMEOUT_MS,
  CURL_TIMEOUT_MS,
  SERVER_STARTUP_TIMEOUT_MS,
} from "../../../shared/config";
import { PERSISTENT_SERVER_SCRIPT } from "../scripts";
import { mountMediaBucket } from "../lib/media";
import { restoreSnapshot } from "../lib/snapshot-operations";
import { buildSdkEnv } from "../lib/container-startup";

/**
 * Handle a scheduled task execution.
 * Called by RecurringSchedulesDO when alarm fires.
 */
export async function handleScheduledTask(
  ctx: HandlerContext
): Promise<Response> {
  try {
    // Always require API key authentication (no header bypass)
    if (ctx.env.ANDEE_API_KEY) {
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

    const PRODUCTION_WORKER_URL = "https://claude-sandbox-worker.h2c.workers.dev";
    const requestUrl = new URL(ctx.request.url);
    const workerUrl = requestUrl.host === "internal"
      ? PRODUCTION_WORKER_URL
      : `${requestUrl.protocol}//${requestUrl.host}`;

    if (!serverProcess) {
      console.log(`[Worker] [SCHEDULED] Starting persistent server for chat ${chatId}`);

      // Restore from snapshot
      // senderId "system" is a first-class sender, handled by getSnapshotPrefix
      const restored = await restoreSnapshot({ sandbox, chatId, senderId, isGroup, env: ctx.env });
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
