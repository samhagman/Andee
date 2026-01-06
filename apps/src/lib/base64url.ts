/**
 * Base64url encoding/decoding utilities.
 *
 * Base64url is a URL-safe variant of base64 that:
 * - Uses - instead of +
 * - Uses _ instead of /
 * - Omits padding (=)
 */

/**
 * Decode a base64url string to an object.
 * Handles padding and character replacement automatically.
 */
export function decode<T = unknown>(b64url: string): T {
  // Clean any whitespace
  const clean = b64url.replace(/\s/g, "");

  // Convert base64url to standard base64
  let b64 = clean.replace(/-/g, "+").replace(/_/g, "/");

  // Add padding if needed
  const pad = b64.length % 4;
  if (pad) {
    b64 += "=".repeat(4 - pad);
  }

  // Decode and parse
  const json = atob(b64);
  return JSON.parse(json) as T;
}

/**
 * Encode an object to a base64url string.
 * Used by skills to generate Mini App links.
 */
export function encode(data: unknown): string {
  const json = JSON.stringify(data);
  const b64 = btoa(json);

  // Convert to URL-safe variant
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
