/**
 * Debug logging utility for Claude Sandbox Worker.
 *
 * Toggle debug mode via environment variable:
 *   - Set DEBUG=true in wrangler.toml or .dev.vars
 *
 * All debug logs are prefixed with [DEBUG] for easy filtering.
 * In production, logs go to Cloudflare's logging system.
 */

// Debug mode is enabled via environment variable
let debugEnabled = false;

/**
 * Initialize debug mode from environment.
 * Call this at the start of request handling.
 */
export function initDebug(env: { DEBUG?: string }): void {
  debugEnabled = env.DEBUG === 'true';
}

/**
 * Check if debug mode is enabled.
 */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/**
 * Log levels for structured logging.
 */
type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'api' | 'flow';

interface LogContext {
  component?: string;
  action?: string;
  sandboxId?: string;
  chatId?: string;
  [key: string]: unknown;
}

/**
 * Format log message with context.
 */
function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const prefix = context?.component ? `[${context.component}]` : '[Debug]';
  const actionStr = context?.action ? ` (${context.action})` : '';
  const sandboxStr = context?.sandboxId ? ` sandbox=${context.sandboxId}` : '';
  const chatStr = context?.chatId ? ` chat=${context.chatId}` : '';

  return `[DEBUG] ${timestamp} ${prefix}${actionStr}${sandboxStr}${chatStr} ${message}`;
}

/**
 * Main debug logging function.
 * Only logs when debug mode is enabled.
 */
function log(level: LogLevel, message: string, context?: LogContext): void {
  if (!debugEnabled) return;

  const formattedMessage = formatLog(level, message, context);

  // Extract data from context for structured logging
  const { component, action, sandboxId, chatId, ...data } = context || {};

  const logFn = level === 'error' ? console.error :
                level === 'warn' ? console.warn : console.log;

  if (Object.keys(data).length > 0) {
    logFn(formattedMessage, JSON.stringify(data, null, 2));
  } else {
    logFn(formattedMessage);
  }
}

/**
 * Log sandbox operations.
 */
function logSandbox(
  action: string,
  sandboxId: string,
  details: Record<string, unknown> = {}
): void {
  log('flow', action, { component: 'Sandbox', action, sandboxId, ...details });
}

/**
 * Log snapshot operations.
 */
function logSnapshot(
  action: string,
  chatId: string,
  details: Record<string, unknown> = {}
): void {
  log('flow', action, { component: 'Snapshot', action, chatId, ...details });
}

/**
 * Log IDE file operations.
 */
function logIde(
  action: string,
  sandboxId: string,
  details: Record<string, unknown> = {}
): void {
  log('flow', action, { component: 'IDE', action, sandboxId, ...details });
}

/**
 * Log API request handling.
 */
function logRequest(
  method: string,
  path: string,
  status: number,
  durationMs: number,
  details?: Record<string, unknown>
): void {
  const statusLevel: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'api';
  log(statusLevel, `${method} ${path} → ${status} (${durationMs}ms)`, {
    component: 'Request',
    method,
    path,
    status,
    durationMs,
    ...details,
  });
}

/**
 * Log with timing measurement.
 * Returns a function to call when the operation completes.
 */
function startTimer(
  component: string,
  action: string,
  context?: Record<string, unknown>
): (result?: Record<string, unknown>) => void {
  const startTime = Date.now();

  if (debugEnabled) {
    log('flow', `Starting: ${action}`, { component, action, ...context });
  }

  return (result?: Record<string, unknown>) => {
    const duration = Date.now() - startTime;
    log('success', `Completed: ${action} (${duration}ms)`, {
      component,
      action,
      durationMs: duration,
      ...context,
      ...result,
    });
  };
}

// Export debug functions
export const debug = {
  init: initDebug,
  isEnabled: isDebugEnabled,
  log: (message: string, context?: LogContext) => log('info', message, context),
  success: (message: string, context?: LogContext) => log('success', message, context),
  warn: (message: string, context?: LogContext) => log('warn', message, context),
  error: (message: string, context?: LogContext) => log('error', message, context),
  sandbox: logSandbox,
  snapshot: logSnapshot,
  ide: logIde,
  request: logRequest,
  timer: startTimer,
};
