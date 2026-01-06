/**
 * Ask-stream endpoint: POST /ask-stream
 * Starts a streaming query, returns immediately.
 * Client polls /poll for progress.
 */

import { getSandbox } from "@cloudflare/sandbox";
import { CORS_HEADERS, HandlerContext, AskRequest } from "../types";
import {
  SANDBOX_SLEEP_AFTER,
  QUICK_COMMAND_TIMEOUT_MS,
} from "../../../shared/config";
import { AGENT_STREAM_SCRIPT } from "../scripts";

export async function handleAskStream(ctx: HandlerContext): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as AskRequest;
    const { chatId, message, claudeSessionId } = body;

    if (!chatId || !message) {
      return Response.json(
        { error: "Missing chatId or message" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log(`[Worker] Starting streaming request for chat ${chatId}`);

    // Get or create sandbox for this chat
    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Write the streaming agent script
    await sandbox.writeFile("/workspace/stream_agent.mjs", AGENT_STREAM_SCRIPT);

    // Write input
    const input = { message, claudeSessionId };
    await sandbox.writeFile("/workspace/input.json", JSON.stringify(input));

    // Initialize progress file
    await sandbox.writeFile(
      "/workspace/progress.json",
      JSON.stringify({
        text: "",
        done: false,
        sessionId: null,
        error: null,
      })
    );

    // Start agent in background (returns immediately)
    const startResult = await sandbox.exec(
      `ANTHROPIC_API_KEY=${ctx.env.ANTHROPIC_API_KEY} HOME=/home/claude nohup node /workspace/stream_agent.mjs > /workspace/agent.log 2>&1 &`,
      { timeout: QUICK_COMMAND_TIMEOUT_MS }
    );
    console.log(`[Worker] Agent started: exit=${startResult.exitCode}`);

    // Return immediately - client will poll for progress
    return Response.json({ started: true, chatId }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Worker] Streaming error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
