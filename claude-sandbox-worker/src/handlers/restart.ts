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
  getSnapshotKey,
} from "../types";
import { SANDBOX_SLEEP_AFTER } from "../../../shared/config";

// Snapshot configuration (shared with snapshot.ts and factory-reset.ts)
const SNAPSHOT_DIRS = ["/workspace", "/home/claude"];
const SNAPSHOT_TMP_PATH = "/tmp/snapshot.tar.gz";
const TAR_TIMEOUT_MS = 60_000;

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
        console.log(`[Worker] Creating pre-restart snapshot for chat ${chatId}`);

        // Create tar archive
        const tarCmd = `tar -czf ${SNAPSHOT_TMP_PATH} ${dirsToBackup.join(" ")} 2>/dev/null`;
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
                reason: "pre-restart",
              },
            });

            console.log(
              `[Worker] Pre-restart snapshot saved: ${snapshotKey} (${binaryData.length} bytes)`
            );
          }
        }
      } else {
        console.log(`[Worker] No content to snapshot for chat ${chatId}`);
      }
    } catch (snapshotError) {
      // Log but don't fail the restart if snapshot fails
      console.warn(`[Worker] Pre-restart snapshot failed (continuing): ${snapshotError}`);
    }

    // Destroy the sandbox container (kills all processes)
    await sandbox.destroy();

    // NOTE: We intentionally DO NOT delete the R2 session here.
    // This preserves the claudeSessionId for conversation continuity.

    console.log(`[Worker] Sandbox destroyed for chat ${chatId} (session preserved)`);

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
