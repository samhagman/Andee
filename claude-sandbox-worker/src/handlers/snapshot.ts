/**
 * Snapshot endpoints for filesystem backup/restore.
 *
 * POST /snapshot      - Create snapshot from sandbox filesystem
 * GET  /snapshot      - Get latest snapshot for a chat
 * GET  /snapshots     - List all snapshots for a chat
 * POST /restore       - Restore a specific snapshot to the sandbox
 */

import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import {
  CORS_HEADERS,
  HandlerContext,
  SnapshotRequest,
  getSnapshotKey,
  getSnapshotPrefix,
} from "../types";
import { SANDBOX_SLEEP_AFTER } from "../../../shared/config";

/**
 * Ensures the sandbox is healthy and ready to execute commands.
 * Uses listProcesses() first (which properly activates the sandbox),
 * then validates with an exec command.
 */
async function ensureSandboxHealthy(sandbox: Sandbox): Promise<boolean> {
  try {
    // listProcesses() properly activates a sleeping sandbox
    // (unlike exec() which fails on stale sessions)
    const processes = await sandbox.listProcesses();
    console.log(`[Snapshot] Sandbox has ${processes.length} process(es) running`);

    // Now try a simple exec to confirm the sandbox is responsive
    const result = await sandbox.exec('echo "alive"', { timeout: 10000 });
    return result.exitCode === 0;
  } catch (error) {
    console.log(`[Snapshot] Sandbox health check failed: ${error}`);
    return false;
  }
}

// Snapshot configuration
const SNAPSHOT_DIRS = ["/workspace", "/home/claude"];
const SNAPSHOT_TMP_PATH = "/tmp/snapshot.tar.gz";
const TAR_TIMEOUT_MS = 60_000; // 60 seconds for tar operations

/**
 * POST /snapshot - Create a snapshot of the sandbox filesystem.
 * Body: { chatId: string, senderId: string, isGroup: boolean }
 * Returns: { success: true, key: string } or { error: string }
 */
export async function handleSnapshotCreate(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as SnapshotRequest;
    const { chatId, senderId, isGroup } = body;

    if (!chatId) {
      return Response.json(
        { error: "Missing chatId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log(`[Snapshot] Creating snapshot for chat ${chatId} (senderId: ${senderId}, isGroup: ${isGroup})`);

    // Get sandbox
    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Check if any of the directories exist and have content
    const dirsToBackup: string[] = [];
    for (const dir of SNAPSHOT_DIRS) {
      const checkResult = await sandbox.exec(`test -d ${dir} && ls -A ${dir}`, {
        timeout: 5000,
      });
      if (checkResult.exitCode === 0 && checkResult.stdout.trim()) {
        dirsToBackup.push(dir);
      }
    }

    if (dirsToBackup.length === 0) {
      console.log(`[Snapshot] No content to snapshot for chat ${chatId}`);
      return Response.json(
        { success: false, error: "No content to snapshot" },
        { headers: CORS_HEADERS }
      );
    }

    // Create tar archive
    const tarCmd = `tar -czf ${SNAPSHOT_TMP_PATH} ${dirsToBackup.join(" ")} 2>/dev/null`;
    console.log(`[Snapshot] Running: ${tarCmd}`);

    const tarResult = await sandbox.exec(tarCmd, { timeout: TAR_TIMEOUT_MS });
    if (tarResult.exitCode !== 0) {
      console.error(`[Snapshot] tar failed: ${tarResult.stderr}`);
      return Response.json(
        { error: `tar failed: ${tarResult.stderr}` },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Read the tar file as base64
    const tarFile = await sandbox.readFile(SNAPSHOT_TMP_PATH, {
      encoding: "base64",
    });

    if (!tarFile.content) {
      return Response.json(
        { error: "Failed to read snapshot file" },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Decode base64 to binary
    const binaryData = Uint8Array.from(atob(tarFile.content), (c) =>
      c.charCodeAt(0)
    );

    // Generate snapshot key and upload to R2
    const snapshotKey = getSnapshotKey(chatId, senderId, isGroup);
    await ctx.env.SNAPSHOTS.put(snapshotKey, binaryData, {
      customMetadata: {
        chatId,
        senderId: senderId || "",
        isGroup: String(isGroup),
        createdAt: new Date().toISOString(),
        directories: dirsToBackup.join(","),
      },
    });

    // Clean up temp file
    await sandbox.exec(`rm -f ${SNAPSHOT_TMP_PATH}`, { timeout: 5000 });

    console.log(
      `[Snapshot] Created snapshot for chat ${chatId}: ${snapshotKey} (${binaryData.length} bytes)`
    );

    return Response.json(
      {
        success: true,
        key: snapshotKey,
        size: binaryData.length,
        directories: dirsToBackup,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Snapshot] Create error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /snapshot?chatId=X&senderId=Y&isGroup=Z - Get the latest snapshot for a chat.
 * Returns: tar.gz stream or 404
 */
export async function handleSnapshotGet(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const chatId = ctx.url.searchParams.get("chatId");
    const senderId = ctx.url.searchParams.get("senderId") || undefined;
    const isGroup = ctx.url.searchParams.get("isGroup") === "true" ? true :
                    ctx.url.searchParams.get("isGroup") === "false" ? false : undefined;

    if (!chatId) {
      return Response.json(
        { error: "Missing chatId query parameter" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // List snapshots for this chat to find the latest
    const prefix = getSnapshotPrefix(chatId, senderId, isGroup);
    const listResult = await ctx.env.SNAPSHOTS.list({ prefix });

    if (listResult.objects.length === 0) {
      return Response.json(
        { error: "No snapshots found" },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Sort by key (timestamp is embedded) to get latest
    const latestKey = listResult.objects
      .sort((a, b) => b.key.localeCompare(a.key))[0].key;

    console.log(`[Snapshot] Fetching latest snapshot: ${latestKey}`);

    const object = await ctx.env.SNAPSHOTS.get(latestKey);
    if (!object) {
      return Response.json(
        { error: "Snapshot not found" },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${chatId}-snapshot.tar.gz"`,
        "X-Snapshot-Key": latestKey,
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    console.error("[Snapshot] Get error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /snapshots?chatId=X&senderId=Y&isGroup=Z - List all snapshots for a chat.
 * Returns: { snapshots: [{ key, size, uploaded }] }
 */
export async function handleSnapshotsList(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const chatId = ctx.url.searchParams.get("chatId");
    const senderId = ctx.url.searchParams.get("senderId") || undefined;
    const isGroup = ctx.url.searchParams.get("isGroup") === "true" ? true :
                    ctx.url.searchParams.get("isGroup") === "false" ? false : undefined;

    if (!chatId) {
      return Response.json(
        { error: "Missing chatId query parameter" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const prefix = getSnapshotPrefix(chatId, senderId, isGroup);
    const listResult = await ctx.env.SNAPSHOTS.list({ prefix });

    const snapshots = listResult.objects.map((obj) => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded.toISOString(),
    }));

    // Sort by uploaded date, newest first
    snapshots.sort(
      (a, b) =>
        new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime()
    );

    return Response.json(
      { chatId, count: snapshots.length, snapshots },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Snapshot] List error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * Restore request body type.
 */
interface RestoreRequest {
  chatId: string;
  senderId?: string;
  isGroup?: boolean;
  snapshotKey: string;
  markAsLatest?: boolean;
}

/**
 * POST /restore - Restore a specific snapshot to the sandbox.
 * Body: { chatId, senderId, isGroup, snapshotKey, markAsLatest? }
 *
 * Process:
 * 1. Validate snapshot access
 * 2. Kill all user processes
 * 3. Clear /workspace and /home/claude directories
 * 4. Download and extract snapshot
 * 5. Optionally create new snapshot (markAsLatest)
 */
export async function handleSnapshotRestore(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as RestoreRequest;
    const { chatId, senderId, isGroup, snapshotKey, markAsLatest } = body;

    if (!chatId || !snapshotKey) {
      return Response.json(
        { error: "Missing chatId or snapshotKey" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Validate snapshot access
    const prefix = getSnapshotPrefix(chatId, senderId, isGroup);
    if (!snapshotKey.startsWith(prefix)) {
      return Response.json(
        { error: "Access denied to this snapshot" },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    console.log(`[Snapshot] Restoring snapshot for chat ${chatId}: ${snapshotKey}`);

    // Get sandbox reference
    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Step 1: Download snapshot from R2 first (doesn't need sandbox)
    console.log(`[Snapshot] Downloading snapshot from R2...`);
    const object = await ctx.env.SNAPSHOTS.get(snapshotKey);

    if (!object) {
      return Response.json(
        { error: "Snapshot not found in R2", snapshotKey },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const arrayBuffer = await object.arrayBuffer();
    console.log(`[Snapshot] Downloaded ${arrayBuffer.byteLength} bytes from R2`);

    // Step 2: Wake up the sandbox with a health check
    console.log(`[Snapshot] Ensuring sandbox is awake...`);
    const isHealthy = await ensureSandboxHealthy(sandbox);
    if (!isHealthy) {
      console.log(`[Snapshot] Sandbox not healthy, attempting to wake...`);
      // Try once more - the first call may have woken it
      const retry = await ensureSandboxHealthy(sandbox);
      if (!retry) {
        return Response.json(
          { error: "Unable to wake sandbox for restore" },
          { status: 500, headers: CORS_HEADERS }
        );
      }
    }

    // Step 3: Write snapshot to container using SDK's writeFile (same approach as ask.ts)
    // The SDK handles base64 encoding internally
    console.log(`[Snapshot] Writing snapshot to container (${arrayBuffer.byteLength} bytes)...`);
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    try {
      await sandbox.writeFile(SNAPSHOT_TMP_PATH, base64Data, {
        encoding: "base64",
      });
      console.log(`[Snapshot] Snapshot file written successfully`);
    } catch (writeError) {
      console.error(`[Snapshot] Failed to write snapshot file:`, writeError);
      return Response.json(
        { error: "Failed to write snapshot to container", detail: String(writeError) },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Step 4: Clear directories and extract in sequence
    console.log(`[Snapshot] Clearing directories and extracting...`);
    const clearCmd = SNAPSHOT_DIRS.map(dir => `rm -rf ${dir}/* ${dir}/.[!.]* 2>/dev/null`).join("; ");
    const restoreResult = await sandbox.exec(
      `${clearCmd}; cd / && tar -xzf ${SNAPSHOT_TMP_PATH} && rm -f ${SNAPSHOT_TMP_PATH}`,
      { timeout: TAR_TIMEOUT_MS }
    );

    if (restoreResult.exitCode !== 0) {
      console.error(`[Snapshot] Restore failed: ${restoreResult.stderr}`);
      return Response.json(
        { error: "Failed to restore snapshot", detail: restoreResult.stderr },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    console.log(`[Snapshot] Restore complete for chat ${chatId}`);

    // Step 5: Optionally create new snapshot to mark as latest
    let newSnapshotKey: string | undefined;
    if (markAsLatest) {
      console.log(`[Snapshot] Creating new snapshot to mark as latest...`);

      // Check which directories have content
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
        // Create tar archive
        const tarCmd = `tar -czf ${SNAPSHOT_TMP_PATH} ${dirsToBackup.join(" ")} 2>/dev/null`;
        const tarResult = await sandbox.exec(tarCmd, { timeout: TAR_TIMEOUT_MS });

        if (tarResult.exitCode === 0) {
          // Read and upload
          const tarFile = await sandbox.readFile(SNAPSHOT_TMP_PATH, {
            encoding: "base64",
          });

          if (tarFile.content) {
            const binaryData = Uint8Array.from(atob(tarFile.content), (c) =>
              c.charCodeAt(0)
            );

            newSnapshotKey = getSnapshotKey(chatId, senderId, isGroup);
            await ctx.env.SNAPSHOTS.put(newSnapshotKey, binaryData, {
              customMetadata: {
                chatId,
                senderId: senderId || "",
                isGroup: String(isGroup),
                createdAt: new Date().toISOString(),
                directories: dirsToBackup.join(","),
                reason: "restore-mark-latest",
                restoredFrom: snapshotKey,
              },
            });

            console.log(`[Snapshot] Created new snapshot: ${newSnapshotKey}`);
          }
        }

        // Clean up
        await sandbox.exec(`rm -f ${SNAPSHOT_TMP_PATH}`, { timeout: 5000 });
      }
    }

    return Response.json(
      {
        success: true,
        restoredFrom: snapshotKey,
        newSnapshotKey,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Snapshot] Restore error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
