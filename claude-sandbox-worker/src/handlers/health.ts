/**
 * Health check endpoint: GET /
 */

import { CORS_HEADERS, HandlerContext } from "../types";

export async function handleHealth(_ctx: HandlerContext): Promise<Response> {
  return new Response(
    JSON.stringify({ status: "ok", service: "claude-sandbox-worker" }),
    {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    }
  );
}
