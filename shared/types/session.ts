/**
 * Session data stored in R2 for each chat.
 * Shared between telegram-bot and sandbox-worker.
 */
export interface SessionData {
  claudeSessionId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Creates a default empty session.
 */
export function createDefaultSession(): SessionData {
  return {
    claudeSessionId: null,
    messageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Generates the R2 key for a session.
 */
export function getSessionKey(chatId: string): string {
  return `sessions/${chatId}.json`;
}
