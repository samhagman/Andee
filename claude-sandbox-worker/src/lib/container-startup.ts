/**
 * Shared container startup logic.
 * Used by both /ask (cold start) and /factory-reset (auto-wake).
 */

import { type Sandbox } from "@cloudflare/sandbox";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  Env,
  getSnapshotPrefix,
} from "../types";
import {
  PERSISTENT_SERVER_PORT,
  QUICK_COMMAND_TIMEOUT_MS,
  SERVER_STARTUP_TIMEOUT_MS,
  SNAPSHOT_TMP_PATH,
  SNAPSHOT_CURL_TIMEOUT_MS,
  TAR_TIMEOUT_MS,
  buildRestoreExcludeFlags,
} from "../../../shared/config";
import { PERSISTENT_SERVER_SCRIPT } from "../scripts";

/** R2 bucket name for snapshots */
const SNAPSHOT_BUCKET_NAME = "andee-snapshots";

export interface StartupResult {
  restored: boolean;
  serverPid: number;
  serverReady: boolean;
}

/**
 * Build environment variables for Claude SDK based on provider toggle.
 * When USE_OPENROUTER=true, routes to OpenRouter with specified model.
 * Otherwise, uses Anthropic directly.
 */
export function buildSdkEnv(env: Env, userTimezone: string): Record<string, string> {
  const baseEnv: Record<string, string> = {
    HOME: "/home/claude",
    TZ: userTimezone,
    // Always include OPENROUTER_API_KEY for analyze-video skill (Gemini via OpenRouter)
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY || "",
  };

  if (env.USE_OPENROUTER === "true") {
    // OpenRouter mode - route SDK through openrouter.ai
    console.log(`[Worker] Using OpenRouter with model: ${env.OPENROUTER_MODEL || "z-ai/glm-4.7"}`);
    return {
      ...baseEnv,
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: env.OPENROUTER_API_KEY || "",
      ANTHROPIC_API_KEY: "", // Must be blank for OpenRouter
      ANTHROPIC_DEFAULT_SONNET_MODEL: env.OPENROUTER_MODEL || "z-ai/glm-4.7",
    };
  } else {
    // Anthropic direct mode (default)
    return {
      ...baseEnv,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    };
  }
}

/**
 * Generate a presigned URL for downloading a snapshot from R2.
 * Uses S3-compatible API since R2 Workers API lacks getSignedUrl().
 */
async function generatePresignedUrl(
  env: Env,
  snapshotKey: string,
  expiresInSeconds: number = 300
): Promise<string> {
  const s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  const command = new GetObjectCommand({
    Bucket: SNAPSHOT_BUCKET_NAME,
    Key: snapshotKey,
  });

  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

/**
 * Restore filesystem from the latest snapshot using container-direct download.
 * Uses presigned URL so container can curl directly from R2, bypassing Worker memory.
 *
 * This approach:
 * - Bypasses sandbox.writeFile() RPC size limits completely
 * - No base64 encoding overhead (33% savings)
 * - Worker sends only ~256 byte URL, not entire file
 * - Can restore snapshots of ANY size
 */
export async function restoreFromSnapshot(
  sandbox: InstanceType<typeof Sandbox>,
  chatId: string,
  senderId: string | undefined,
  isGroup: boolean | undefined,
  env: Env
): Promise<boolean> {
  if (!env.SNAPSHOTS) {
    console.log(`[Worker] SNAPSHOTS binding not available, skipping restore`);
    return false;
  }

  // Check if R2 credentials are available for presigned URLs
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.CLOUDFLARE_ACCOUNT_ID) {
    console.warn("[Worker] R2 credentials not available, cannot generate presigned URL");
    return false;
  }

  try {
    // 1. Find latest snapshot
    const prefix = getSnapshotPrefix(chatId, senderId, isGroup);
    const listResult = await env.SNAPSHOTS.list({ prefix });

    if (listResult.objects.length === 0) {
      console.log(`[Worker] No snapshots found for chat ${chatId}`);
      return false;
    }

    // Get latest snapshot (sorted by key which includes timestamp)
    const sortedObjects = listResult.objects.sort((a, b) => b.key.localeCompare(a.key));
    const latestKey = sortedObjects[0].key;
    const snapshotSize = sortedObjects[0].size;

    console.log(`[Worker] Restoring from snapshot: ${latestKey} (${(snapshotSize / 1024 / 1024).toFixed(1)}MB)`);

    // 2. Generate presigned URL (5 minute expiry)
    const presignedUrl = await generatePresignedUrl(env, latestKey, 300);
    // SECURITY: Don't log the full URL (contains auth signature)
    console.log(`[Worker] Generated presigned URL for snapshot download`);

    // 3. Write URL to temp file to avoid shell interpolation issues
    // (presigned URLs contain & and ? which can be misinterpreted by shell)
    const urlTmpFile = "/tmp/snapshot-url.txt";
    await sandbox.writeFile(urlTmpFile, presignedUrl);

    // 4. Container downloads directly via curl (reading URL from file)
    // --fail: return error on HTTP errors
    // --silent: no progress meter
    // --show-error: show errors when silent
    // --location: follow redirects
    // --retry: retry on transient failures
    // --max-time: total timeout in seconds
    const curlTimeoutSeconds = Math.ceil(SNAPSHOT_CURL_TIMEOUT_MS / 1000);
    const tmpPath = `${SNAPSHOT_TMP_PATH}.tmp`; // Download to .tmp first for atomic operation
    const curlResult = await sandbox.exec(
      `curl --fail --silent --show-error --location --retry 3 --retry-delay 1 --max-time ${curlTimeoutSeconds} "$(cat ${urlTmpFile})" -o ${tmpPath} && mv ${tmpPath} ${SNAPSHOT_TMP_PATH}`,
      { timeout: SNAPSHOT_CURL_TIMEOUT_MS + 30000 } // exec timeout with buffer for retries
    );

    // Clean up URL file immediately (contains auth signature)
    await sandbox.exec(`rm -f ${urlTmpFile}`, { timeout: 5000 });

    if (curlResult.exitCode !== 0) {
      console.error(`[Worker] Snapshot download failed: ${curlResult.stderr}`);
      await sandbox.exec(`rm -f ${tmpPath}`, { timeout: 5000 }); // Clean up partial download
      return false;
    }

    console.log(`[Worker] Snapshot downloaded to container`);

    // 5. Extract snapshot (excluding system files that come from Dockerfile)
    const restoreExcludes = buildRestoreExcludeFlags();
    const extractResult = await sandbox.exec(
      `cd / && tar -xzf ${SNAPSHOT_TMP_PATH} ${restoreExcludes}`,
      { timeout: TAR_TIMEOUT_MS }
    );

    if (extractResult.exitCode !== 0) {
      console.error(`[Worker] Snapshot extract failed: ${extractResult.stderr}`);
      return false;
    }

    // 6. Clean up temp file
    await sandbox.exec(`rm -f ${SNAPSHOT_TMP_PATH}`, { timeout: 5000 });

    console.log(`[Worker] Snapshot restored successfully for chat ${chatId}`);
    return true;
  } catch (error) {
    console.error(`[Worker] Restore error:`, error);
    return false;
  }
}

/**
 * Read user timezone from preferences file.
 * Returns "UTC" if not found or on error.
 */
export async function readUserTimezone(
  sandbox: InstanceType<typeof Sandbox>,
  senderId: string | undefined
): Promise<string> {
  if (!senderId) {
    return "UTC";
  }

  try {
    const prefsPath = `/home/claude/private/${senderId}/preferences.yaml`;
    const prefsResult = await sandbox.exec(
      `cat ${prefsPath} 2>/dev/null || echo ""`,
      { timeout: QUICK_COMMAND_TIMEOUT_MS }
    );

    if (prefsResult.stdout.includes("timezone:")) {
      const match = prefsResult.stdout.match(/timezone:\s*([^\n]+)/);
      if (match) {
        const timezone = match[1].trim();
        console.log(`[Worker] User ${senderId} timezone: ${timezone}`);
        return timezone;
      }
    }
  } catch (error) {
    console.warn(`[Worker] Failed to read user timezone:`, error);
  }

  return "UTC";
}

/**
 * Start the persistent server in a container.
 * Handles restore, timezone, script writing, and server startup.
 *
 * @param sandbox - The sandbox instance
 * @param chatId - Chat ID for this container
 * @param senderId - Sender ID (optional, for private chats)
 * @param isGroup - Whether this is a group chat
 * @param env - Environment bindings
 * @returns StartupResult with restored status, server PID, and ready status
 */
export async function startContainer(
  sandbox: InstanceType<typeof Sandbox>,
  chatId: string,
  senderId: string | undefined,
  isGroup: boolean | undefined,
  env: Env
): Promise<StartupResult> {
  console.log(`[Worker] Starting container for chat ${chatId}`);

  // 1. Restore from snapshot if available
  const restored = await restoreFromSnapshot(sandbox, chatId, senderId, isGroup, env);
  if (restored) {
    console.log(`[Worker] Filesystem restored from snapshot for chat ${chatId}`);
  }

  // 2. Read user timezone from preferences
  const userTimezone = await readUserTimezone(sandbox, senderId);

  // 3. Write the persistent server script
  await sandbox.writeFile(
    "/workspace/persistent_server.mjs",
    PERSISTENT_SERVER_SCRIPT
  );

  // 4. Ensure workspace/files directory exists
  await sandbox.exec("mkdir -p /workspace/files", {
    timeout: QUICK_COMMAND_TIMEOUT_MS,
  });

  // 5. Start the persistent server with proper environment variables
  const server = await sandbox.startProcess(
    "node /workspace/persistent_server.mjs",
    {
      env: buildSdkEnv(env, userTimezone),
    }
  );

  // 6. Wait for server to be ready on configured port
  console.log(`[Worker] Waiting for server to be ready on port ${PERSISTENT_SERVER_PORT}...`);
  await server.waitForPort(PERSISTENT_SERVER_PORT, {
    path: "/health",
    timeout: SERVER_STARTUP_TIMEOUT_MS,
    status: { min: 200, max: 299 },
  });

  console.log(`[Worker] Persistent server ready for chat ${chatId} (pid: ${server.pid})`);

  return {
    restored,
    serverPid: server.pid,
    serverReady: true,
  };
}
