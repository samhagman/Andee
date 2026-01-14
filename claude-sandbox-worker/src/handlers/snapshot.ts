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
import { debug } from "../lib/debug";
import { clearTerminalUrlCache } from "./ide";
import {
  getFileSize,
  uploadLargeFileToR2,
  downloadLargeFileFromR2,
  STREAMING_THRESHOLD,
} from "../lib/streaming";

/**
 * Ensures the sandbox is healthy and ready to execute commands.
 * Uses exec() with retry logic - the first exec() call wakes a sleeping sandbox,
 * and subsequent retries give it time to fully wake up.
 */
async function ensureSandboxHealthy(sandbox: Sandbox, chatId?: string): Promise<boolean> {
  const timer = debug.timer('Snapshot', 'ensureSandboxHealthy', { chatId });

  // Try exec() up to 3 times with increasing delays
  // The first call wakes the sandbox, subsequent calls verify it's ready
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      debug.snapshot('health-check-attempt', chatId || 'unknown', { attempt });
      const result = await sandbox.exec('echo "alive"', { timeout: 15000 });
      debug.snapshot('health-check-result', chatId || 'unknown', {
        attempt,
        exitCode: result.exitCode,
        stdout: result.stdout?.trim(),
      });

      if (result.exitCode === 0) {
        timer({ attempt, healthy: true });
        return true;
      }

      // If exec succeeded but exit code is non-zero, that's still a failure
      debug.warn('non-zero-exit', {
        component: 'Snapshot',
        chatId,
        attempt,
        exitCode: result.exitCode,
      });
    } catch (error) {
      debug.error('health-check-failed', {
        component: 'Snapshot',
        chatId,
        attempt,
        error: String(error),
        errorType: (error as Error).constructor?.name,
      });
      console.log(`[Snapshot] Exec failed (attempt ${attempt}): ${error}`);

      // If this isn't the last attempt, wait before retrying
      // First attempt wakes sandbox, give it time to fully wake
      if (attempt < 3) {
        const delay = attempt * 1000; // 1s, 2s delays
        debug.snapshot('retry-delay', chatId || 'unknown', { delayMs: delay });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  timer({ attempt: 3, healthy: false });
  console.log(`[Snapshot] Sandbox health check failed after 3 attempts`);
  return false;
}

// Snapshot configuration
const SNAPSHOT_DIRS = ["/workspace", "/home/claude"];
const SNAPSHOT_TMP_PATH = "/tmp/snapshot.tar.gz";
const TAR_TIMEOUT_MS = 60_000; // 60 seconds for tar operations

// Directories to exclude from snapshots
// /media is R2-mounted and persisted separately - don't include in snapshots
// Legacy memvid paths excluded since conversation history now lives in R2
const SNAPSHOT_EXCLUDES: string[] = [
  "/media",
  "/media/*",
  "/home/claude/.memvid",       // Legacy embedding models location (~133MB)
  "/home/claude/shared/*.mv2",  // Legacy shared conversation memory
  "/home/claude/private",       // Legacy private user memory directories
];
const TAR_EXCLUDE_FLAGS = SNAPSHOT_EXCLUDES.length > 0
  ? SNAPSHOT_EXCLUDES.map(e => `--exclude='${e}'`).join(" ")
  : "";

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

    // Create tar archive (excluding large caches like .memvid models)
    const tarCmd = `tar -czf ${SNAPSHOT_TMP_PATH} ${TAR_EXCLUDE_FLAGS} ${dirsToBackup.join(" ")} 2>/dev/null`;
    console.log(`[Snapshot] Running: ${tarCmd}`);

    const tarResult = await sandbox.exec(tarCmd, { timeout: TAR_TIMEOUT_MS });
    if (tarResult.exitCode !== 0) {
      console.error(`[Snapshot] tar failed: ${tarResult.stderr}`);
      return Response.json(
        { error: `tar failed: ${tarResult.stderr}` },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Generate snapshot key
    const snapshotKey = getSnapshotKey(chatId, senderId, isGroup);
    const metadata = {
      chatId,
      senderId: senderId || "",
      isGroup: String(isGroup),
      createdAt: new Date().toISOString(),
      directories: dirsToBackup.join(","),
    };

    // Check file size to decide between streaming and buffered upload
    let snapshotSize: number;
    try {
      snapshotSize = await getFileSize(sandbox, SNAPSHOT_TMP_PATH);
      console.log(`[Snapshot] Tar file size: ${snapshotSize} bytes`);
    } catch (sizeError) {
      console.error(`[Snapshot] Failed to get file size: ${sizeError}`);
      return Response.json(
        { error: "Failed to check snapshot size" },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    let uploadResult: { size: number; parts?: number };

    if (snapshotSize > STREAMING_THRESHOLD) {
      // Large file: use streaming multipart upload
      console.log(`[Snapshot] Using streaming upload for ${snapshotSize} bytes (> ${STREAMING_THRESHOLD})`);

      try {
        uploadResult = await uploadLargeFileToR2(
          sandbox,
          SNAPSHOT_TMP_PATH,
          ctx.env.SNAPSHOTS,
          snapshotKey,
          metadata,
          chatId
        );
      } finally {
        // Clean up temp file
        await sandbox.exec(`rm -f ${SNAPSHOT_TMP_PATH}`, { timeout: 5000 });
      }

      console.log(
        `[Snapshot] Created snapshot (streaming) for chat ${chatId}: ${snapshotKey} (${uploadResult.size} bytes, ${uploadResult.parts} parts)`
      );

    } else {
      // Small file: use buffered upload (existing approach)
      console.log(`[Snapshot] Using buffered upload for ${snapshotSize} bytes (<= ${STREAMING_THRESHOLD})`);

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

      // Upload to R2
      await ctx.env.SNAPSHOTS.put(snapshotKey, binaryData, {
        customMetadata: metadata,
      });

      // Clean up temp file
      await sandbox.exec(`rm -f ${SNAPSHOT_TMP_PATH}`, { timeout: 5000 });

      uploadResult = { size: binaryData.length };

      console.log(
        `[Snapshot] Created snapshot (buffered) for chat ${chatId}: ${snapshotKey} (${binaryData.length} bytes)`
      );
    }

    return Response.json(
      {
        success: true,
        key: snapshotKey,
        size: uploadResult.size,
        parts: uploadResult.parts,
        directories: dirsToBackup,
        streaming: snapshotSize > STREAMING_THRESHOLD,
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
  const timer = debug.timer('Snapshot', 'restore');

  try {
    const body = (await ctx.request.json()) as RestoreRequest;
    const { chatId, senderId, isGroup, snapshotKey, markAsLatest } = body;

    debug.snapshot('restore-start', chatId, {
      senderId,
      isGroup,
      snapshotKey,
      markAsLatest,
    });

    if (!chatId || !snapshotKey) {
      return Response.json(
        { error: "Missing chatId or snapshotKey" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Validate snapshot access
    const prefix = getSnapshotPrefix(chatId, senderId, isGroup);
    if (!snapshotKey.startsWith(prefix)) {
      debug.warn('access-denied', { component: 'Snapshot', chatId, snapshotKey, prefix });
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
    debug.snapshot('r2-download-start', chatId, { snapshotKey });
    const object = await ctx.env.SNAPSHOTS.get(snapshotKey);

    if (!object) {
      debug.error('r2-not-found', { component: 'Snapshot', chatId, snapshotKey });
      return Response.json(
        { error: "Snapshot not found in R2", snapshotKey },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const arrayBuffer = await object.arrayBuffer();
    debug.snapshot('r2-download-complete', chatId, { size: arrayBuffer.byteLength });

    // Step 2: Wake up the sandbox with a health check
    debug.snapshot('health-check-start', chatId, {});
    const isHealthy = await ensureSandboxHealthy(sandbox, chatId);
    debug.snapshot('health-check-result', chatId, { isHealthy });

    if (!isHealthy) {
      debug.error('sandbox-unhealthy', { component: 'Snapshot', chatId });
      return Response.json(
        {
          error: "Unable to wake sandbox for restore",
          detail: "The sandbox appears to be sleeping or in a corrupted state.",
          suggestion: "Try restarting the sandbox with /restart endpoint, or check if the sandbox was used recently.",
          chatId,
        },
        { status: 503, headers: CORS_HEADERS }
      );
    }

    // Step 3: Write snapshot to container
    // Use streaming download for large files, buffered for small files
    const snapshotSize = arrayBuffer.byteLength;
    debug.snapshot('write-snapshot-start', chatId, { size: snapshotSize });

    try {
      if (snapshotSize > STREAMING_THRESHOLD) {
        // Large file: use streaming download (chunked writes)
        debug.snapshot('write-snapshot-streaming', chatId, { size: snapshotSize });

        // Re-fetch the object to get a fresh body stream
        // (we already consumed arrayBuffer above for small file compatibility)
        const freshObject = await ctx.env.SNAPSHOTS.get(snapshotKey);
        if (!freshObject) {
          throw new Error("Snapshot disappeared during restore");
        }

        await downloadLargeFileFromR2(sandbox, freshObject, SNAPSHOT_TMP_PATH, chatId);
        debug.snapshot('write-snapshot-streaming-success', chatId, {});

      } else {
        // Small file: use buffered write (existing approach)
        debug.snapshot('write-snapshot-buffered', chatId, { size: snapshotSize });

        // Convert ArrayBuffer to base64 in chunks to avoid stack overflow
        // (spreading large arrays as function arguments causes "Maximum call stack size exceeded")
        const bytes = new Uint8Array(arrayBuffer);
        const CHUNK_SIZE = 32768; // 32KB chunks
        let binaryString = '';
        for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
          const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
          binaryString += String.fromCharCode.apply(null, Array.from(chunk));
        }
        const base64Data = btoa(binaryString);
        debug.snapshot('base64-encoded', chatId, { base64Length: base64Data.length });

        await sandbox.writeFile(SNAPSHOT_TMP_PATH, base64Data, {
          encoding: "base64",
        });
        debug.snapshot('write-snapshot-buffered-success', chatId, {});
      }
    } catch (writeError) {
      debug.error('write-snapshot-failed', {
        component: 'Snapshot',
        chatId,
        error: String(writeError),
        errorType: (writeError as Error).constructor?.name,
      });
      return Response.json(
        { error: "Failed to write snapshot to container", detail: String(writeError) },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Step 4: Clear directories and extract in sequence
    debug.snapshot('extract-start', chatId, { dirs: SNAPSHOT_DIRS });
    const clearCmd = SNAPSHOT_DIRS.map(dir => `rm -rf ${dir}/* ${dir}/.[!.]* 2>/dev/null`).join("; ");
    const restoreResult = await sandbox.exec(
      `${clearCmd}; cd / && tar -xzf ${SNAPSHOT_TMP_PATH} && rm -f ${SNAPSHOT_TMP_PATH}`,
      { timeout: TAR_TIMEOUT_MS }
    );
    debug.snapshot('extract-complete', chatId, {
      exitCode: restoreResult.exitCode,
      stderrPreview: restoreResult.stderr?.slice(0, 200),
    });

    if (restoreResult.exitCode !== 0) {
      debug.error('extract-failed', {
        component: 'Snapshot',
        chatId,
        exitCode: restoreResult.exitCode,
        stderr: restoreResult.stderr,
      });
      return Response.json(
        { error: "Failed to restore snapshot", detail: restoreResult.stderr },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Verify filesystem state after restore
    try {
      const workspaceCheck = await sandbox.exec('ls -la /workspace 2>/dev/null | head -10', { timeout: 5000 });
      const homeCheck = await sandbox.exec('ls -la /home/claude 2>/dev/null | head -10', { timeout: 5000 });
      debug.snapshot('verify-filesystem', chatId, {
        workspaceFiles: workspaceCheck.stdout?.slice(0, 300),
        homeFiles: homeCheck.stdout?.slice(0, 300),
      });
    } catch (verifyError) {
      debug.warn('verify-filesystem-failed', {
        component: 'Snapshot',
        chatId,
        error: String(verifyError),
      });
    }

    // Step 5: Optionally mark this snapshot as "latest" by copying to the latest key in R2
    // We copy the ORIGINAL snapshot directly instead of re-tarring from container,
    // which avoids session staleness issues that can occur after large extractions.
    let newSnapshotKey: string | undefined;
    let markAsLatestError: string | undefined;

    if (markAsLatest) {
      debug.snapshot('mark-latest-start', chatId, {});
      try {
        // Simply copy the restored snapshot to the "latest" key in R2
        // This is much more reliable than re-creating a tar from the container
        newSnapshotKey = getSnapshotKey(chatId, senderId, isGroup);

        // Use the already-downloaded arrayBuffer (we still have it from Step 2)
        await ctx.env.SNAPSHOTS.put(newSnapshotKey, arrayBuffer, {
          customMetadata: {
            chatId,
            senderId: senderId || "",
            isGroup: String(isGroup),
            createdAt: new Date().toISOString(),
            reason: "restore-mark-latest",
            restoredFrom: snapshotKey,
            copiedFromTimestamp: object.uploaded?.toISOString() || "unknown",
          },
        });

        debug.snapshot('mark-latest-success', chatId, { newSnapshotKey, copiedFrom: snapshotKey });
      } catch (markError) {
        debug.error('mark-latest-failed', {
          component: 'Snapshot',
          chatId,
          error: markError instanceof Error ? markError.message : String(markError),
        });
        markAsLatestError = markError instanceof Error ? markError.message : String(markError);
      }
    }

    // Clear terminal URL cache since container state changed
    // Note: We do NOT destroy the sandbox here - that would wipe the restored files!
    // The stale session issue may occur, but users can click "Restart Sandbox" if needed.
    const sandboxId = `chat-${chatId}`;
    clearTerminalUrlCache(sandboxId);

    timer({ success: true, restoredFrom: snapshotKey, newSnapshotKey });
    return Response.json(
      {
        success: true,
        restoredFrom: snapshotKey,
        newSnapshotKey,
        markAsLatestError,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    debug.error('restore-error', {
      component: 'Snapshot',
      error: error instanceof Error ? error.message : String(error),
      errorType: (error as Error).constructor?.name,
      stack: (error as Error).stack?.split('\n').slice(0, 3).join(' | '),
    });
    console.error("[Snapshot] Restore error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
