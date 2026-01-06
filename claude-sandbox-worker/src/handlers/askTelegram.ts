/**
 * Ask-telegram endpoint: POST /ask-telegram
 * Fire-and-forget endpoint for Telegram messages.
 * Uses persistent server if available, falls back to spawning agent process.
 */

import { getSandbox } from "@cloudflare/sandbox";
import { CORS_HEADERS, HandlerContext, AskTelegramRequest } from "../types";
import {
  SANDBOX_SLEEP_AFTER,
  PERSISTENT_SERVER_PORT,
  QUICK_COMMAND_TIMEOUT_MS,
  CURL_TIMEOUT_MS,
  SERVER_STARTUP_TIMEOUT_MS,
} from "../../../shared/config";
import { PERSISTENT_SERVER_SCRIPT, AGENT_TELEGRAM_SCRIPT } from "../scripts";

export async function handleAskTelegram(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as AskTelegramRequest;
    const { chatId, message, claudeSessionId, botToken, userMessageId } = body;

    if (!chatId || !message || !botToken) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log(`[Worker] Processing message for chat ${chatId}`);

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

    const workerUrl =
      "https://claude-sandbox-worker.samuel-hagman.workers.dev";

    // Check if persistent server is running
    const processes = await sandbox.listProcesses();
    const serverProcess = processes.find((p) =>
      p.command?.includes("persistent_server.mjs")
    );

    if (!serverProcess) {
      console.log(`[Worker] Starting persistent server for chat ${chatId}`);

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
      text: message,
      botToken,
      chatId,
      userMessageId,
      workerUrl,
      claudeSessionId,
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
          message,
          claudeSessionId,
          botToken,
          chatId,
          userMessageId,
          workerUrl,
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
