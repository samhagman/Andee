/**
 * Ask endpoint: POST /ask
 * Synchronous query that waits for the response.
 */

import { getSandbox } from "@cloudflare/sandbox";
import {
  CORS_HEADERS,
  HandlerContext,
  AskRequest,
  AgentOutput,
} from "../types";
import {
  SANDBOX_SLEEP_AFTER,
  AGENT_TIMEOUT_MS,
} from "../../../shared/config";
import { AGENT_SYNC_SCRIPT } from "../scripts";

export async function handleAsk(ctx: HandlerContext): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as AskRequest;
    const { chatId, message, claudeSessionId } = body;

    if (!chatId || !message) {
      return Response.json(
        { error: "Missing chatId or message" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log(`[Worker] Processing request for chat ${chatId}`);

    // Get or create sandbox for this chat
    // Same chatId = same container (persistent between messages)
    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Write agent script to container
    await sandbox.writeFile("/workspace/agent.mjs", AGENT_SYNC_SCRIPT);

    // Write input
    const input = { message, claudeSessionId };
    await sandbox.writeFile("/workspace/input.json", JSON.stringify(input));

    // Set API key and run agent (container runs as non-root user 'claude')
    const result = await sandbox.exec(
      `ANTHROPIC_API_KEY=${ctx.env.ANTHROPIC_API_KEY} HOME=/home/claude node /workspace/agent.mjs`,
      { timeout: AGENT_TIMEOUT_MS }
    );

    console.log(`[Worker] Exec completed. Exit code: ${result.exitCode}`);
    if (result.stderr) {
      console.log(`[Worker] Stderr: ${result.stderr}`);
    }

    // Check if agent failed before trying to read output
    if (result.exitCode !== 0) {
      console.error(`[Worker] Agent failed with exit code ${result.exitCode}`);
      return Response.json(
        {
          success: false,
          response: `Agent error (exit ${result.exitCode}): ${result.stderr || result.stdout || "Unknown error"}`,
          claudeSessionId: null,
        },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Read output
    const outputFile = await sandbox.readFile("/workspace/output.json");
    const output: AgentOutput = JSON.parse(outputFile.content);

    console.log(`[Worker] Response ready for chat ${chatId}`);

    return Response.json(output, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Worker] Error:", error);
    return Response.json(
      {
        success: false,
        response: `Sandbox error: ${error instanceof Error ? error.message : "Unknown error"}`,
        claudeSessionId: null,
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
