/**
 * Local type definitions for sandbox-worker.
 */

import type { Sandbox } from "@cloudflare/sandbox";

// Re-export shared types for convenience
export type {
  SessionData,
  AskRequest,
  AskTelegramRequest,
  ResetRequest,
  SessionUpdateRequest,
  SnapshotRequest,
  AgentOutput,
  StreamingProgress,
} from "../../shared";

export {
  createDefaultSession,
  getSessionKey,
  getSnapshotKey,
  getSnapshotPrefix,
} from "../../shared";

/**
 * Environment bindings for the Cloudflare Worker.
 */
export interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ANTHROPIC_API_KEY: string;
  SESSIONS: R2Bucket;
  SNAPSHOTS: R2Bucket;
  ANDEE_API_KEY?: string;
}

/**
 * Standard CORS headers for API responses.
 */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

/**
 * Handler context passed to each endpoint handler.
 */
export interface HandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

/**
 * Type for endpoint handler functions.
 */
export type EndpointHandler = (ctx: HandlerContext) => Promise<Response>;
