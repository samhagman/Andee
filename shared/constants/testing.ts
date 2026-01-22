/**
 * Dedicated test user IDs for production testing.
 *
 * PHILOSOPHY: Test users are treated EXACTLY like real users.
 * - Same code paths, same R2 storage patterns, same container paths
 * - Isolation is automatic via senderId (no special handling needed)
 * - The only difference is recognizable IDs that won't conflict with real Telegram users
 *
 * Use these instead of real user IDs (SAM_PROD_USER, SHERLY_PROD_USER) when testing
 * to avoid polluting real user data.
 */

// Primary test user (nine 9s) - use for most testing
export const TEST_USER_1 = '999999999';

// Secondary test user (nine 8s) - use for multi-user isolation testing
export const TEST_USER_2 = '888888888';

// Convenience aliases: For private chats, chatId === senderId
export const TEST_CHAT_1 = TEST_USER_1;
export const TEST_CHAT_2 = TEST_USER_2;

// For group chat testing (negative IDs with -100 prefix)
export const TEST_GROUP_CHAT = '-100999999999';

// Production user IDs for debugging
export const SAM_PROD_USER = '7821047187';
export const SHERLY_PROD_USER = '7580981566';

// Production group chats for debugging
// Sam and Sherly's shared production group chat
export const SAM_AND_SHERLY_PROD_GROUP = '-1003285272358';
