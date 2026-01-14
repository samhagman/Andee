/**
 * Snapshot preview endpoints for browsing snapshot contents without restoring.
 *
 * GET /snapshot-files - List files in a snapshot's tar archive
 * GET /snapshot-file  - Read a single file from a snapshot's tar archive
 */

import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import {
  CORS_HEADERS,
  HandlerContext,
  Env,
  getSnapshotPrefix,
} from "../types";
import { SANDBOX_SLEEP_AFTER } from "../../../shared/config";

// Preview cache configuration
const PREVIEW_CACHE_DIR = "/tmp";
const PREVIEW_CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Generate a deterministic cache filename for a snapshot key.
 * Uses base64 encoding to prevent path traversal attacks.
 * Works in Cloudflare Workers (no Node.js crypto/Buffer).
 */
function getCacheFilename(snapshotKey: string): string {
  // Use btoa for base64 encoding (Web API, available in Workers)
  // Replace unsafe filesystem chars
  const safeKey = btoa(snapshotKey).replace(/[/+=]/g, "_");
  return `${PREVIEW_CACHE_DIR}/preview-${safeKey.slice(0, 64)}.tar.gz`;
}

/**
 * Validate that a snapshot key belongs to the expected sandbox.
 * Prevents users from accessing other users' snapshots.
 */
function validateSnapshotAccess(
  snapshotKey: string,
  chatId: string,
  senderId: string | undefined,
  isGroup: boolean | undefined
): boolean {
  try {
    const expectedPrefix = getSnapshotPrefix(chatId, senderId, isGroup);
    return snapshotKey.startsWith(expectedPrefix);
  } catch {
    return false;
  }
}

/**
 * Ensure snapshot is cached in container. Downloads from R2 if not present.
 * Cleans up old previews before caching new ones.
 */
async function ensureSnapshotCached(
  sandbox: Sandbox,
  env: Env,
  snapshotKey: string
): Promise<string> {
  const cacheFile = getCacheFilename(snapshotKey);

  // Check if already cached
  const checkResult = await sandbox.exec(`test -f ${cacheFile} && echo "EXISTS"`, {
    timeout: 5000,
  });

  if (checkResult.stdout.includes("EXISTS")) {
    console.log(`[SnapshotPreview] Using cached snapshot: ${cacheFile}`);
    return cacheFile;
  }

  // Clean up old preview files (older than 30 min)
  console.log(`[SnapshotPreview] Cleaning up old preview files...`);
  await sandbox.exec(
    `find ${PREVIEW_CACHE_DIR} -name 'preview-*.tar.gz' -mmin +30 -delete 2>/dev/null || true`,
    { timeout: 10000 }
  );

  // Download snapshot from R2
  console.log(`[SnapshotPreview] Downloading snapshot: ${snapshotKey}`);
  const object = await env.SNAPSHOTS.get(snapshotKey);

  if (!object) {
    throw new Error(`Snapshot not found: ${snapshotKey}`);
  }

  // Convert to base64 for writing to container
  // Use chunked approach to avoid stack overflow with large files
  const arrayBuffer = await object.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const CHUNK_SIZE = 32768; // 32KB chunks
  let binaryString = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binaryString += String.fromCharCode.apply(null, Array.from(chunk));
  }
  const base64Data = btoa(binaryString);

  // Write to container
  await sandbox.writeFile(cacheFile, base64Data, { encoding: "base64" });
  console.log(`[SnapshotPreview] Cached snapshot at: ${cacheFile} (${arrayBuffer.byteLength} bytes)`);

  return cacheFile;
}

/**
 * Parse tar listing output into file entries.
 * tar -tzf outputs paths like: workspace/file.txt, home/claude/.bashrc
 */
function parseTarListing(
  output: string,
  requestedPath: string
): Array<{
  name: string;
  type: "file" | "directory";
  path: string;
}> {
  const lines = output.trim().split("\n").filter(Boolean);
  const entriesMap = new Map<string, { name: string; type: "file" | "directory"; path: string }>();

  // Normalize requested path (remove leading slash, ensure trailing slash for dirs)
  let normalizedPath = requestedPath.replace(/^\//, "");
  if (normalizedPath && !normalizedPath.endsWith("/")) {
    normalizedPath += "/";
  }

  // Handle root path
  if (normalizedPath === "/" || normalizedPath === "") {
    normalizedPath = "";
  }

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // tar outputs paths without leading slash
    const tarPath = line.trim();

    // Check if this entry is under the requested path
    if (normalizedPath && !tarPath.startsWith(normalizedPath)) {
      continue;
    }

    // Get the relative path from the requested directory
    const relativePath = normalizedPath
      ? tarPath.slice(normalizedPath.length)
      : tarPath;

    if (!relativePath) continue;

    // Get the immediate child (first path component)
    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    const childName = parts[0];

    // Determine if this is a directory (has more parts or ends with /)
    const isDirectory = parts.length > 1 || tarPath.endsWith("/");

    // Build the full path for this entry (with leading slash for display)
    const fullPath = "/" + (normalizedPath + childName).replace(/\/$/, "");

    // Add to map (directories may appear multiple times due to their contents)
    if (!entriesMap.has(childName)) {
      entriesMap.set(childName, {
        name: childName,
        type: isDirectory ? "directory" : "file",
        path: fullPath,
      });
    } else if (isDirectory) {
      // Update to directory if we see evidence this is a directory
      entriesMap.get(childName)!.type = "directory";
    }
  }

  // Sort: directories first, then alphabetically
  const entries = Array.from(entriesMap.values());
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

/**
 * GET /snapshot-files - List files in a snapshot's tar archive.
 * Query params: sandbox, snapshotKey, path, chatId, senderId, isGroup
 */
export async function handleSnapshotFiles(ctx: HandlerContext): Promise<Response> {
  try {
    const sandboxId = ctx.url.searchParams.get("sandbox");
    const snapshotKey = ctx.url.searchParams.get("snapshotKey");
    const path = ctx.url.searchParams.get("path") || "/";
    const chatId = ctx.url.searchParams.get("chatId");
    const senderId = ctx.url.searchParams.get("senderId") || undefined;
    const isGroup = ctx.url.searchParams.get("isGroup") === "true";

    if (!sandboxId || !snapshotKey) {
      return Response.json(
        { error: "Missing sandbox or snapshotKey parameter" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Validate snapshot access if chatId is provided
    if (chatId && !validateSnapshotAccess(snapshotKey, chatId, senderId, isGroup)) {
      return Response.json(
        { error: "Access denied to this snapshot" },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    const sandbox = getSandbox(ctx.env.Sandbox, sandboxId, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Ensure snapshot is cached
    const cacheFile = await ensureSnapshotCached(sandbox, ctx.env, snapshotKey);

    // List tar contents
    const listResult = await sandbox.exec(`tar -tzf ${cacheFile}`, {
      timeout: 30000,
    });

    if (listResult.exitCode !== 0) {
      console.error(`[SnapshotPreview] tar -tzf failed: ${listResult.stderr}`);
      return Response.json(
        { error: "Failed to list snapshot contents", detail: listResult.stderr },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Parse the listing for the requested path
    const entries = parseTarListing(listResult.stdout, path);

    return Response.json(
      { path, entries, snapshotKey },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[SnapshotPreview] Files error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /snapshot-file - Read a single file from a snapshot's tar archive.
 * Query params: sandbox, snapshotKey, path, chatId, senderId, isGroup
 */
export async function handleSnapshotFile(ctx: HandlerContext): Promise<Response> {
  try {
    const sandboxId = ctx.url.searchParams.get("sandbox");
    const snapshotKey = ctx.url.searchParams.get("snapshotKey");
    const path = ctx.url.searchParams.get("path");
    const chatId = ctx.url.searchParams.get("chatId");
    const senderId = ctx.url.searchParams.get("senderId") || undefined;
    const isGroup = ctx.url.searchParams.get("isGroup") === "true";

    if (!sandboxId || !snapshotKey || !path) {
      return Response.json(
        { error: "Missing sandbox, snapshotKey, or path parameter" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Validate snapshot access if chatId is provided
    if (chatId && !validateSnapshotAccess(snapshotKey, chatId, senderId, isGroup)) {
      return Response.json(
        { error: "Access denied to this snapshot" },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    const sandbox = getSandbox(ctx.env.Sandbox, sandboxId, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // Ensure snapshot is cached
    const cacheFile = await ensureSnapshotCached(sandbox, ctx.env, snapshotKey);

    // Convert path: /workspace/foo → workspace/foo (tar format has no leading slash)
    const tarPath = path.replace(/^\//, "");

    // Check if file exists in tar
    const checkResult = await sandbox.exec(
      `tar -tzf ${cacheFile} | grep -x '${tarPath}' || echo "NOT_FOUND"`,
      { timeout: 10000 }
    );

    if (checkResult.stdout.includes("NOT_FOUND")) {
      return Response.json(
        { error: "File not found in snapshot", path },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Check if it's a directory
    if (tarPath.endsWith("/") || checkResult.stdout.trim().endsWith("/")) {
      return Response.json(
        { error: "Path is a directory, not a file", path },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Extract file content
    // Note: tar -xzOf extracts to stdout
    const extractResult = await sandbox.exec(
      `tar -xzOf ${cacheFile} '${tarPath}'`,
      { timeout: 30000 }
    );

    if (extractResult.exitCode !== 0) {
      console.error(`[SnapshotPreview] Extract failed: ${extractResult.stderr}`);
      return Response.json(
        { error: "Failed to extract file", detail: extractResult.stderr },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Detect if binary and encode appropriately
    const isBinary = isBinaryFile(path);
    let content: string;
    let encoding: "utf-8" | "base64";

    if (isBinary) {
      // Re-extract with base64 encoding
      const base64Result = await sandbox.exec(
        `tar -xzOf ${cacheFile} '${tarPath}' | base64`,
        { timeout: 30000 }
      );
      content = base64Result.stdout;
      encoding = "base64";
    } else {
      content = extractResult.stdout;
      encoding = "utf-8";
    }

    return Response.json(
      { path, content, encoding, snapshotKey },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[SnapshotPreview] File error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * Check if file is likely binary based on extension.
 */
function isBinaryFile(path: string): boolean {
  const binaryExtensions = [
    ".tar",
    ".gz",
    ".zip",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".pdf",
    ".exe",
    ".bin",
    ".so",
    ".dylib",
    ".mv2",
    ".wasm",
  ];
  return binaryExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}
