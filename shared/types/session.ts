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
 * Structure:
 *   Private: sessions/{senderId}/{chatId}.json
 *   Groups:  sessions/groups/{chatId}.json
 *
 * @throws Error if senderId or isGroup is not provided (prevents isolation bypass)
 */
export function getSessionKey(
  chatId: string,
  senderId?: string,
  isGroup?: boolean
): string {
  if (senderId === undefined || isGroup === undefined) {
    throw new Error(
      `getSessionKey requires senderId and isGroup for chat ${chatId} (got senderId=${senderId}, isGroup=${isGroup})`
    );
  }
  return isGroup
    ? `sessions/groups/${chatId}.json`
    : `sessions/${senderId}/${chatId}.json`;
}

/**
 * Generates the R2 key for a snapshot.
 * Structure:
 *   Private: snapshots/{senderId}/{chatId}/{timestamp}.tar.gz
 *   Groups:  snapshots/groups/{chatId}/{timestamp}.tar.gz
 *
 * @throws Error if senderId or isGroup is not provided (prevents isolation bypass)
 */
export function getSnapshotKey(
  chatId: string,
  senderId?: string,
  isGroup?: boolean,
  timestamp?: string
): string {
  if (senderId === undefined || isGroup === undefined) {
    throw new Error(
      `getSnapshotKey requires senderId and isGroup for chat ${chatId} (got senderId=${senderId}, isGroup=${isGroup})`
    );
  }
  const ts = timestamp || new Date().toISOString().replace(/[:.]/g, "-");
  return isGroup
    ? `snapshots/groups/${chatId}/${ts}.tar.gz`
    : `snapshots/${senderId}/${chatId}/${ts}.tar.gz`;
}

/**
 * Gets the R2 prefix for listing snapshots.
 *
 * @throws Error if senderId or isGroup is not provided (prevents isolation bypass)
 */
export function getSnapshotPrefix(
  chatId: string,
  senderId?: string,
  isGroup?: boolean
): string {
  if (senderId === undefined || isGroup === undefined) {
    throw new Error(
      `getSnapshotPrefix requires senderId and isGroup for chat ${chatId} (got senderId=${senderId}, isGroup=${isGroup})`
    );
  }
  return isGroup
    ? `snapshots/groups/${chatId}/`
    : `snapshots/${senderId}/${chatId}/`;
}
