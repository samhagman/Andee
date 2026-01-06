/**
 * Configuration constants for Andee.
 *
 * These replace the magic numbers scattered throughout the codebase.
 * Centralized here for easy tuning and consistency.
 */

// ============================================================================
// Container Configuration
// ============================================================================

/**
 * Port the persistent server listens on inside the container.
 * Must match the port used in waitForPort() calls.
 */
export const PERSISTENT_SERVER_PORT = 8080;

/**
 * How long a sandbox container stays alive after inactivity.
 * After this period, the container sleeps and the next message triggers a cold start.
 */
export const SANDBOX_SLEEP_AFTER = "1h";

// ============================================================================
// Telegram Configuration
// ============================================================================

/**
 * Maximum message length for Telegram messages.
 * Telegram's actual limit is 4096, but we use 4000 to leave room
 * for potential escaping overhead.
 */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;

/**
 * Interval for sending typing indicators (in milliseconds).
 * Telegram's typing indicator lasts ~5 seconds, so we refresh every 4.
 */
export const TYPING_INDICATOR_INTERVAL_MS = 4000;

// ============================================================================
// Agent Configuration
// ============================================================================

/**
 * Default model for Claude queries.
 */
export const AGENT_MODEL = "claude-sonnet-4-5";

/**
 * Maximum number of turns (tool calls) per query.
 */
export const AGENT_MAX_TURNS = 25;

/**
 * Timeout for agent queries (in milliseconds).
 * 3 minutes should be enough for most queries.
 */
export const AGENT_TIMEOUT_MS = 180_000;

/**
 * Timeout for server startup/warmup (in milliseconds).
 */
export const SERVER_STARTUP_TIMEOUT_MS = 60_000;

/**
 * Timeout for quick sandbox commands like mkdir (in milliseconds).
 */
export const QUICK_COMMAND_TIMEOUT_MS = 5_000;

/**
 * Timeout for curl commands to internal server (in milliseconds).
 */
export const CURL_TIMEOUT_MS = 10_000;

// ============================================================================
// Paths
// ============================================================================

/**
 * Working directory inside containers.
 */
export const WORKSPACE_DIR = "/workspace";

/**
 * Files directory for user data inside containers.
 */
export const FILES_DIR = "/workspace/files";

/**
 * Log file for Telegram agent.
 */
export const AGENT_LOG_FILE = "/workspace/telegram_agent.log";

// ============================================================================
// Allowed Tools
// ============================================================================

/**
 * Tools allowed for Claude Agent SDK queries.
 */
export const ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Task",
  "Skill",
] as const;

export type AllowedTool = (typeof ALLOWED_TOOLS)[number];
