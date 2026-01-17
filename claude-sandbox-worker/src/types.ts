/**
 * Local type definitions for sandbox-worker.
 */

import type { Sandbox } from "@cloudflare/sandbox";
import type { SchedulerDO } from "./scheduler/SchedulerDO";
import type { RecurringSchedulesDO } from "./scheduler/RecurringSchedulesDO";

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
  // Schedule types
  ScheduleConfig,
  RecurringSchedule,
  ScheduleWithNextRun,
  ScheduleExecution,
  ScheduleExecutionStatus,
  SaveScheduleConfigRequest,
  ExecuteScheduleRequest,
  ScheduledTaskRequest,
  ScheduleResponse,
  GetScheduleConfigResponse,
  ListExecutionsResponse,
} from "../../shared";

export {
  createDefaultSession,
  getSessionKey,
  getSnapshotKey,
  getSnapshotPrefix,
  getSchedulerDOId,
  getRecurringSchedulesDOId,
  getScheduleConfigKey,
} from "../../shared";

/**
 * Environment bindings for the Cloudflare Worker.
 */
export interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  Scheduler: DurableObjectNamespace<SchedulerDO>;
  RecurringSchedules: DurableObjectNamespace<RecurringSchedulesDO>;
  ANTHROPIC_API_KEY: string;
  // OpenRouter toggle for local testing with alternative models
  USE_OPENROUTER?: string; // "true" to enable OpenRouter
  OPENROUTER_API_KEY?: string; // OpenRouter API key
  OPENROUTER_MODEL?: string; // e.g., "z-ai/glm-4.7"
  // Engine selection: claude, goose, or opencode
  USE_ENGINE?: string; // "claude", "goose", or "opencode"
  CEREBRAS_API_KEY?: string; // Cerebras API key for GLM-4.7 (goose/opencode)
  PERPLEXITY_API_KEY?: string; // Perplexity API key for web search MCP
  SESSIONS: R2Bucket;
  SNAPSHOTS: R2Bucket;
  MEDIA: R2Bucket; // Persistent media storage (photos, voice, documents)
  ANDEE_API_KEY?: string;
  AI: Ai; // Workers AI for speech-to-text
  // Debug mode - set to "true" to enable verbose logging
  DEBUG?: string;
  // R2 mounting credentials (for sandbox.mountBucket)
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
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
