/**
 * System-level constants for automated/internal operations.
 *
 * These represent first-class sender types that are NOT Telegram users
 * but are valid senders within Andee's internal architecture.
 */

/**
 * Sender ID for automated/scheduled messages.
 *
 * Used for:
 * - Scheduled tasks (recurring messages)
 * - Reminder deliveries
 * - Container health checks
 * - Automated maintenance operations
 *
 * This is a first-class sender type, NOT a fallback for undefined.
 * Code should explicitly check for this value and handle it appropriately.
 *
 * For snapshot/session paths:
 * - Groups: Always use shared group path (snapshots/groups/{chatId}/)
 * - Private: Use chatId as senderId (snapshots/{chatId}/{chatId}/)
 *   This works because in Telegram private bot chats, chatId == user's ID
 */
export const SYSTEM_SENDER_ID = 'system';
