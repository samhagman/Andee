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
 *   GET  /poll         Poll streaming progress
 *   POST /ask          Synchronous query
 *   POST /ask-stream   Start streaming query
 *   POST /ask-telegram Fire-and-forget Telegram message
 *   POST /reset        Destroy sandbox and session
 *   POST /session-update Update session in R2
 */

// Re-export Sandbox for Durable Object binding
export { Sandbox } from "@cloudflare/sandbox";

import { CORS_HEADERS, Env, HandlerContext } from "./types";
import {
  handleHealth,
  handleAsk,
  handleAskStream,
  handlePoll,
  handleAskTelegram,
  handleDiag,
  handleLogs,
  handleReset,
  handleSessionUpdate,
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

      case "/poll":
        if (request.method === "GET") {
          return handlePoll(ctx);
        }
        break;

      case "/ask":
        if (request.method === "POST") {
          return handleAsk(ctx);
        }
        break;

      case "/ask-stream":
        if (request.method === "POST") {
          return handleAskStream(ctx);
        }
        break;

      case "/ask-telegram":
        if (request.method === "POST") {
          return handleAskTelegram(ctx);
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
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};
