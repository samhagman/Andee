/**
 * Reset endpoint: POST /reset
 * Destroys sandbox for a chat AND deletes R2 session.
 */

import { getSandbox } from "@cloudflare/sandbox";
import { CORS_HEADERS, HandlerContext, ResetRequest, getSessionKey } from "../types";

export async function handleReset(ctx: HandlerContext): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as ResetRequest;
    const { chatId } = body;

    if (!chatId) {
      return Response.json(
        { error: "Missing chatId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log(`[Worker] Resetting sandbox for chat ${chatId}`);

    // Destroy the sandbox container
    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`);
    await sandbox.destroy();

    // Also delete the R2 session to prevent orphaned session IDs
    if (ctx.env.SESSIONS) {
      const sessionKey = getSessionKey(chatId);
      await ctx.env.SESSIONS.delete(sessionKey);
      console.log(`[Worker] Deleted R2 session for chat ${chatId}`);
    }

    console.log(`[Worker] Sandbox destroyed for chat ${chatId}`);

    return Response.json(
      { success: true, message: "Sandbox and session reset" },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Worker] Reset error:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
