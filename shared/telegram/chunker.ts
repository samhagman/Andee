import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../config";

/**
 * Splits text into chunks that fit within Telegram's message size limit.
 *
 * Telegram has a 4096 character limit per message. We use 4000 to leave
 * room for potential escaping overhead.
 *
 * The function tries to split at newlines for cleaner breaks, falling back
 * to splitting at the max length if no suitable newline is found.
 *
 * @param text - The text to split
 * @param maxLength - Maximum length per chunk (default: TELEGRAM_MAX_MESSAGE_LENGTH)
 * @returns Array of text chunks, each within the max length
 */
export function chunkTextForTelegram(
  text: string,
  maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH
): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // If remaining text fits, add it and we're done
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find a newline to split at for cleaner breaks
    let splitIndex = remaining.lastIndexOf("\n", maxLength);

    // If no newline found or it's too early (less than half the max), split at max
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    // Add this chunk
    chunks.push(remaining.substring(0, splitIndex));

    // Continue with the rest, trimming leading whitespace
    remaining = remaining.substring(splitIndex).trimStart();
  }

  return chunks;
}

/**
 * Estimates if text will need chunking.
 *
 * @param text - The text to check
 * @returns True if text exceeds the max message length
 */
export function willNeedChunking(text: string): boolean {
  return text.length > TELEGRAM_MAX_MESSAGE_LENGTH;
}
