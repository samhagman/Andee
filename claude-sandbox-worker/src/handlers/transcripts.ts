/**
 * Transcripts endpoint: GET /transcripts
 * Access Claude SDK session transcripts for debugging.
 *
 * Claude SDK stores detailed conversation transcripts in JSONL files at:
 * /home/claude/.claude/projects/-workspace-files/{sessionId}.jsonl
 *
 * Transcript structure (each JSONL line):
 * {
 *   "type": "assistant",
 *   "timestamp": "2026-01-20T11:00:33.520Z",
 *   "message": {
 *     "content": [
 *       { "type": "thinking", "thinking": "Claude's reasoning..." },
 *       { "type": "tool_use", "name": "Skill", "input": {...} },
 *       { "type": "text", "text": "Final response..." }
 *     ]
 *   }
 * }
 *
 * Usage:
 * - GET /transcripts?chatId=X - List all session files
 * - GET /transcripts?chatId=X&latest=true - Get most recent transcript
 * - GET /transcripts?chatId=X&latest=true&thinkingOnly=true - Extract thinking blocks
 * - GET /transcripts?chatId=X&latest=true&toolsOnly=true - Extract tool calls
 * - GET /transcripts?chatId=X&latest=true&limit=5 - Last 5 entries (newest first)
 * - GET /transcripts?chatId=X&latest=true&limit=5&offset=5 - Entries 6-10
 */

import { getSandbox } from "@cloudflare/sandbox";
import { CORS_HEADERS, HandlerContext } from "../types";
import { SANDBOX_SLEEP_AFTER } from "../../../shared/config";

const TRANSCRIPTS_DIR = "/home/claude/.claude/projects/-workspace-files";

// Content block types within message.content[]
interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface TextBlock {
  type: "text";
  text: string;
}

type ContentBlock = ThinkingBlock | ToolUseBlock | TextBlock | { type: string };

interface TranscriptEntry {
  type: "user" | "assistant" | "queue-operation";
  message?: {
    role?: string;
    content?: ContentBlock[];
  };
  timestamp: string;
  uuid?: string;
}

interface TranscriptFile {
  sessionId: string;
  path: string;
  size: number;
  modified: string;
}

/**
 * Extract specific block types from transcript entries.
 * Looks inside message.content[] array for blocks matching the given type.
 */
function extractBlocks<T extends ContentBlock>(
  entries: TranscriptEntry[],
  blockType: string
): Array<T & { timestamp: string }> {
  return entries
    .filter(e => e.type === "assistant" && Array.isArray(e.message?.content))
    .flatMap(e => {
      const blocks = (e.message!.content as ContentBlock[])
        .filter(block => block.type === blockType) as T[];
      return blocks.map(block => ({ ...block, timestamp: e.timestamp }));
    });
}

/**
 * Apply pagination to an array of items.
 */
function applyPagination<T>(
  items: T[],
  limitStr: string | null,
  offset: number
): { offset: number; limit: number; entries: T[] } {
  const limitNum = limitStr ? parseInt(limitStr, 10) : items.length;
  const sliced = items.slice(offset, offset + limitNum);
  return { offset, limit: sliced.length, entries: sliced };
}

export async function handleTranscripts(ctx: HandlerContext): Promise<Response> {
  const chatId = ctx.url.searchParams.get("chatId");
  const sessionId = ctx.url.searchParams.get("sessionId");
  const latest = ctx.url.searchParams.get("latest") === "true";
  const thinkingOnly = ctx.url.searchParams.get("thinkingOnly") === "true";
  const toolsOnly = ctx.url.searchParams.get("toolsOnly") === "true";

  // Pagination params
  const limitParam = ctx.url.searchParams.get("limit");
  const offset = parseInt(ctx.url.searchParams.get("offset") || "0", 10);

  if (!chatId) {
    return Response.json(
      { error: "Missing chatId parameter" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const sandbox = getSandbox(ctx.env.Sandbox, `chat-${chatId}`, {
      sleepAfter: SANDBOX_SLEEP_AFTER,
    });

    // List all JSONL files, sorted by modification time (newest first)
    // Using stat to get file info since -printf may not work on all systems
    const listResult = await sandbox.exec(
      `find ${TRANSCRIPTS_DIR} -name "*.jsonl" -type f 2>/dev/null | while read f; do stat --format='%Y %s %n' "$f" 2>/dev/null || stat -f '%m %z %N' "$f" 2>/dev/null; done | sort -rn`,
      { timeout: 10000 }
    );

    if (listResult.exitCode !== 0 || !listResult.stdout.trim()) {
      return Response.json(
        { chatId, transcripts: [], message: "No transcripts found" },
        { headers: CORS_HEADERS }
      );
    }

    // Parse file list
    const files: TranscriptFile[] = listResult.stdout
      .trim()
      .split("\n")
      .filter(line => line.trim())
      .map(line => {
        const parts = line.trim().split(/\s+/);
        const timestamp = parts[0];
        const size = parts[1];
        const path = parts.slice(2).join(" "); // Handle paths with spaces
        const fileSessionId = path.split("/").pop()?.replace(".jsonl", "") || "";
        return {
          sessionId: fileSessionId,
          path,
          size: parseInt(size, 10),
          modified: new Date(parseInt(timestamp, 10) * 1000).toISOString(),
        };
      });

    // If just listing, return the list
    if (!sessionId && !latest) {
      return Response.json(
        { chatId, transcripts: files },
        { headers: CORS_HEADERS }
      );
    }

    // Determine which file to read
    const targetFile = latest
      ? files[0]
      : files.find(f => f.sessionId === sessionId);

    if (!targetFile) {
      return Response.json(
        { error: `Session ${sessionId || "latest"} not found` },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Read the transcript file
    const readResult = await sandbox.readFile(targetFile.path, { encoding: "utf8" });

    if (!readResult.content) {
      return Response.json(
        { error: "Failed to read transcript" },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Parse JSONL - each line is a JSON object
    const entries: TranscriptEntry[] = [];
    const lines = readResult.content.split("\n").filter(line => line.trim());

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
        console.warn("[Transcripts] Skipping malformed JSONL line");
      }
    }

    // Reverse to get newest first (most recent turns at the start)
    entries.reverse();

    // thinkingOnly - extract thinking blocks from message.content[] array
    if (thinkingOnly) {
      const allThinking = extractBlocks<ThinkingBlock>(entries, "thinking")
        .map(({ timestamp, thinking }) => ({ timestamp, thinking }));
      const paginated = applyPagination(allThinking, limitParam, offset);

      return Response.json(
        {
          chatId,
          sessionId: targetFile.sessionId,
          totalEntries: allThinking.length,
          offset: paginated.offset,
          limit: paginated.limit,
          thinking: paginated.entries,
        },
        { headers: CORS_HEADERS }
      );
    }

    // toolsOnly - extract tool_use blocks from message.content[] array
    if (toolsOnly) {
      const allTools = extractBlocks<ToolUseBlock>(entries, "tool_use")
        .map(({ timestamp, name, input }) => ({ timestamp, name, input }));
      const paginated = applyPagination(allTools, limitParam, offset);

      return Response.json(
        {
          chatId,
          sessionId: targetFile.sessionId,
          totalEntries: allTools.length,
          offset: paginated.offset,
          limit: paginated.limit,
          tools: paginated.entries,
        },
        { headers: CORS_HEADERS }
      );
    }

    // Full entries with pagination
    const paginated = applyPagination(entries, limitParam, offset);

    return Response.json(
      {
        chatId,
        sessionId: targetFile.sessionId,
        file: targetFile,
        totalEntries: entries.length,
        offset: paginated.offset,
        limit: paginated.limit,
        entries: paginated.entries,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Worker] Transcripts error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
