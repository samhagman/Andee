/**
 * Unified snapshot operations.
 *
 * ALL restore/upload operations MUST go through these functions.
 * No handler should implement its own snapshot logic.
 *
 * This module consolidates the snapshot functionality that was previously
 * scattered across multiple files with divergent (and sometimes broken)
 * implementations.
 *
 * Key benefits:
 * - Presigned URL approach for downloads: No size limits
 * - Streaming upload for large files: Handles >25MB snapshots
 * - Consistent error handling across all endpoints
 * - Single source of truth for snapshot logic
 */

import type { Sandbox } from "@cloudflare/sandbox";
import { getSnapshotKey, getSnapshotPrefix } from "../types";
import { generatePresignedUrl, SNAPSHOT_BUCKET_NAME } from "./r2-utils";
import { getFileSize, uploadLargeFileToR2, STREAMING_THRESHOLD } from "./streaming";
import { clearTerminalUrlCache } from "../handlers/ide";
import type { Env } from "../types";
import {
  SNAPSHOT_TMP_PATH,
  SNAPSHOT_CURL_TIMEOUT_MS,
  TAR_TIMEOUT_MS,
  buildRestoreExcludeFlags,
  buildCreateExcludeFlags,
  SNAPSHOT_DIRS,
} from "../../../shared/config";

// =============================================================================
// RESTORE OPERATIONS (R2 -> Container)
// =============================================================================

export interface RestoreOptions {
  sandbox: Sandbox;
  chatId: string;
  senderId: string | undefined;
  isGroup: boolean | undefined;
  env: Env;
  /** Optional specific snapshot key. If not provided, uses latest. */
  snapshotKey?: string;
}

/**
 * Restore a snapshot to the container using presigned URL.
 * Works for ANY size - no limits.
 *
 * This uses the container-direct download approach:
 * 1. Generate presigned URL for R2 object
 * 2. Container downloads directly via curl
 * 3. Extract tar archive in container
 *
 * Benefits:
 * - Bypasses Worker memory limits (crashes on >10MB)
 * - Bypasses sandbox.writeFile() RPC limits (32MB)
 * - No base64 encoding overhead
 * - Works for snapshots of any size
 *
 * Used by: /ask, /scheduled-task, IDE /files, /restore
 */
export async function restoreSnapshot(options: RestoreOptions): Promise<boolean> {
  const { sandbox, chatId, senderId, isGroup, env, snapshotKey } = options;

  if (!env.SNAPSHOTS) {
    console.log(`[restoreSnapshot] SNAPSHOTS binding not available, skipping restore`);
    return false;
  }

  // Check if R2 credentials are available for presigned URLs
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.CLOUDFLARE_ACCOUNT_ID) {
    console.warn("[restoreSnapshot] R2 credentials not available, cannot generate presigned URL");
    return false;
  }

  try {
    // Determine which snapshot to restore
    let keyToRestore = snapshotKey;
    let snapshotSize: number | undefined;

    if (!keyToRestore) {
      // Find latest snapshot
      const prefix = getSnapshotPrefix(chatId, senderId, isGroup);
      const listResult = await env.SNAPSHOTS.list({ prefix });

      if (listResult.objects.length === 0) {
        console.log(`[restoreSnapshot] No snapshots found for prefix: ${prefix}`);
        return false;
      }

      // Get latest snapshot (sorted by key which includes timestamp)
      const sortedObjects = listResult.objects.sort((a, b) => b.key.localeCompare(a.key));
      keyToRestore = sortedObjects[0].key;
      snapshotSize = sortedObjects[0].size;
    }

    console.log(`[restoreSnapshot] Restoring: ${keyToRestore}${snapshotSize ? ` (${(snapshotSize / 1024 / 1024).toFixed(1)}MB)` : ""}`);

    // Generate presigned URL (5 minute expiry)
    const presignedUrl = await generatePresignedUrl(env, keyToRestore, 300);
    // SECURITY: Don't log the full URL (contains auth signature)
    console.log(`[restoreSnapshot] Generated presigned URL for snapshot download`);

    // Write URL to temp file to avoid shell interpolation issues
    // (presigned URLs contain & and ? which can be misinterpreted by shell)
    const urlTmpFile = `/tmp/restore-url-${Date.now()}.txt`;
    await sandbox.writeFile(urlTmpFile, presignedUrl);

    // Container downloads directly via curl
    const curlTimeoutSeconds = Math.ceil(SNAPSHOT_CURL_TIMEOUT_MS / 1000);
    const tmpPath = `${SNAPSHOT_TMP_PATH}.tmp`;

    const downloadResult = await sandbox.exec(
      `curl --fail --silent --show-error --location --retry 3 --retry-delay 1 --max-time ${curlTimeoutSeconds} "$(cat ${urlTmpFile})" -o ${tmpPath} && mv ${tmpPath} ${SNAPSHOT_TMP_PATH}`,
      { timeout: SNAPSHOT_CURL_TIMEOUT_MS + 30000 } // exec timeout with buffer for retries
    );

    // Clean up URL file immediately (contains auth signature)
    await sandbox.exec(`rm -f ${urlTmpFile}`, { timeout: 5000 });

    if (downloadResult.exitCode !== 0) {
      console.error(`[restoreSnapshot] Download failed: ${downloadResult.stderr}`);
      await sandbox.exec(`rm -f ${tmpPath}`, { timeout: 5000 }); // Clean up partial download
      return false;
    }

    console.log(`[restoreSnapshot] Snapshot downloaded to container`);

    // Extract snapshot (excluding system files that come from Dockerfile)
    const restoreExcludes = buildRestoreExcludeFlags();
    const extractResult = await sandbox.exec(
      `cd / && tar -xzf ${SNAPSHOT_TMP_PATH} ${restoreExcludes}`,
      { timeout: TAR_TIMEOUT_MS }
    );

    if (extractResult.exitCode !== 0) {
      console.error(`[restoreSnapshot] Extract failed: ${extractResult.stderr}`);
      return false;
    }

    // Clean up temp file
    await sandbox.exec(`rm -f ${SNAPSHOT_TMP_PATH}`, { timeout: 5000 });

    console.log(`[restoreSnapshot] Successfully restored: ${keyToRestore}`);
    return true;
  } catch (error) {
    console.error(`[restoreSnapshot] Error:`, error);
    return false;
  }
}

/**
 * Cache a snapshot for preview (used by IDE snapshot browser).
 * Same presigned URL approach - works for ANY size.
 *
 * Downloads the snapshot to a cache directory in the container
 * for browsing without modifying the actual filesystem.
 */
export async function cacheSnapshotForPreview(
  sandbox: Sandbox,
  env: Env,
  snapshotKey: string,
  cacheDir: string
): Promise<string> {
  // Generate a safe cache filename from the snapshot key
  const cacheFile = `${cacheDir}/preview-${snapshotKey.replace(/\//g, "-")}`;

  // Check if already cached
  const checkResult = await sandbox.exec(`test -f ${cacheFile} && echo "EXISTS"`, {
    timeout: 5000,
  });
  if (checkResult.stdout.includes("EXISTS")) {
    console.log(`[cacheSnapshotForPreview] Using cached: ${cacheFile}`);
    return cacheFile;
  }

  // Ensure cache directory exists
  await sandbox.exec(`mkdir -p ${cacheDir}`, { timeout: 5000 });

  // Use presigned URL - container downloads directly (no size limit!)
  const presignedUrl = await generatePresignedUrl(env, snapshotKey, 300);
  const urlTmpFile = `/tmp/preview-url-${Date.now()}.txt`;
  await sandbox.writeFile(urlTmpFile, presignedUrl);

  const downloadResult = await sandbox.exec(
    `curl --fail --silent --show-error --location --retry 3 --retry-delay 1 --max-time 120 "$(cat ${urlTmpFile})" -o ${cacheFile} && rm ${urlTmpFile}`,
    { timeout: 150000 } // 2.5 minute timeout
  );

  if (downloadResult.exitCode !== 0) {
    // Clean up on failure
    await sandbox.exec(`rm -f ${urlTmpFile} ${cacheFile}`, { timeout: 5000 });
    throw new Error(`Failed to download snapshot for preview: ${downloadResult.stderr}`);
  }

  console.log(`[cacheSnapshotForPreview] Cached: ${cacheFile}`);
  return cacheFile;
}

// =============================================================================
// UPLOAD OPERATIONS (Container -> R2)
// =============================================================================

export interface UploadOptions {
  sandbox: Sandbox;
  chatId: string;
  senderId: string | undefined;
  isGroup: boolean | undefined;
  env: Env;
  reason: "manual" | "pre-restart" | "pre-factory-reset" | "scheduled";
  /** Directories to include in snapshot. Defaults to SNAPSHOT_DIRS from config. */
  directories?: string[];
}

export interface UploadResult {
  success: boolean;
  snapshotKey?: string;
  size?: number;
  parts?: number;
  streaming?: boolean;
}

/**
 * Create and upload a snapshot to R2.
 * Automatically uses streaming for large files (>25MB).
 *
 * Process:
 * 1. Check if any directories have content worth snapshotting
 * 2. Create tar.gz archive with proper exclusions
 * 3. Check file size to determine upload strategy
 * 4. Upload using buffered (small) or streaming (large) approach
 * 5. Clean up temp files
 *
 * Used by: /snapshot, /restart, /factory-reset
 */
export async function createAndUploadSnapshot(
  options: UploadOptions
): Promise<UploadResult> {
  const {
    sandbox,
    chatId,
    senderId,
    isGroup,
    env,
    reason,
    directories = SNAPSHOT_DIRS,
  } = options;

  // Check if any of the directories exist and have content
  const dirsToBackup: string[] = [];
  for (const dir of directories) {
    const checkResult = await sandbox.exec(`test -d ${dir} && ls -A ${dir}`, {
      timeout: 5000,
    });
    if (checkResult.exitCode === 0 && checkResult.stdout.trim()) {
      dirsToBackup.push(dir);
    }
  }

  if (dirsToBackup.length === 0) {
    console.log(`[createAndUploadSnapshot] No content to snapshot for chat ${chatId}`);
    return { success: true }; // Success but no snapshot needed
  }

  // Create tar archive (excluding large caches like .memvid models)
  const createExcludes = buildCreateExcludeFlags();
  const tarCmd = `tar -czf ${SNAPSHOT_TMP_PATH} ${createExcludes} ${dirsToBackup.join(" ")} 2>/dev/null`;
  console.log(`[createAndUploadSnapshot] Running: ${tarCmd}`);

  const tarResult = await sandbox.exec(tarCmd, { timeout: TAR_TIMEOUT_MS });
  if (tarResult.exitCode !== 0) {
    console.error(`[createAndUploadSnapshot] tar failed: ${tarResult.stderr}`);
    return { success: false };
  }

  // Get file size
  let snapshotSize: number;
  try {
    snapshotSize = await getFileSize(sandbox, SNAPSHOT_TMP_PATH);
    console.log(`[createAndUploadSnapshot] Tar file size: ${snapshotSize} bytes`);
  } catch (sizeError) {
    console.error(`[createAndUploadSnapshot] Failed to get file size: ${sizeError}`);
    await sandbox.exec(`rm -f ${SNAPSHOT_TMP_PATH}`, { timeout: 5000 });
    return { success: false };
  }

  // Generate snapshot key
  const snapshotKey = getSnapshotKey(chatId, senderId, isGroup);
  const metadata = {
    chatId,
    senderId: senderId || "",
    isGroup: String(isGroup),
    createdAt: new Date().toISOString(),
    reason,
    sizeBytes: String(snapshotSize),
    directories: dirsToBackup.join(","),
  };

  let uploadResult: UploadResult;

  try {
    if (snapshotSize > STREAMING_THRESHOLD) {
      // Large file: use streaming multipart upload
      console.log(`[createAndUploadSnapshot] Using streaming upload for ${snapshotSize} bytes (> ${STREAMING_THRESHOLD})`);

      const streamResult = await uploadLargeFileToR2(
        sandbox,
        SNAPSHOT_TMP_PATH,
        env.SNAPSHOTS,
        snapshotKey,
        metadata,
        chatId
      );

      uploadResult = {
        success: true,
        snapshotKey,
        size: streamResult.size,
        parts: streamResult.parts,
        streaming: true,
      };
    } else {
      // Small file: use buffered upload
      console.log(`[createAndUploadSnapshot] Using buffered upload for ${snapshotSize} bytes (<= ${STREAMING_THRESHOLD})`);

      const tarFile = await sandbox.readFile(SNAPSHOT_TMP_PATH, {
        encoding: "base64",
      });

      if (!tarFile.content) {
        console.error(`[createAndUploadSnapshot] Failed to read snapshot file`);
        return { success: false };
      }

      // Decode base64 to binary
      const binaryData = Uint8Array.from(atob(tarFile.content), (c) =>
        c.charCodeAt(0)
      );

      // Upload to R2
      await env.SNAPSHOTS.put(snapshotKey, binaryData, {
        customMetadata: metadata,
      });

      uploadResult = {
        success: true,
        snapshotKey,
        size: binaryData.length,
        streaming: false,
      };
    }

    console.log(
      `[createAndUploadSnapshot] Created: ${snapshotKey} (${uploadResult.size} bytes${uploadResult.parts ? `, ${uploadResult.parts} parts` : ""})`
    );
  } finally {
    // Clean up temp file
    await sandbox.exec(`rm -f ${SNAPSHOT_TMP_PATH}`, { timeout: 5000 });
  }

  return uploadResult;
}

// =============================================================================
// CONTAINER LIFECYCLE OPERATIONS
// =============================================================================

export interface DestroyContainerOptions {
  sandbox: Sandbox;
  chatId: string;
}

/**
 * Properly destroy a container with all cleanup.
 * Clears terminal URL cache to prevent stale connections.
 *
 * This should be used by any endpoint that destroys a container
 * to ensure consistent cleanup behavior.
 *
 * Used by: /restart, /factory-reset
 */
export async function destroyContainerWithCleanup(
  options: DestroyContainerOptions
): Promise<void> {
  const { sandbox, chatId } = options;

  // Destroy the container
  await sandbox.destroy();

  // Clear cached terminal URLs (prevents stale WebSocket connections)
  const sandboxId = `chat-${chatId}`;
  clearTerminalUrlCache(sandboxId);

  console.log(`[destroyContainerWithCleanup] Destroyed container and cleared cache for ${sandboxId}`);
}
