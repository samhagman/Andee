/**
 * Restart endpoint: POST /restart
 * Creates a snapshot, then destroys sandbox BUT keeps R2 session.
 * Next message will restore snapshot and resume the same Claude session.
 */

import { getSandbox } from "@cloudflare/sandbox";
import {
  CORS_HEADERS,
  HandlerContext,
  ResetRequest,
} from "../types";
import { SANDBOX_SLEEP_AFTER } from "../../../shared/config";
import { createAndUploadSnapshot, destroyContainerWithCleanup } from "../lib/snapshot-operations";
import { clearTerminalUrl } from "../lib/r2-utils";

export async function handleRestart(ctx: HandlerContext): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as ResetRequest;
    const { chatId, senderId, isGroup } = body;

    if (!chatId) {
      return Response.json(
        { error: "Missing chatId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log(`[Worker] Restarting sandbox for chat ${chatId} (senderId: ${senderId}, isGroup: ${isGroup})`);

    // Get sandbox for snapshot
    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Try to create snapshot before destroying
    let snapshotKey: string | null = null;
    try {
      const result = await createAndUploadSnapshot({
        sandbox,
        chatId,
        senderId,
        isGroup,
        env: ctx.env,
        reason: "pre-restart",
      });
      if (result.snapshotKey) {
        snapshotKey = result.snapshotKey;
        console.log(`[Restart] Created pre-restart snapshot: ${snapshotKey}`);
      }
    } catch (snapshotError) {
      // Log but don't fail the restart if snapshot fails
      console.warn(`[Worker] Pre-restart snapshot failed (continuing): ${snapshotError}`);
    }

    // Destroy the sandbox container with proper cleanup
    await destroyContainerWithCleanup({ sandbox, chatId });

    // Clear stored terminal URL (container destroyed = URL invalid, need fresh one on restart)
    await clearTerminalUrl(ctx.env.SNAPSHOTS, `chat-${chatId}`);

    // NOTE: We intentionally DO NOT delete the R2 session here.
    // This preserves the claudeSessionId for conversation continuity.

    console.log(`[Worker] Sandbox destroyed for chat ${chatId} (session preserved, terminal URL cleared)`);

    return Response.json(
      {
        success: true,
        message: snapshotKey
          ? "Container restarted. Session preserved, snapshot saved."
          : "Container restarted. Session preserved.",
        snapshotKey,
        sessionPreserved: true,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Worker] Restart error:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
