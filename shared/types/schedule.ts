/**
 * Recurring schedule types for proactive messaging.
 * Used by RecurringSchedulesDO to manage recurring prompts.
 */

/**
 * Schedule execution status lifecycle:
 * - pending: Waiting for next run
 * - running: Currently executing
 * - completed: Last execution succeeded
 * - failed: Last execution failed
 */
export type ScheduleExecutionStatus = "pending" | "running" | "completed" | "failed";

/**
 * A single recurring schedule definition.
 * This is the parsed form of what's in the YAML.
 */
export interface RecurringSchedule {
  id: string;              // Unique ID (kebab-case, e.g., "morning-weather")
  description: string;     // Human-readable description
  cron: string;            // Cron expression (e.g., "0 6 * * *")
  enabled: boolean;        // Whether schedule is active
  prompt: string;          // Prompt to send to Andee when triggered
}

/**
 * Full schedule config as stored in R2.
 * This is the YAML structure.
 */
export interface ScheduleConfig {
  version: string;         // Schema version (e.g., "1.0")
  timezone: string;        // IANA timezone (e.g., "America/New_York")
  schedules: Record<string, Omit<RecurringSchedule, 'id'>>;
}

/**
 * SQLite row type for schedules table.
 */
export interface ScheduleRow {
  id: string;
  description: string;
  cron: string;
  timezone: string;
  prompt: string;
  enabled: number;         // SQLite doesn't have boolean
  next_run_at: number;     // Unix timestamp in ms
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * SQLite row type for executions table.
 */
export interface ExecutionRow {
  id: string;
  schedule_id: string;
  executed_at: number;     // Unix timestamp in ms
  status: string;          // ScheduleExecutionStatus
  error: string | null;
  duration_ms: number | null;
}

/**
 * Execution record returned by API.
 */
export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  executedAt: number;
  status: ScheduleExecutionStatus;
  error?: string;
  durationMs?: number;
}

/**
 * Schedule with computed next run info.
 */
export interface ScheduleWithNextRun extends RecurringSchedule {
  timezone: string;
  nextRunAt: number | null;  // Unix timestamp in ms
  lastRunAt: number | null;
}

/**
 * Request to save schedule config.
 * PUT /schedule-config
 */
export interface SaveScheduleConfigRequest {
  chatId: string;
  config: ScheduleConfig;
  botToken: string;        // Needed for execution
}

/**
 * Request to execute a schedule immediately.
 * POST /execute-schedule
 */
export interface ExecuteScheduleRequest {
  chatId: string;
  scheduleId: string;
  botToken: string;
}

/**
 * Request to run a scheduled task (internal, from DO to worker).
 * POST /scheduled-task
 */
export interface ScheduledTaskRequest {
  chatId: string;
  senderId: string;        // "system" for scheduled tasks
  isGroup: boolean;
  scheduleId: string;
  prompt: string;
  botToken: string;
}

/**
 * Response from schedule operations.
 */
export interface ScheduleResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Response from getting schedule config.
 */
export interface GetScheduleConfigResponse extends ScheduleResponse {
  config?: ScheduleConfig;
  schedules?: ScheduleWithNextRun[];
}

/**
 * Response from listing executions.
 */
export interface ListExecutionsResponse extends ScheduleResponse {
  executions: ScheduleExecution[];
}

/**
 * Generates the RecurringSchedulesDO ID for a chat.
 * One RecurringSchedulesDO per chat (chatId).
 */
export function getRecurringSchedulesDOId(chatId: string): string {
  return `recurring-${chatId}`;
}

/**
 * Generates the R2 key for schedule config.
 */
export function getScheduleConfigKey(chatId: string): string {
  return `schedules/${chatId}/recurring.yaml`;
}
