/**
 * URL data extraction utilities for Mini App components.
 *
 * Components receive data via URL hash: #data={base64url}
 * This is how the shell router passes data to components.
 */

import { decode } from "./base64url";

export interface DataResult<T> {
  data: T | null;
  error: Error | null;
  source: "hash" | "query" | "none";
}

/**
 * Extract and decode data from URL.
 * Tries hash first (Telegram's preferred method), then query params.
 */
export function getData<T = unknown>(): DataResult<T> {
  // Try hash first (Telegram's method)
  const hash = location.hash.slice(1); // Remove leading #
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    const dataParam = hashParams.get("data");
    if (dataParam) {
      try {
        return { data: decode<T>(dataParam), source: "hash", error: null };
      } catch (e) {
        return { data: null, source: "hash", error: e as Error };
      }
    }
  }

  // Fallback to query params
  const searchParams = new URLSearchParams(location.search);
  const dataParam = searchParams.get("data");
  if (dataParam) {
    try {
      return { data: decode<T>(dataParam), source: "query", error: null };
    } catch (e) {
      return { data: null, source: "query", error: e as Error };
    }
  }

  return { data: null, source: "none", error: null };
}
