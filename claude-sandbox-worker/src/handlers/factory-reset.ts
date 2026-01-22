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
  getSnapshotKey,
} from "../types";
import {
  SANDBOX_SLEEP_AFTER,
  SNAPSHOT_DIRS,
  SNAPSHOT_TMP_PATH,
  TAR_TIMEOUT_MS,
  buildCreateExcludeFlags,
} from "../../../shared/config";
import { startContainer, type StartupResult } from "../lib/container-startup";
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
      // Check if any directories have content
      const dirsToBackup: string[] = [];
      for (const dir of SNAPSHOT_DIRS) {
        const checkResult = await sandbox.exec(`test -d ${dir} && ls -A ${dir}`, {
          timeout: 5000,
        });
        if (checkResult.exitCode === 0 && checkResult.stdout.trim()) {
          dirsToBackup.push(dir);
        }
      }

      if (dirsToBackup.length > 0) {
        console.log(`[Worker] Creating pre-factory-reset snapshot for chat ${chatId}`);

        // Create tar archive (excluding large caches like .memvid models)
        const createExcludes = buildCreateExcludeFlags();
        const tarCmd = `tar -czf ${SNAPSHOT_TMP_PATH} ${createExcludes} ${dirsToBackup.join(" ")} 2>/dev/null`;
        const tarResult = await sandbox.exec(tarCmd, { timeout: TAR_TIMEOUT_MS });

        if (tarResult.exitCode === 0) {
          // Read and upload
          const tarFile = await sandbox.readFile(SNAPSHOT_TMP_PATH, {
            encoding: "base64",
          });

          if (tarFile.content && ctx.env.SNAPSHOTS) {
            const binaryData = Uint8Array.from(atob(tarFile.content), (c) =>
              c.charCodeAt(0)
            );

            snapshotKey = getSnapshotKey(chatId, senderId, isGroup);
            await ctx.env.SNAPSHOTS.put(snapshotKey, binaryData, {
              customMetadata: {
                chatId,
                senderId: senderId || "",
                isGroup: String(isGroup),
                createdAt: new Date().toISOString(),
                directories: dirsToBackup.join(","),
                reason: "pre-factory-reset",
              },
            });

            console.log(
              `[Worker] Pre-factory-reset snapshot saved: ${snapshotKey} (${binaryData.length} bytes)`
            );
          }
        }
      } else {
        console.log(`[Worker] No content to snapshot for chat ${chatId}`);
      }
    } catch (snapshotError) {
      // Log but don't fail the factory reset if snapshot fails
      console.warn(`[Worker] Pre-factory-reset snapshot failed (continuing): ${snapshotError}`);
    }

    // Destroy the sandbox container
    await sandbox.destroy();

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
