/**
 * OpenCode SDK utilities for persistent server mode
 *
 * Provides:
 * - Environment variable builder for OpenCode server
 * - System prompt generation
 * - Response filtering (reuses Goose patterns)
 */

import type { Env } from "../types";
import {
  OPENCODE_PORT,
  OPENCODE_HOSTNAME,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from "../../../shared/config";

// Re-export shared utilities from goose.ts (same filtering/telegram logic)
export {
  filterGooseResponse as filterOpenCodeResponse,
  escapeMarkdownV2,
  chunkForTelegram,
  sendToTelegram,
  sendErrorToTelegram,
} from "./goose";

/**
 * Build environment variables for OpenCode server execution
 */
export function buildOpenCodeEnv(
  env: Env,
  userTimezone: string
): Record<string, string> {
  return {
    HOME: "/home/claude",
    TZ: userTimezone,
    // Cerebras API key for inference
    CEREBRAS_API_KEY: env.CEREBRAS_API_KEY || "",
    // Perplexity API key for web search MCP
    PERPLEXITY_API_KEY: env.PERPLEXITY_API_KEY || "",
    // OpenCode server configuration
    OPENCODE_PORT: String(OPENCODE_PORT),
    OPENCODE_HOSTNAME: OPENCODE_HOSTNAME,
    // Anthropic API key for analyzing-media skill (Claude Agent SDK)
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || "",
    // OpenRouter API key for analyze-video skill (Gemini via OpenRouter)
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY || "",
  };
}

/**
 * Generate system prompt for OpenCode run
 *
 * The system prompt includes:
 * - Personality/style instructions
 * - Chat context (IDs, paths to memory/preferences)
 * - Available skills and tools
 * - Telegram formatting guidelines
 */
export function generateOpenCodeSystemPrompt(
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

You have developer tools available:
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
Example: ">>> Done! I've saved your mojito recipe."`;
}
