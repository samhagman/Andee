/**
 * Telegram MarkdownV2 escaping utilities.
 *
 * Converts Claude's natural markdown to Telegram-compatible MarkdownV2 format.
 * Characters that need escaping in MarkdownV2 (outside of code blocks):
 * _ * [ ] ( ) ~ ` > # + - = | { } . !
 */

/**
 * Escapes text for Telegram MarkdownV2 format.
 *
 * Handles:
 * - Code blocks (```...```) - preserved as-is
 * - Inline code (`...`) - preserved as-is
 * - Links [text](url) - properly escaped
 * - Bold **text** - converted to *text*
 * - Strikethrough ~~text~~ - converted to ~text~
 * - Italic _text_ - preserved with content escaped
 * - All special characters properly escaped
 *
 * @param text - Raw text from Claude
 * @returns Telegram MarkdownV2 formatted text
 */
export function escapeMarkdownV2(text: string): string {
  // First, handle code blocks - extract and protect them
  const codeBlockPlaceholders: string[] = [];
  let processed = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlockPlaceholders.push(match);
    return `%%CODEBLOCK${codeBlockPlaceholders.length - 1}%%`;
  });

  // Handle inline code
  const inlineCodePlaceholders: string[] = [];
  processed = processed.replace(/`[^`]+`/g, (match) => {
    inlineCodePlaceholders.push(match);
    return `%%INLINECODE${inlineCodePlaceholders.length - 1}%%`;
  });

  // Handle markdown links [text](url) - protect them and escape URL chars
  const linkPlaceholders: string[] = [];
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
    // Escape special chars in link text (but allow formatting)
    const escapedText = escapeSpecialChars(linkText);

    // In URLs, only escape ) and \
    const escapedUrl = url.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");

    const formattedLink = `[${escapedText}](${escapedUrl})`;
    linkPlaceholders.push(formattedLink);
    return `%%LINK${linkPlaceholders.length - 1}%%`;
  });

  // Convert **bold** to *bold* (Telegram uses single asterisks)
  processed = processed.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Convert ~~strikethrough~~ to ~strikethrough~
  processed = processed.replace(/~~(.+?)~~/g, "~$1~");

  // Handle italic text _content_ - protect before escaping
  const italicPlaceholders: string[] = [];
  processed = processed.replace(/_([^_\n]+)_/g, (_match, content) => {
    // Escape special chars in content (but NOT underscore - we're preserving the italic formatting)
    const escapedContent = escapeSpecialCharsExceptUnderscore(content);
    const formattedItalic = `_${escapedContent}_`;
    italicPlaceholders.push(formattedItalic);
    return `%%ITALIC${italicPlaceholders.length - 1}%%`;
  });

  // Escape special characters (including underscore for non-italic usage)
  processed = escapeAllSpecialChars(processed);

  // Restore italics
  italicPlaceholders.forEach((italic, i) => {
    processed = processed.replace(`%%ITALIC${i}%%`, italic);
  });

  // Restore links
  linkPlaceholders.forEach((link, i) => {
    processed = processed.replace(`%%LINK${i}%%`, link);
  });

  // Restore code blocks
  codeBlockPlaceholders.forEach((block, i) => {
    processed = processed.replace(`%%CODEBLOCK${i}%%`, block);
  });

  // Restore inline code
  inlineCodePlaceholders.forEach((code, i) => {
    processed = processed.replace(`%%INLINECODE${i}%%`, code);
  });

  return processed;
}

/**
 * Escapes special characters for Telegram MarkdownV2.
 * Used for link text and other content where all special chars need escaping.
 */
function escapeSpecialChars(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/~/g, "\\~")
    .replace(/>/g, "\\>")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/-/g, "\\-")
    .replace(/=/g, "\\=")
    .replace(/\|/g, "\\|")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\./g, "\\.")
    .replace(/!/g, "\\!");
}

/**
 * Escapes special characters except underscore.
 * Used inside italic formatting where underscores should be preserved.
 */
function escapeSpecialCharsExceptUnderscore(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/>/g, "\\>")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/-/g, "\\-")
    .replace(/=/g, "\\=")
    .replace(/\|/g, "\\|")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\./g, "\\.")
    .replace(/!/g, "\\!");
}

/**
 * Escapes all special characters for general text.
 * This is applied after italic/link handling.
 */
function escapeAllSpecialChars(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/>/g, "\\>")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/(?<!\\)-/g, "\\-") // Dash (but not already escaped)
    .replace(/=/g, "\\=")
    .replace(/\|/g, "\\|")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\./g, "\\.")
    .replace(/!/g, "\\!");
}
