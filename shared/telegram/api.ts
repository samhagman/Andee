import { escapeMarkdownV2 } from "./markdown";
import { chunkTextForTelegram } from "./chunker";

/**
 * Telegram Bot API helpers.
 *
 * These functions make direct calls to the Telegram Bot API.
 * They are used inside container scripts where we don't have access to Grammy.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

/**
 * Sends a message to Telegram, automatically chunking if needed.
 *
 * @param botToken - The bot token
 * @param chatId - The chat ID to send to
 * @param text - The raw text to send (will be escaped for MarkdownV2)
 * @returns Promise that resolves when all chunks are sent
 */
export async function sendToTelegram(
  botToken: string,
  chatId: string,
  text: string
): Promise<void> {
  const chunks = chunkTextForTelegram(text);

  for (const chunk of chunks) {
    await fetch(`${TELEGRAM_API_BASE}${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: escapeMarkdownV2(chunk),
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });
  }
}

/**
 * Sends a plain text message (no markdown formatting).
 *
 * @param botToken - The bot token
 * @param chatId - The chat ID to send to
 * @param text - The text to send (no escaping applied)
 */
export async function sendPlainText(
  botToken: string,
  chatId: string,
  text: string
): Promise<void> {
  await fetch(`${TELEGRAM_API_BASE}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
}

/**
 * Sets a reaction on a message.
 *
 * @param botToken - The bot token
 * @param chatId - The chat ID
 * @param messageId - The message ID to react to
 * @param emoji - The emoji to use (e.g., "👀")
 */
export async function setReaction(
  botToken: string,
  chatId: string,
  messageId: number,
  emoji: string
): Promise<void> {
  await fetch(`${TELEGRAM_API_BASE}${botToken}/setMessageReaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
    }),
  });
}

/**
 * Removes all reactions from a message.
 *
 * @param botToken - The bot token
 * @param chatId - The chat ID
 * @param messageId - The message ID to remove reactions from
 */
export async function removeReaction(
  botToken: string,
  chatId: string,
  messageId: number
): Promise<void> {
  await fetch(`${TELEGRAM_API_BASE}${botToken}/setMessageReaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reaction: [],
    }),
  }).catch(() => {
    // Silently ignore reaction removal failures - not critical
  });
}

/**
 * Sends a typing indicator.
 *
 * @param botToken - The bot token
 * @param chatId - The chat ID
 */
export async function sendTypingIndicator(
  botToken: string,
  chatId: string
): Promise<void> {
  await fetch(`${TELEGRAM_API_BASE}${botToken}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      action: "typing",
    }),
  }).catch(() => {
    // Silently ignore typing indicator failures - not critical
  });
}
