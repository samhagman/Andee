/**
 * R2 utilities for snapshot and media operations.
 *
 * Consolidates R2-related constants and presigned URL generation
 * that were previously duplicated across multiple files.
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../types";

/** R2 bucket name for snapshots (filesystem backups) */
export const SNAPSHOT_BUCKET_NAME = "andee-snapshots";

/** R2 bucket name for media files (photos, voice, documents) */
export const MEDIA_BUCKET_NAME = "andee-media";

/**
 * Generate a presigned URL for downloading from R2.
 * Uses S3-compatible API since R2 Workers API lacks getSignedUrl().
 *
 * The presigned URL allows containers to download directly from R2,
 * bypassing Worker memory limits (which would crash on >10MB files).
 *
 * @param env - Environment bindings with R2 credentials
 * @param key - The R2 object key to generate URL for
 * @param expiresInSeconds - URL expiration time (default: 5 minutes)
 * @returns Presigned URL for downloading the object
 *
 * @throws Error if R2 credentials are not configured
 */
export async function generatePresignedUrl(
  env: Env,
  key: string,
  expiresInSeconds: number = 300
): Promise<string> {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error("R2 credentials not configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID)");
  }

  const s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const command = new GetObjectCommand({
    Bucket: SNAPSHOT_BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

// ============================================================================
// Terminal URL Storage
// ============================================================================
// These functions persist exposed terminal URLs in R2 so they survive across
// Worker isolates. This prevents the bug where different Workers re-expose
// the same port, generating new tokens and killing existing WebSocket connections.

/** R2 key prefix for terminal URLs */
const TERMINAL_URL_PREFIX = "terminal-urls/";

/** Default TTL for terminal URLs: 55 minutes (sandbox sleeps after 1 hour) */
const DEFAULT_TERMINAL_URL_TTL_MS = 55 * 60 * 1000;

/** Terminal URL storage format */
interface StoredTerminalUrl {
  url: string;
  exposedAt: number;
  expiresAt: number;
}

/**
 * Get stored terminal URL from R2.
 *
 * @param bucket - R2 bucket binding
 * @param sandboxId - The sandbox ID
 * @returns The stored WebSocket URL, or null if not found or expired
 */
export async function getTerminalUrl(
  bucket: R2Bucket,
  sandboxId: string
): Promise<string | null> {
  const key = `${TERMINAL_URL_PREFIX}${sandboxId}.json`;

  try {
    const object = await bucket.get(key);
    if (!object) {
      return null;
    }

    const text = await object.text();
    const data = JSON.parse(text) as StoredTerminalUrl;

    // Check if expired
    if (data.expiresAt && data.expiresAt < Date.now()) {
      console.log(`[R2] Terminal URL for ${sandboxId} expired, deleting`);
      await bucket.delete(key);
      return null;
    }

    return data.url;
  } catch (error) {
    console.error(`[R2] Failed to get terminal URL for ${sandboxId}:`, error);
    return null;
  }
}

/**
 * Store terminal URL in R2.
 *
 * @param bucket - R2 bucket binding
 * @param sandboxId - The sandbox ID
 * @param url - The WebSocket URL to store
 * @param ttlMs - Time-to-live in milliseconds (default: 55 minutes)
 */
export async function storeTerminalUrl(
  bucket: R2Bucket,
  sandboxId: string,
  url: string,
  ttlMs: number = DEFAULT_TERMINAL_URL_TTL_MS
): Promise<void> {
  const key = `${TERMINAL_URL_PREFIX}${sandboxId}.json`;
  const now = Date.now();

  const data: StoredTerminalUrl = {
    url,
    exposedAt: now,
    expiresAt: now + ttlMs,
  };

  try {
    await bucket.put(key, JSON.stringify(data), {
      httpMetadata: { contentType: "application/json" },
    });
    console.log(`[R2] Stored terminal URL for ${sandboxId}, expires in ${ttlMs / 1000 / 60} minutes`);
  } catch (error) {
    console.error(`[R2] Failed to store terminal URL for ${sandboxId}:`, error);
    throw error;
  }
}

/**
 * Clear stored terminal URL from R2.
 * Call this when the container restarts or is destroyed.
 *
 * @param bucket - R2 bucket binding
 * @param sandboxId - The sandbox ID
 */
export async function clearTerminalUrl(
  bucket: R2Bucket,
  sandboxId: string
): Promise<void> {
  const key = `${TERMINAL_URL_PREFIX}${sandboxId}.json`;

  try {
    await bucket.delete(key);
    console.log(`[R2] Cleared terminal URL for ${sandboxId}`);
  } catch (error) {
    console.error(`[R2] Failed to clear terminal URL for ${sandboxId}:`, error);
    // Don't throw - clearing is best-effort
  }
}
