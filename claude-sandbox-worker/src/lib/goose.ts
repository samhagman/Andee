/**
 * Goose CLI utilities for GLM-4.7 migration
 *
 * Provides:
 * - Response filtering (remove thinking blocks, tool noise)
 * - Telegram MarkdownV2 escaping
 * - Message chunking for Telegram's 4096 char limit
 * - Recipe generation for Goose runs
 */

import type { Env } from "../types";
import {
  GOOSE_MODEL,
  GOOSE_PROVIDER_URL,
  GOOSE_MAX_TURNS,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from "../../../shared/config";

/**
 * Build environment variables for Goose CLI execution
 */
export function buildGooseEnv(
  env: Env,
  userTimezone: string
): Record<string, string> {
  return {
    HOME: "/home/claude",
    TZ: userTimezone,
    // Provider configuration for Cerebras
    GOOSE_PROVIDER: "openai",
    OPENAI_HOST: GOOSE_PROVIDER_URL,
    OPENAI_API_KEY: env.CEREBRAS_API_KEY || "",
    GOOSE_MODEL: GOOSE_MODEL,
    // Execution mode - auto-approve safe operations
    GOOSE_MODE: "auto",
    // Context strategy for long conversations
    GOOSE_CONTEXT_STRATEGY: "summarize",
    // Max turns to match current behavior
    GOOSE_MAX_TURNS: String(GOOSE_MAX_TURNS),
    // Perplexity API key for web search MCP
    PERPLEXITY_API_KEY: env.PERPLEXITY_API_KEY || "",
  };
}

/**
 * Generate system prompt for Goose run
 *
 * The system prompt includes:
 * - Personality/style instructions
 * - Chat context (IDs, paths to memory/preferences)
 * - Available skills and tools
 * - Telegram formatting guidelines
 */
export function generateSystemPrompt(
  personality: string,
  chatId: string,
  senderId: string
): string {
  return `${personality}

## Context for this conversation
- Chat ID: ${chatId}
- Sender ID: ${senderId}
- Working directory: /workspace/files
- Memory file: /media/conversation-history/${chatId}/memory.mv2
- Preferences: /home/claude/private/${senderId}/preferences.yaml

## Available Skills (in ~/.claude/skills/)

You have access to these skills. USE THEM when the task matches:

1. **managing-artifacts** - Save recipes, lists, notes as markdown files with YAML frontmatter
   - Location: /home/claude/shared/lists/{type}/ (e.g., recipes/, movies/, grocery/)
   - Read the skill at ~/.claude/skills/managing-artifacts/SKILL.md for detailed instructions
   - ALWAYS use this skill when user wants to save/store something

2. **reminders** - Set time-based reminders
   - Use scripts: set-reminder, list-reminders, cancel-reminder

3. **searching-memories** - Search past conversations using memvid
   - Command: \`memvid find /media/conversation-history/${chatId}/memory.mv2 --query "..." --mode hybrid\`

4. **weather** - Get weather forecasts with clothing recommendations

## IMPORTANT: Use Tools!

You have the Developer extension with these tools:
- **shell**: Run bash commands
- **read_file**: Read file contents
- **write_file**: Write/create files
- **patch_file**: Edit existing files

When user asks to SAVE something (recipe, list, note):
1. Read the managing-artifacts skill: \`cat ~/.claude/skills/managing-artifacts/SKILL.md\`
2. Follow its instructions to create the artifact file
3. Use write_file to save to the correct location

DO NOT just respond with text when the user asks to save something. Actually create the file!

## Response Format (Telegram)
- Max 4096 characters
- Use • for bullets (NOT - or *)
- Use **bold** for headers (NOT # headers)
- Keep it conversational and mobile-friendly

## CRITICAL: Final Response Format
After completing any tool operations, output your final response to the user on a NEW LINE starting with ">>>".
Everything after ">>>" will be sent to the user. Do NOT include tool output, file contents, or intermediate steps after ">>>".
Example: ">>> Done! I've saved your mojito recipe. 🍹"`;
}

/**
 * Filter Goose CLI output for Telegram consumption
 *
 * Removes:
 * - GLM-4.7 thinking/reasoning blocks
 * - Goose tool output blocks (headers, metadata, file contents)
 * - Shell command output (ls, cat, etc.)
 * - Multiple blank lines
 *
 * Goose tool output format:
 *   ─── tool_name | extension ──────────────────────────
 *   path: /some/file.md
 *   command: some command
 *   content: |
 *     file contents here...
 *   ───────────────────────────────────────────────────
 */
export function filterGooseResponse(stdout: string): string {
  // First, check for the >>> delimiter which marks the final user response
  // This is the cleanest extraction method
  const delimiterMatch = stdout.match(/>>>\s*([\s\S]+)$/);
  if (delimiterMatch) {
    // Found delimiter - return everything after it, with minimal cleanup
    return delimiterMatch[1]
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Fallback: No delimiter found, apply aggressive filtering
  let filtered = stdout;

  // Remove GLM-4.7 thinking blocks (may appear as <think> or <thinking>)
  filtered = filtered.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  filtered = filtered.replace(/<think>[\s\S]*?<\/think>/gi, "");

  // Remove Chinese thinking markers (GLM sometimes uses these)
  filtered = filtered.replace(/【思考】[\s\S]*?【\/思考】/g, "");

  // Remove orphaned thinking tags
  filtered = filtered.replace(/<\/?think(?:ing)?>/gi, "");

  // Remove Goose tool header lines: ─── tool_name | extension ───
  // Matches lines starting with box drawing chars containing a pipe
  filtered = filtered.replace(/^[─━]+\s*[^\n|]+\s*\|\s*[^\n]+[─━]*$/gm, "");

  // Remove tool separator lines (just box drawing characters)
  filtered = filtered.replace(/^[─━]{10,}$/gm, "");

  // Remove tool metadata lines (path:, command:, content:, etc.)
  filtered = filtered.replace(/^(path|command|content|file|output|stdin|cwd|args|env):\s*.*$/gim, "");

  // Remove YAML-style content blocks that follow "content: |"
  // These are indented file contents from tool output
  filtered = filtered.replace(/^content:\s*\|\n([ \t]+.*\n)*/gm, "");

  // Remove lines that look like file paths being read/written
  filtered = filtered.replace(/^(Reading|Writing|Created|Updated|Deleted):\s*\/.*$/gim, "");

  // Remove shell command output patterns
  // ls -la output: total, file permissions, directories
  filtered = filtered.replace(/^total \d+$/gim, "");
  filtered = filtered.replace(/^[d-][rwx-]{9}\s+\d+\s+\w+\s+\w+\s+[\d.]+[KMG]?\s+.*$/gm, ""); // -rw-r--r-- 1 user group size date file
  filtered = filtered.replace(/^drwx[rwx-]{6}\s+\d+\s+\w+\s+\w+\s+\d+\s+.*$/gm, ""); // drwxr-xr-x dirs

  // Remove YAML frontmatter dumps (from cat'ing files)
  filtered = filtered.replace(/^---\n[\s\S]*?\n---$/gm, "");

  // Remove YAML-like metadata lines (key: value patterns from file dumps)
  // Common artifact metadata fields
  filtered = filtered.replace(/^(uuid|type|title|created_at|created_by|scope|status|tags|prep_time|cook_time|servings|difficulty|calories|cuisine|diet):\s*.*$/gim, "");

  // Remove YAML array items (  - item)
  filtered = filtered.replace(/^\s+-\s+\w+$/gm, "");

  // Remove file content echoes (indented markdown/text)
  filtered = filtered.replace(/^#{1,6}\s+.*$/gm, ""); // Markdown headers from file dumps

  // Remove execution status lines
  filtered = filtered.replace(/^Executing:.*$/gim, "");
  filtered = filtered.replace(/^Running:.*$/gim, "");
  filtered = filtered.replace(/^Finished:.*$/gim, "");
  filtered = filtered.replace(/^Success:.*$/gim, "");
  filtered = filtered.replace(/^Exit code:.*$/gim, "");

  // Remove reasoning markers
  filtered = filtered.replace(/^Reasoning:.*$/gim, "");
  filtered = filtered.replace(/^Thought:.*$/gim, "");
  filtered = filtered.replace(/^Let me think.*$/gim, "");

  // Remove "I'll" and "Let me" preamble lines (common in tool-heavy responses)
  filtered = filtered.replace(/^I'll (check|read|create|save|write|look|search|find).*$/gim, "");
  filtered = filtered.replace(/^Let me (first |)?(check|read|look|search|find|create|save).*$/gim, "");
  filtered = filtered.replace(/^(First,? |Now,? )?(let me |I'll |I need to ).*$/gim, "");

  // Remove skill/documentation dumps (lines starting with - User says, - When, etc.)
  filtered = filtered.replace(/^- (User|When|If|The|For|Always|Never|Use|Don't|Save|Create).*$/gm, "");

  // Remove lines that look like reading file contents (bullet instructions)
  filtered = filtered.replace(/^\s*•\s*(Read|Check|Use|Save|Create|Always|Never|If|When).*$/gm, "");

  // Remove UUID generation artifacts
  filtered = filtered.replace(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/gim, "");

  // Remove lines that are just whitespace or very short orphaned text
  filtered = filtered.replace(/^\s{4,}.*$/gm, ""); // Deeply indented lines (tool content)

  // Clean up multiple blank lines (3+ newlines → 2)
  filtered = filtered.replace(/\n{3,}/g, "\n\n");

  // Clean up leading/trailing whitespace on each line
  filtered = filtered
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  return filtered.trim();
}

/**
 * Escape text for Telegram MarkdownV2 format
 *
 * Converts Claude's natural markdown to Telegram-compatible MarkdownV2.
 * Handles:
 * - Code blocks and inline code (preserved as-is)
 * - Links [text](url)
 * - Bold **text** -> *text*
 * - Strikethrough ~~text~~ -> ~text~
 * - Italic _text_
 * - Special character escaping
 */
export function escapeMarkdownV2(text: string): string {
  // Characters that need escaping in MarkdownV2 (outside of code blocks)
  // _ * [ ] ( ) ~ ` > # + - = | { } . !

  // First, handle code blocks - extract and protect them
  const codeBlockPlaceholders: string[] = [];
  let processed = text.replace(/```([\s\S]*?)```/g, (match) => {
    codeBlockPlaceholders.push(match);
    return "%%CODEBLOCK" + (codeBlockPlaceholders.length - 1) + "%%";
  });

  // Handle inline code
  const inlineCodePlaceholders: string[] = [];
  processed = processed.replace(/`([^`]+)`/g, (match) => {
    inlineCodePlaceholders.push(match);
    return "%%INLINECODE" + (inlineCodePlaceholders.length - 1) + "%%";
  });

  // Handle markdown links [text](url) - protect them and escape URL chars
  const linkPlaceholders: string[] = [];
  processed = processed.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, linkText, url) => {
      // Escape special chars in link text (but allow formatting)
      const escapedText = linkText
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

      // In URLs, only escape ) and \
      const escapedUrl = url.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");

      const formattedLink = "[" + escapedText + "](" + escapedUrl + ")";
      linkPlaceholders.push(formattedLink);
      return "%%LINK" + (linkPlaceholders.length - 1) + "%%";
    }
  );

  // Convert **bold** to *bold* (Telegram uses single asterisks)
  processed = processed.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Convert ~~strikethrough~~ to ~strikethrough~
  processed = processed.replace(/~~(.+?)~~/g, "~$1~");

  // Handle italic text _content_ - protect before escaping
  const italicPlaceholders: string[] = [];
  processed = processed.replace(/_([^_\n]+)_/g, (match, content) => {
    // Escape special chars in content (but NOT underscore - we're preserving the italic formatting)
    const escapedContent = content
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
    const formattedItalic = "_" + escapedContent + "_";
    italicPlaceholders.push(formattedItalic);
    return "%%ITALIC" + (italicPlaceholders.length - 1) + "%%";
  });

  // Escape special characters (NOT underscore - italics already handled above)
  // Must escape: [ ] ( ) ~ > # + - = | { } . ! \
  processed = processed
    .replace(/\\/g, "\\\\") // Backslash first
    .replace(/_/g, "\\_") // Escape remaining underscores (not part of italic formatting)
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

  // Restore italics
  italicPlaceholders.forEach((italic, i) => {
    processed = processed.replace("%%ITALIC" + i + "%%", italic);
  });

  // Restore links
  linkPlaceholders.forEach((link, i) => {
    processed = processed.replace("%%LINK" + i + "%%", link);
  });

  // Restore code blocks
  codeBlockPlaceholders.forEach((block, i) => {
    processed = processed.replace("%%CODEBLOCK" + i + "%%", block);
  });

  // Restore inline code
  inlineCodePlaceholders.forEach((code, i) => {
    processed = processed.replace("%%INLINECODE" + i + "%%", code);
  });

  return processed;
}

/**
 * Chunk text for Telegram's 4096 character limit
 *
 * Splits on newlines when possible to avoid breaking formatting
 */
export function chunkForTelegram(
  text: string,
  maxLen = TELEGRAM_MAX_MESSAGE_LENGTH
): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split on newline
    let idx = remaining.lastIndexOf("\n", maxLen);
    if (idx === -1 || idx < maxLen / 2) {
      idx = maxLen;
    }

    chunks.push(remaining.substring(0, idx));
    remaining = remaining.substring(idx).trimStart();
  }

  return chunks;
}

/**
 * Send message to Telegram with proper formatting and chunking
 */
export async function sendToTelegram(
  text: string,
  botToken: string,
  chatId: string
): Promise<void> {
  const chunks = chunkForTelegram(text);

  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
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
 * Send error message to Telegram
 */
export async function sendErrorToTelegram(
  botToken: string,
  chatId: string,
  error: string
): Promise<void> {
  const errorMsg = `Sorry, I encountered an error: ${error.substring(0, 200)}`;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: errorMsg,
    }),
  });
}
