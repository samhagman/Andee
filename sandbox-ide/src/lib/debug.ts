/**
 * Debug logging utility for Sandbox IDE.
 *
 * Toggle debug mode by setting DEBUG_MODE in localStorage or via console:
 *   - Enable: localStorage.setItem('andee-debug', 'true')
 *   - Disable: localStorage.removeItem('andee-debug')
 *   - Or call: window.AndeeDebug.enable() / window.AndeeDebug.disable()
 */

// Check if debug mode is enabled
function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem('andee-debug') === 'true';
  } catch {
    return false;
  }
}

// Color coding for different log levels
const LOG_COLORS = {
  info: 'color: #4fc3f7',     // Light blue
  success: 'color: #81c784',  // Green
  warn: 'color: #ffb74d',     // Orange
  error: 'color: #e57373',    // Red
  api: 'color: #ba68c8',      // Purple
  flow: 'color: #64b5f6',     // Blue
};

interface LogContext {
  component?: string;
  action?: string;
  [key: string]: unknown;
}

/**
 * Main debug logging function.
 * Only logs when debug mode is enabled.
 */
function log(
  level: keyof typeof LOG_COLORS,
  message: string,
  context?: LogContext
): void {
  if (!isDebugEnabled()) return;

  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  const prefix = context?.component ? `[${context.component}]` : '[Debug]';
  const color = LOG_COLORS[level];

  const logFn = level === 'error' ? console.error :
                level === 'warn' ? console.warn : console.log;

  if (context) {
    const { component, action, ...data } = context;
    const actionStr = action ? ` (${action})` : '';
    logFn(
      `%c${timestamp} ${prefix}${actionStr} ${message}`,
      color,
      Object.keys(data).length > 0 ? data : ''
    );
  } else {
    logFn(`%c${timestamp} ${prefix} ${message}`, color);
  }
}

/**
 * Log API request/response for debugging.
 */
function logApi(
  method: string,
  url: string,
  status?: number,
  duration?: number,
  data?: unknown
): void {
  if (!isDebugEnabled()) return;

  const statusStr = status !== undefined ? ` → ${status}` : '';
  const durationStr = duration !== undefined ? ` (${duration}ms)` : '';

  log(status && status >= 400 ? 'error' : 'api', `${method} ${url}${statusStr}${durationStr}`, {
    component: 'API',
    ...(data ? { data } : {}),
  });
}

/**
 * Log snapshot operations for debugging.
 */
function logSnapshot(action: string, details: Record<string, unknown>): void {
  log('flow', action, { component: 'Snapshot', action, ...details });
}

/**
 * Log file tree operations for debugging.
 */
function logFileTree(action: string, details: Record<string, unknown>): void {
  log('flow', action, { component: 'FileTree', action, ...details });
}

/**
 * Log terminal operations for debugging.
 */
function logTerminal(action: string, details: Record<string, unknown>): void {
  log('flow', action, { component: 'Terminal', action, ...details });
}

// Wrap fetch to log API calls when debug is enabled
const originalFetch = window.fetch;

export function enableFetchLogging(): void {
  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!isDebugEnabled()) {
      return originalFetch(input, init);
    }

    const url = typeof input === 'string' ? input :
                input instanceof URL ? input.toString() :
                input.url;

    // Skip logging for debug endpoint itself
    if (url.includes('127.0.0.1:7243')) {
      return originalFetch(input, init);
    }

    const method = init?.method || 'GET';
    const start = performance.now();

    try {
      const response = await originalFetch(input, init);
      const duration = Math.round(performance.now() - start);

      // Clone response to read body without consuming it
      const clonedResponse = response.clone();
      let responseData: unknown = undefined;

      try {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          responseData = await clonedResponse.json();
        }
      } catch {
        // Ignore body parsing errors
      }

      logApi(method, url, response.status, duration, responseData);

      return response;
    } catch (error) {
      const duration = Math.round(performance.now() - start);
      logApi(method, url, 0, duration, { error: String(error) });
      throw error;
    }
  };
}

// Global debug interface for console access
export const AndeeDebug = {
  enable(): void {
    localStorage.setItem('andee-debug', 'true');
    console.log('%c🔧 Andee Debug Mode ENABLED', 'color: #81c784; font-weight: bold');
    console.log('Refresh the page to see all debug logs.');
  },

  disable(): void {
    localStorage.removeItem('andee-debug');
    console.log('%c🔧 Andee Debug Mode DISABLED', 'color: #e57373; font-weight: bold');
  },

  isEnabled: isDebugEnabled,

  // Direct logging methods for manual debugging
  log: (message: string, data?: Record<string, unknown>) => log('info', message, data),
  success: (message: string, data?: Record<string, unknown>) => log('success', message, data),
  warn: (message: string, data?: Record<string, unknown>) => log('warn', message, data),
  error: (message: string, data?: Record<string, unknown>) => log('error', message, data),
};

// Expose to window for console access
if (typeof window !== 'undefined') {
  (window as unknown as { AndeeDebug: typeof AndeeDebug }).AndeeDebug = AndeeDebug;
}

// Export individual functions
export const debug = {
  log,
  api: logApi,
  snapshot: logSnapshot,
  fileTree: logFileTree,
  terminal: logTerminal,
  isEnabled: isDebugEnabled,
};
