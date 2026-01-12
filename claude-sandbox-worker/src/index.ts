/**
 * Claude Sandbox Worker - Main entry point
 *
 * Cloudflare Worker that orchestrates Claude Agent SDK queries
 * inside isolated Sandbox containers.
 *
 * Routes:
 *   GET  /                  Health check (no auth)
 *   GET  /diag              Diagnostic tests
 *   GET  /logs              Read agent logs
 *   POST /ask               Fire-and-forget (persistent server)
 *   POST /restart           Restart container (keeps session)
 *   POST /factory-reset     Wipe sandbox and session (fresh start)
 *   POST /session-update    Update session in R2
 *   POST /snapshot          Create filesystem snapshot
 *   GET  /snapshot          Get latest snapshot (tar.gz)
 *   GET  /snapshots         List all snapshots
 *   POST /schedule-reminder Schedule a reminder via SchedulerDO
 *   POST /cancel-reminder   Cancel a pending reminder
 *   POST /complete-reminder Mark reminder as completed
 *   GET  /reminders         List reminders for a user
 *
 * IDE Endpoints (for Sandbox IDE web interface):
 *   GET  /sandboxes         List all available sandboxes
 *   GET  /files             List directory contents
 *   GET  /file              Read file content
 *   PUT  /file              Write file content
 *   WS   /ws                 WebSocket terminal (ttyd proxy)
 */

// Re-export Durable Objects for bindings
export { Sandbox } from "@cloudflare/sandbox";
export { SchedulerDO } from "./scheduler/SchedulerDO";

import { proxyToSandbox, getSandbox } from "@cloudflare/sandbox";

import { CORS_HEADERS, Env, HandlerContext } from "./types";
import {
  handleHealth,
  handleAsk,
  handleDiag,
  handleLogs,
  handleRestart,
  handleFactoryReset,
  handleSessionUpdate,
  handleSnapshotCreate,
  handleSnapshotGet,
  handleSnapshotsList,
  handleSnapshotRestore,
  handleSnapshotFiles,
  handleSnapshotFile,
  handleScheduleReminder,
  handleCancelReminder,
  handleCompleteReminder,
  handleListReminders,
  handleSandboxes,
  handleFiles,
  handleFileRead,
  handleFileWrite,
  handleTerminal,
  handleTerminalUrl,
  handleWsContainerTest,
} from "./handlers";

/**
 * Cron handler for hourly proactive checks.
 * Runs at minute 0 of every hour to evaluate proactive messaging.
 */
async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  console.log(`[Cron] Hourly proactive check triggered at ${new Date().toISOString()}`);

  // For now, this is a placeholder. The alarm-based reminder system
  // handles exact-time reminders via SchedulerDO.alarm().
  //
  // Future enhancements:
  // 1. Query SESSIONS R2 bucket for recently active users
  // 2. For each active user, optionally wake their container
  // 3. Send a proactive prompt asking Andee to consider if anything is worth saying
  // 4. Rate limit: track lastProactiveAt per user to avoid spam
  //
  // Example future implementation:
  // const activeUsers = await getRecentlyActiveUsers(env.SESSIONS);
  // for (const user of activeUsers) {
  //   if (shouldSendProactive(user)) {
  //     await triggerProactiveCheck(env, user);
  //   }
  // }

  console.log("[Cron] Proactive check completed (no-op for now)");
}

/**
 * Main worker fetch handler.
 * Routes requests to appropriate endpoint handlers.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle preview URL routing for sandbox port exposure (ttyd terminal, etc.)
    // This must come first to route requests to exposed sandbox ports
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

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
    // Note: /ws uses query param auth since WebSockets can't send headers
    if (env.ANDEE_API_KEY && url.pathname !== "/ws" && url.pathname !== "/ws-test" && url.pathname !== "/ws-container-test") {
      const providedKey = request.headers.get("X-API-Key");
      if (providedKey !== env.ANDEE_API_KEY) {
        return Response.json(
          { error: "Unauthorized", source: "middleware", pathname: url.pathname },
          { status: 401, headers: CORS_HEADERS }
        );
      }
    }

    // Route to handlers
    switch (url.pathname) {
      case "/diag":
        if (request.method === "GET") {
          return handleDiag(ctx);
        }
        break;

      case "/logs":
        if (request.method === "GET") {
          return handleLogs(ctx);
        }
        break;

      case "/ask":
        if (request.method === "POST") {
          return handleAsk(ctx);
        }
        break;

      case "/restart":
        if (request.method === "POST") {
          return handleRestart(ctx);
        }
        break;

      case "/factory-reset":
        if (request.method === "POST") {
          return handleFactoryReset(ctx);
        }
        break;

      case "/session-update":
        if (request.method === "POST") {
          return handleSessionUpdate(ctx);
        }
        break;

      case "/snapshot":
        if (request.method === "POST") {
          return handleSnapshotCreate(ctx);
        }
        if (request.method === "GET") {
          return handleSnapshotGet(ctx);
        }
        break;

      case "/snapshots":
        if (request.method === "GET") {
          return handleSnapshotsList(ctx);
        }
        break;

      case "/restore":
        if (request.method === "POST") {
          return handleSnapshotRestore(ctx);
        }
        break;

      case "/snapshot-files":
        if (request.method === "GET") {
          return handleSnapshotFiles(ctx);
        }
        break;

      case "/snapshot-file":
        if (request.method === "GET") {
          return handleSnapshotFile(ctx);
        }
        break;

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

      // IDE endpoints
      case "/sandboxes":
        if (request.method === "GET") {
          return handleSandboxes(ctx);
        }
        break;

      case "/files":
        if (request.method === "GET") {
          return handleFiles(ctx);
        }
        break;

      case "/file":
        if (request.method === "GET") {
          return handleFileRead(ctx);
        }
        if (request.method === "PUT") {
          return handleFileWrite(ctx);
        }
        break;

      case "/ws":
        // WebSocket terminal - route matches ttyd's expected /ws path
        return handleTerminal(ctx);

      case "/terminal-url":
        // Get exposed URL for terminal (alternative to wsConnect which has local dev issues)
        return handleTerminalUrl(ctx);

      case "/ws-container-test":
        // Test wsConnect with a simple Python echo server in container
        return handleWsContainerTest(ctx);

      case "/ws-test":
        // Simple WebSocket echo test to verify WebSocket works at Worker level
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
          return new Response("Expected WebSocket upgrade", { status: 400 });
        }
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();
        server.addEventListener("message", (event) => {
          console.log("[WS-TEST] Received:", event.data);
          server.send(`Echo: ${event.data}`);
        });
        server.addEventListener("close", () => {
          console.log("[WS-TEST] Connection closed");
        });
        console.log("[WS-TEST] WebSocket connection accepted");
        return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },

  /**
   * Cron trigger handler for hourly proactive checks.
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    await handleScheduled(event, env, ctx);
  },
};
