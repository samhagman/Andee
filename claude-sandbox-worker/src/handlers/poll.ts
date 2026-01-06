/**
 * Poll endpoint: GET /poll
 * Polls for streaming query progress.
 */

import { getSandbox } from "@cloudflare/sandbox";
import { CORS_HEADERS, HandlerContext, StreamingProgress } from "../types";
import { SANDBOX_SLEEP_AFTER } from "../../../shared/config";

export async function handlePoll(ctx: HandlerContext): Promise<Response> {
  try {
    const chatId = ctx.url.searchParams.get("chatId");

    if (!chatId) {
      return Response.json(
        { error: "Missing chatId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Read progress file
    try {
      const progressFile = await sandbox.readFile("/workspace/progress.json");
      const progress: StreamingProgress = JSON.parse(progressFile.content);
      return Response.json(progress, { headers: CORS_HEADERS });
    } catch {
      // File doesn't exist yet or is invalid
      return Response.json(
        {
          text: "",
          done: false,
          sessionId: null,
          error: null,
        } as StreamingProgress,
        { headers: CORS_HEADERS }
      );
    }
  } catch (error) {
    console.error("[Worker] Poll error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
