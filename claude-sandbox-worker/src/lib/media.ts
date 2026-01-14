/**
 * Media storage utilities for persisting photos, voice, and documents to R2.
 *
 * In production: R2 bucket is mounted at /media via sandbox.mountBucket()
 * In local dev: Falls back to /tmp/media (ephemeral)
 */

import type { Sandbox } from "@cloudflare/sandbox";
import type { ImageData, DocumentData } from "../../../shared/types/api";
import type { Env } from "../types";

// Media directory structure: /media/{chatId}/{senderId}/{type}/
const MEDIA_MOUNT_PATH = "/media";
const LOCAL_FALLBACK_PATH = "/tmp/media";

export interface MediaStorageResult {
  path: string; // Full path to stored file
  type: "photo" | "voice" | "document";
  originalName?: string; // For documents
}

/**
 * Generate a unique filename for media storage.
 * Format: {timestamp}-{uuid}.{ext}
 */
function generateMediaFilename(extension: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const uuid = crypto.randomUUID().slice(0, 8);
  return `${timestamp}-${uuid}.${extension}`;
}

/**
 * Get the storage path for a media file.
 */
function getMediaPath(
  chatId: string,
  senderId: string,
  mediaType: "photos" | "voice" | "documents",
  filename: string,
  isLocalDev: boolean
): string {
  const basePath = isLocalDev ? LOCAL_FALLBACK_PATH : MEDIA_MOUNT_PATH;
  return `${basePath}/${chatId}/${senderId}/${mediaType}/${filename}`;
}

/**
 * Ensure the media directory exists.
 */
async function ensureMediaDir(
  sandbox: Sandbox,
  dirPath: string,
  timeout: number = 5000
): Promise<void> {
  await sandbox.exec(`mkdir -p "${dirPath}"`, { timeout });
}

/**
 * Try to mount the R2 media bucket (production only).
 * Returns true if mounted, false if using local fallback.
 *
 * NOTE: R2 mounting does NOT work in wrangler dev (local development).
 * The mountBucket() call will fail, and we fall back to /tmp/media.
 */
export async function mountMediaBucket(
  sandbox: Sandbox,
  env: Env
): Promise<boolean> {
  // Check if we have the required credentials
  if (
    !env.AWS_ACCESS_KEY_ID ||
    !env.AWS_SECRET_ACCESS_KEY ||
    !env.CLOUDFLARE_ACCOUNT_ID
  ) {
    console.log("[Media] Missing R2 credentials, using local fallback /tmp/media");
    return false;
  }

  try {
    await sandbox.mountBucket("andee-media", MEDIA_MOUNT_PATH, {
      endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
    console.log("[Media] R2 bucket mounted at /media");
    return true;
  } catch (err) {
    // Expected to fail in local dev (FUSE not available)
    console.warn(
      "[Media] R2 mount failed (likely local dev), using fallback /tmp/media:",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

/**
 * Save a photo to media storage.
 * Returns the stored path.
 */
export async function savePhoto(
  sandbox: Sandbox,
  image: ImageData,
  chatId: string,
  senderId: string,
  isLocalDev: boolean
): Promise<MediaStorageResult> {
  // Determine extension from media type
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  const ext = extMap[image.mediaType] || "jpg";
  const filename = generateMediaFilename(ext);
  const fullPath = getMediaPath(chatId, senderId, "photos", filename, isLocalDev);

  // Ensure directory exists
  const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
  await ensureMediaDir(sandbox, dirPath);

  // Write the file (base64 encoded)
  await sandbox.writeFile(fullPath, image.base64, { encoding: "base64" });
  console.log(`[Media] Saved photo: ${fullPath}`);

  return { path: fullPath, type: "photo" };
}

/**
 * Save a voice message (OGG file) to media storage.
 */
export async function saveVoice(
  sandbox: Sandbox,
  audioBase64: string,
  chatId: string,
  senderId: string,
  isLocalDev: boolean
): Promise<MediaStorageResult> {
  const filename = generateMediaFilename("ogg");
  const fullPath = getMediaPath(chatId, senderId, "voice", filename, isLocalDev);

  const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
  await ensureMediaDir(sandbox, dirPath);

  await sandbox.writeFile(fullPath, audioBase64, { encoding: "base64" });
  console.log(`[Media] Saved voice: ${fullPath}`);

  return { path: fullPath, type: "voice" };
}

/**
 * Save a document to media storage.
 */
export async function saveDocument(
  sandbox: Sandbox,
  doc: DocumentData,
  chatId: string,
  senderId: string,
  isLocalDev: boolean
): Promise<MediaStorageResult> {
  // Extract extension from filename or mime type
  let ext = doc.fileName.includes(".")
    ? doc.fileName.split(".").pop() || "bin"
    : "bin";

  // Sanitize extension
  ext = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!ext) ext = "bin";

  const filename = generateMediaFilename(ext);
  const fullPath = getMediaPath(chatId, senderId, "documents", filename, isLocalDev);

  const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
  await ensureMediaDir(sandbox, dirPath);

  await sandbox.writeFile(fullPath, doc.base64, { encoding: "base64" });
  console.log(`[Media] Saved document "${doc.fileName}": ${fullPath}`);

  return { path: fullPath, type: "document", originalName: doc.fileName };
}

/**
 * Save all media from a request.
 * Returns array of stored paths.
 */
export async function saveAllMedia(
  sandbox: Sandbox,
  chatId: string,
  senderId: string,
  isLocalDev: boolean,
  options: {
    images?: ImageData[];
    audioBase64?: string;
    document?: DocumentData;
  }
): Promise<MediaStorageResult[]> {
  const results: MediaStorageResult[] = [];

  // Save photos
  if (options.images && options.images.length > 0) {
    for (const image of options.images) {
      try {
        const result = await savePhoto(sandbox, image, chatId, senderId, isLocalDev);
        results.push(result);
      } catch (err) {
        console.error(`[Media] Failed to save photo:`, err);
        // Continue with other media
      }
    }
  }

  // Save voice (original audio file)
  if (options.audioBase64) {
    try {
      const result = await saveVoice(sandbox, options.audioBase64, chatId, senderId, isLocalDev);
      results.push(result);
    } catch (err) {
      console.error(`[Media] Failed to save voice:`, err);
    }
  }

  // Save document
  if (options.document) {
    try {
      const result = await saveDocument(sandbox, options.document, chatId, senderId, isLocalDev);
      results.push(result);
    } catch (err) {
      console.error(`[Media] Failed to save document:`, err);
    }
  }

  return results;
}
