import { SYSTEM_SENDER_ID } from '../constants';

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
 *   System (private): sessions/{chatId}/{chatId}.json
 *
 * @throws Error if isGroup is not provided
 * @throws Error if senderId is not provided for private chats (except system sender)
 */
export function getSessionKey(
  chatId: string,
  senderId?: string,
  isGroup?: boolean
): string {
  if (isGroup === undefined) {
    throw new Error(`getSessionKey requires isGroup for chat ${chatId}`);
  }

  // Group chats always use the shared group path
  if (isGroup) {
    return `sessions/groups/${chatId}.json`;
  }

  // System sender for private chats: use chatId as the user
  // (in Telegram private bot chats, chatId == user's ID)
  if (senderId === SYSTEM_SENDER_ID) {
    return `sessions/${chatId}/${chatId}.json`;
  }

  // Normal user in private chat
  if (senderId === undefined) {
    throw new Error(`getSessionKey requires senderId for private chat ${chatId}`);
  }
  return `sessions/${senderId}/${chatId}.json`;
}

/**
 * Generates the R2 key for a snapshot.
 * Structure:
 *   Private: snapshots/{senderId}/{chatId}/{timestamp}.tar.gz
 *   Groups:  snapshots/groups/{chatId}/{timestamp}.tar.gz
 *   System (private): snapshots/{chatId}/{chatId}/{timestamp}.tar.gz
 *
 * @throws Error if isGroup is not provided
 * @throws Error if senderId is not provided for private chats (except system sender)
 */
export function getSnapshotKey(
  chatId: string,
  senderId?: string,
  isGroup?: boolean,
  timestamp?: string
): string {
  if (isGroup === undefined) {
    throw new Error(`getSnapshotKey requires isGroup for chat ${chatId}`);
  }

  const ts = timestamp || new Date().toISOString().replace(/[:.]/g, "-");

  // Group chats always use the shared group path
  if (isGroup) {
    return `snapshots/groups/${chatId}/${ts}.tar.gz`;
  }

  // System sender for private chats: use chatId as the user
  // (in Telegram private bot chats, chatId == user's ID)
  if (senderId === SYSTEM_SENDER_ID) {
    return `snapshots/${chatId}/${chatId}/${ts}.tar.gz`;
  }

  // Normal user in private chat
  if (senderId === undefined) {
    throw new Error(`getSnapshotKey requires senderId for private chat ${chatId}`);
  }
  return `snapshots/${senderId}/${chatId}/${ts}.tar.gz`;
}

/**
 * Gets the R2 prefix for listing snapshots.
 * Structure:
 *   Private: snapshots/{senderId}/{chatId}/
 *   Groups:  snapshots/groups/{chatId}/
 *   System (private): snapshots/{chatId}/{chatId}/
 *
 * @throws Error if isGroup is not provided
 * @throws Error if senderId is not provided for private chats (except system sender)
 */
export function getSnapshotPrefix(
  chatId: string,
  senderId?: string,
  isGroup?: boolean
): string {
  if (isGroup === undefined) {
    throw new Error(`getSnapshotPrefix requires isGroup for chat ${chatId}`);
  }

  // Group chats always use the shared group path
  if (isGroup) {
    return `snapshots/groups/${chatId}/`;
  }

  // System sender for private chats: use chatId as the user
  // (in Telegram private bot chats, chatId == user's ID)
  if (senderId === SYSTEM_SENDER_ID) {
    return `snapshots/${chatId}/${chatId}/`;
  }

  // Normal user in private chat
  if (senderId === undefined) {
    throw new Error(`getSnapshotPrefix requires senderId for private chat ${chatId}`);
  }
  return `snapshots/${senderId}/${chatId}/`;
}
