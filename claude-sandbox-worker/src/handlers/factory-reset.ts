/**
 * Factory Reset endpoint: POST /factory-reset
 * Creates a snapshot, then destroys sandbox AND deletes R2 session.
 * Next message will restore snapshot but start a fresh Claude session.
 */

import { getSandbox } from "@cloudflare/sandbox";
import {
  CORS_HEADERS,
  HandlerContext,
  getSessionKey,
} from "../types";
import { SANDBOX_SLEEP_AFTER } from "../../../shared/config";
import { startContainer, type StartupResult } from "../lib/container-startup";
import { createAndUploadSnapshot, destroyContainerWithCleanup } from "../lib/snapshot-operations";
import { clearTerminalUrl } from "../lib/r2-utils";
import {
  SAM_PROD_USER,
  SHERLY_PROD_USER,
  SAM_AND_SHERLY_PROD_GROUP,
} from "../../../shared/constants/testing";

interface FactoryResetRequest {
  chatId: string;
  senderId?: string;
  isGroup?: boolean;
  keepSession?: boolean; // Default: true - preserve Claude conversation
}

/**
 * Production chats that can NEVER have their sessions wiped.
 * This is a hardcoded safeguard to prevent accidental data loss.
 */
const PROTECTED_CHAT_IDS = new Set([
  SAM_PROD_USER,           // Sam's private chat
  SHERLY_PROD_USER,        // Sherly's private chat
  SAM_AND_SHERLY_PROD_GROUP, // Sam + Sherly group chat
]);

export async function handleFactoryReset(ctx: HandlerContext): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as FactoryResetRequest;
    const { chatId, senderId, isGroup, keepSession = true } = body;

    if (!chatId) {
      return Response.json(
        { error: "Missing chatId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log(`[Worker] Factory resetting sandbox for chat ${chatId} (senderId: ${senderId}, isGroup: ${isGroup})`);

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
        reason: "pre-factory-reset",
      });
      if (result.snapshotKey) {
        snapshotKey = result.snapshotKey;
        console.log(`[FactoryReset] Created pre-reset snapshot: ${snapshotKey}`);
      }
    } catch (snapshotError) {
      // Log but don't fail the factory reset if snapshot fails
      console.warn(`[Worker] Pre-factory-reset snapshot failed (continuing): ${snapshotError}`);
    }

    // Destroy the sandbox container with proper cleanup
    await destroyContainerWithCleanup({ sandbox, chatId });

    // Clear stored terminal URL (container destroyed = URL invalid, need fresh one on restart)
    await clearTerminalUrl(ctx.env.SNAPSHOTS, `chat-${chatId}`);

    // Check if this is a protected user (production users that can NEVER have sessions wiped)
    const isProtected = PROTECTED_CHAT_IDS.has(chatId) ||
                        PROTECTED_CHAT_IDS.has(senderId || "");

    // Handle session based on keepSession flag and protection
    let sessionPreserved = true;
    if (!keepSession && !isProtected && ctx.env.SESSIONS) {
      // Only wipe session if explicitly requested AND not a protected user
      const sessionKey = getSessionKey(chatId, senderId, isGroup);
      await ctx.env.SESSIONS.delete(sessionKey);
      console.log(`[Worker] Deleted R2 session: ${sessionKey}`);
      sessionPreserved = false;
    } else {
      if (!keepSession && isProtected) {
        console.log(`[Worker] PROTECTED: Refusing to wipe session for ${chatId} (production user)`);
      } else {
        console.log(`[Worker] Keeping R2 session (keepSession=${keepSession})`);
      }
    }

    console.log(`[Worker] Sandbox destroyed for chat ${chatId}, sessionPreserved=${sessionPreserved}`);

    // === Auto-wake container ===
    // Get fresh sandbox instance (new container after destroy)
    console.log(`[Worker] Auto-waking container for chat ${chatId}`);
    const freshSandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Start container with full initialization (restore + server startup)
    let startup: StartupResult | null = null;
    let containerError: string | null = null;
    try {
      startup = await startContainer(
        freshSandbox,
        chatId,
        senderId,
        isGroup,
        ctx.env
      );
      console.log(`[Worker] Container auto-waked for chat ${chatId}, restored=${startup.restored}, pid=${startup.serverPid}`);
    } catch (startupError) {
      containerError = startupError instanceof Error ? startupError.message : "Unknown startup error";
      console.error(`[Worker] Auto-wake failed for chat ${chatId}: ${containerError}`);
    }

    return Response.json(
      {
        success: true,
        message: startup?.serverReady
          ? `Factory reset complete. Container restarted and ready.`
          : `Factory reset complete. Container auto-wake failed: ${containerError}`,
        snapshotKey,
        sessionPreserved,
        containerReady: startup?.serverReady ?? false,
        restored: startup?.restored ?? false,
        serverPid: startup?.serverPid ?? null,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Worker] Factory reset error:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
