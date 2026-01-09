/**
 * Local type definitions for sandbox-worker.
 */

import type { Sandbox } from "@cloudflare/sandbox";
import type { SchedulerDO } from "./scheduler/SchedulerDO";

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
  ReminderData,
  ReminderStatus,
  ScheduleReminderRequest,
  CancelReminderRequest,
  CompleteReminderRequest,
  ListRemindersRequest,
  ReminderResponse,
  ListRemindersResponse,
} from "../../shared";

export {
  createDefaultSession,
  getSessionKey,
  getSnapshotKey,
  getSnapshotPrefix,
  getSchedulerDOId,
} from "../../shared";

/**
 * Environment bindings for the Cloudflare Worker.
 */
export interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  Scheduler: DurableObjectNamespace<SchedulerDO>;
  ANTHROPIC_API_KEY: string;
  SESSIONS: R2Bucket;
  SNAPSHOTS: R2Bucket;
  ANDEE_API_KEY?: string;
  AI: Ai; // Workers AI for speech-to-text
}

/**
 * Standard CORS headers for API responses.
 */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Cf-Access-Jwt-Assertion",
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
