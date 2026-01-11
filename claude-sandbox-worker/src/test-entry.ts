/**
 * Test entry point for vitest-pool-workers.
 *
 * This file mirrors src/index.ts but EXCLUDES:
 * - @cloudflare/sandbox (causes module resolution errors in miniflare)
 * - Sandbox-dependent handlers (ask, diag, reset, logs, ide endpoints)
 *
 * Testable functionality:
 * - Health check endpoint
 * - Authentication middleware
 * - CORS handling
 * - Reminder endpoints (SchedulerDO)
 * - Session/snapshot handlers (R2 operations)
 */

// Only export SchedulerDO - Sandbox cannot be resolved in test runtime
export { SchedulerDO } from "./scheduler/SchedulerDO";

import { CORS_HEADERS, Env, HandlerContext } from "./types";
// Import directly from individual handler files to avoid pulling in sandbox-dependent modules
import { handleHealth } from "./handlers/health";
import {
  handleScheduleReminder,
  handleCancelReminder,
  handleCompleteReminder,
  handleListReminders,
} from "./handlers/reminder";

/**
 * Test worker fetch handler.
 * Subset of main worker that excludes Sandbox-dependent routes.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const ctx: HandlerContext = { request, env, url };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Health check - public, no auth required
    if (url.pathname === "/" && request.method === "GET") {
      return handleHealth(ctx);
    }

    // API key authentication for all other endpoints
    if (env.ANDEE_API_KEY) {
      const providedKey = request.headers.get("X-API-Key");
      if (providedKey !== env.ANDEE_API_KEY) {
        return Response.json(
          { error: "Unauthorized", source: "middleware", pathname: url.pathname },
          { status: 401, headers: CORS_HEADERS }
        );
      }
    }

    // Route to handlers (only Sandbox-independent routes)
    switch (url.pathname) {
      case "/schedule-reminder":
        if (request.method === "POST") {
          return handleScheduleReminder(ctx);
        }
        break;

      case "/cancel-reminder":
        if (request.method === "POST") {
          return handleCancelReminder(ctx);
        }
        break;

      case "/complete-reminder":
        if (request.method === "POST") {
          return handleCompleteReminder(ctx);
        }
        break;

      case "/reminders":
        if (request.method === "GET") {
          return handleListReminders(ctx);
        }
        break;
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};
