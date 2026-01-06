/**
 * Session update endpoint: POST /session-update
 * Called by agent to persist session to R2.
 */

import {
  CORS_HEADERS,
  HandlerContext,
  SessionData,
  SessionUpdateRequest,
  createDefaultSession,
  getSessionKey,
} from "../types";

export async function handleSessionUpdate(ctx: HandlerContext): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as SessionUpdateRequest;
    const { chatId, claudeSessionId, senderId, isGroup } = body;

    if (!chatId || !claudeSessionId || !ctx.env.SESSIONS) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const sessionKey = getSessionKey(chatId, senderId, isGroup);
    let session: SessionData;

    try {
      const existing = await ctx.env.SESSIONS.get(sessionKey);
      if (existing) {
        session = (await existing.json()) as SessionData;
      } else {
        session = createDefaultSession();
      }
    } catch {
      session = createDefaultSession();
    }

    session.claudeSessionId = claudeSessionId;
    session.messageCount++;
    session.updatedAt = new Date().toISOString();
    await ctx.env.SESSIONS.put(sessionKey, JSON.stringify(session));

    console.log(`[Worker] Session updated: ${sessionKey} (claudeSessionId: ${claudeSessionId})`);
    return Response.json({ success: true }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Worker] Session update error:", error);
    return Response.json(
      { error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
