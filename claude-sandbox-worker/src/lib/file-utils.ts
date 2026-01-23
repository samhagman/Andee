/**
 * File utility functions for IDE and snapshot preview handlers.
 */

/**
 * Binary file extensions that should not be displayed as text.
 * These files are base64-encoded when read for API responses.
 */
const BINARY_EXTENSIONS = [
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
  ".ico",
  ".webp",
];

/**
 * Check if file is likely binary based on extension.
 * Used to determine whether to base64-encode file contents.
 *
 * @example
 * isBinaryFile("/path/to/image.png")  // true
 * isBinaryFile("/path/to/code.ts")    // false
 * isBinaryFile("/path/to/data.mv2")   // true
 */
export function isBinaryFile(path: string): boolean {
  return BINARY_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

/**
 * Convert Uint8Array to base64 string using chunked approach
 * to avoid stack overflow with large arrays.
 *
 * The default chunk size of 32KB is safe for most JavaScript engines.
 * Larger chunks may cause "Maximum call stack size exceeded" errors.
 *
 * @param bytes - The byte array to encode
 * @param chunkSize - Size of chunks to process (default: 32768)
 */
export function uint8ArrayToBase64(
  bytes: Uint8Array,
  chunkSize = 32768
): string {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binaryString += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binaryString);
}
