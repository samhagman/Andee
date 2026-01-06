/**
 * Logs endpoint: GET /logs
 * Reads agent log from a chat's sandbox.
 */

import { getSandbox } from "@cloudflare/sandbox";
import { CORS_HEADERS, HandlerContext } from "../types";

export async function handleLogs(ctx: HandlerContext): Promise<Response> {
  try {
    const chatId = ctx.url.searchParams.get("chatId");
    if (!chatId) {
      return Response.json(
        { error: "Missing chatId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {});

    // Read the agent log file
    const logFile = await sandbox
      .readFile("/workspace/telegram_agent.log")
      .catch(() => null);
    const log = logFile?.content || "No log file found";

    return Response.json({ chatId, log }, { headers: CORS_HEADERS });
  } catch (error) {
    return Response.json(
      { error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
