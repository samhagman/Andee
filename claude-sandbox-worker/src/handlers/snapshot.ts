/**
 * Snapshot endpoints for filesystem backup/restore.
 *
 * POST /snapshot      - Create snapshot from sandbox filesystem
 * GET  /snapshot      - Get latest snapshot for a chat
 * GET  /snapshots     - List all snapshots for a chat
 * DELETE /snapshot    - Delete a specific snapshot
 */

import { getSandbox } from "@cloudflare/sandbox";
import {
  CORS_HEADERS,
  HandlerContext,
  SnapshotRequest,
  getSnapshotKey,
  getSnapshotPrefix,
} from "../types";
import { SANDBOX_SLEEP_AFTER } from "../../../shared/config";

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
 * DELETE /snapshot?chatId=X&senderId=Y&isGroup=Z&key=K - Delete a specific snapshot.
 * If key=all, deletes all snapshots for the chat.
 * Returns: { success: true, deleted: number }
 */
export async function handleSnapshotDelete(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const chatId = ctx.url.searchParams.get("chatId");
    const senderId = ctx.url.searchParams.get("senderId") || undefined;
    const isGroup = ctx.url.searchParams.get("isGroup") === "true" ? true :
                    ctx.url.searchParams.get("isGroup") === "false" ? false : undefined;
    const key = ctx.url.searchParams.get("key");

    if (!chatId) {
      return Response.json(
        { error: "Missing chatId query parameter" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const prefix = getSnapshotPrefix(chatId, senderId, isGroup);

    if (key === "all") {
      // Delete all snapshots for this chat
      const listResult = await ctx.env.SNAPSHOTS.list({ prefix });

      const deletePromises = listResult.objects.map((obj) =>
        ctx.env.SNAPSHOTS.delete(obj.key)
      );
      await Promise.all(deletePromises);

      console.log(
        `[Snapshot] Deleted ${listResult.objects.length} snapshots for chat ${chatId}`
      );

      return Response.json(
        { success: true, deleted: listResult.objects.length },
        { headers: CORS_HEADERS }
      );
    }

    if (!key) {
      return Response.json(
        { error: "Missing key query parameter (use key=all to delete all)" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Verify the key belongs to this chat (matches the expected prefix)
    if (!key.startsWith(prefix)) {
      return Response.json(
        { error: "Invalid key for this chatId/senderId/isGroup combination" },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    await ctx.env.SNAPSHOTS.delete(key);
    console.log(`[Snapshot] Deleted snapshot: ${key}`);

    return Response.json({ success: true, deleted: 1 }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Snapshot] Delete error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
