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
 * New structure:
 *   Private: sessions/{senderId}/{chatId}.json
 *   Groups:  sessions/groups/{chatId}.json
 */
export function getSessionKey(
  chatId: string,
  senderId?: string,
  isGroup?: boolean
): string {
  if (senderId !== undefined && isGroup !== undefined) {
    return isGroup
      ? `sessions/groups/${chatId}.json`
      : `sessions/${senderId}/${chatId}.json`;
  }
  return `sessions/${chatId}.json`; // Legacy fallback
}

/**
 * Generates the R2 key for a snapshot.
 * New structure:
 *   Private: snapshots/{senderId}/{chatId}/{timestamp}.tar.gz
 *   Groups:  snapshots/groups/{chatId}/{timestamp}.tar.gz
 */
export function getSnapshotKey(
  chatId: string,
  senderId?: string,
  isGroup?: boolean,
  timestamp?: string
): string {
  const ts = timestamp || new Date().toISOString().replace(/[:.]/g, "-");
  if (senderId !== undefined && isGroup !== undefined) {
    return isGroup
      ? `snapshots/groups/${chatId}/${ts}.tar.gz`
      : `snapshots/${senderId}/${chatId}/${ts}.tar.gz`;
  }
  return `snapshots/${chatId}/${ts}.tar.gz`; // Legacy fallback
}

/**
 * Gets the R2 prefix for listing snapshots.
 */
export function getSnapshotPrefix(
  chatId: string,
  senderId?: string,
  isGroup?: boolean
): string {
  if (senderId !== undefined && isGroup !== undefined) {
    return isGroup
      ? `snapshots/groups/${chatId}/`
      : `snapshots/${senderId}/${chatId}/`;
  }
  return `snapshots/${chatId}/`; // Legacy fallback
}
