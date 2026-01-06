/**
 * Claude Sandbox Worker - Main entry point
 *
 * Cloudflare Worker that orchestrates Claude Agent SDK queries
 * inside isolated Sandbox containers.
 *
 * Routes:
 *   GET  /             Health check (no auth)
 *   GET  /diag         Diagnostic tests
 *   GET  /logs         Read agent logs
 *   POST /ask          Fire-and-forget (persistent server)
 *   POST /reset        Destroy sandbox and session (snapshots first)
 *   POST /session-update Update session in R2
 *   POST /snapshot     Create filesystem snapshot
 *   GET  /snapshot     Get latest snapshot (tar.gz)
 *   GET  /snapshots    List all snapshots
 *   DELETE /snapshot   Delete snapshot(s)
 */

// Re-export Sandbox for Durable Object binding
export { Sandbox } from "@cloudflare/sandbox";

import { CORS_HEADERS, Env, HandlerContext } from "./types";
import {
  handleHealth,
  handleAsk,
  handleDiag,
  handleLogs,
  handleReset,
  handleSessionUpdate,
  handleSnapshotCreate,
  handleSnapshotGet,
  handleSnapshotsList,
  handleSnapshotDelete,
} from "./handlers";

/**
 * Main worker fetch handler.
 * Routes requests to appropriate endpoint handlers.
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
          { error: "Unauthorized" },
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

      case "/reset":
        if (request.method === "POST") {
          return handleReset(ctx);
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
        if (request.method === "DELETE") {
          return handleSnapshotDelete(ctx);
        }
        break;

      case "/snapshots":
        if (request.method === "GET") {
          return handleSnapshotsList(ctx);
        }
        break;
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};
