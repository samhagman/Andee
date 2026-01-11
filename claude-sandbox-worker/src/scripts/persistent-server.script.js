#!/usr/bin/env node

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createServer } from "http";
import { appendFileSync, writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { execSync } from "child_process";

const PORT = 8080;
const LOG_FILE = "/workspace/telegram_agent.log";
const PERSONALITY_PATH = "/home/claude/.claude/PERSONALITY.md";

// Load personality prompt at startup (appended to system prompt)
let personalityPrompt = "";
try {
  personalityPrompt = readFileSync(PERSONALITY_PATH, "utf-8");
  console.error(`[STARTUP] Loaded personality from ${PERSONALITY_PATH} (${personalityPrompt.length} chars)`);
} catch (e) {
  console.error(`[STARTUP] No personality file at ${PERSONALITY_PATH}, using defaults`);
}

// Escape text for Telegram MarkdownV2 format
// Converts Claude's natural markdown to Telegram-compatible MarkdownV2
function escapeMarkdownV2(text) {
  // Characters that need escaping in MarkdownV2 (outside of code blocks)
  // _ * [ ] ( ) ~ ` > # + - = | { } . !

  // First, handle code blocks - extract and protect them
  const codeBlockPlaceholders = [];
  let processed = text.replace(/```([\s\S]*?)```/g, (match) => {
    codeBlockPlaceholders.push(match);
    return "%%CODEBLOCK" + (codeBlockPlaceholders.length - 1) + "%%";
  });

  // Handle inline code
  const inlineCodePlaceholders = [];
  processed = processed.replace(/`([^`]+)`/g, (match) => {
    inlineCodePlaceholders.push(match);
    return "%%INLINECODE" + (inlineCodePlaceholders.length - 1) + "%%";
  });

  // Handle markdown links [text](url) - protect them and escape URL chars
  const linkPlaceholders = [];
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
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
  });

  // Convert **bold** to *bold* (Telegram uses single asterisks)
  processed = processed.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Convert ~~strikethrough~~ to ~strikethrough~
  processed = processed.replace(/~~(.+?)~~/g, "~$1~");

  // Handle italic text _content_ - protect before escaping
  const italicPlaceholders = [];
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
    .replace(/\\/g, "\\\\")  // Backslash first
    .replace(/_/g, "\\_")  // Escape remaining underscores (not part of italic formatting)
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/>/g, "\\>")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/(?<!\\)-/g, "\\-")  // Dash (but not already escaped)
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

// State
let sessionId = null;
let isProcessing = false;
const messageQueue = [];
let resolveNextMessage = null;
let currentRequestContext = null;
let typingInterval = null;

// Auto-snapshot state
let lastActivityTime = Date.now();
let hasAutoSnapshotted = false;
let lastKnownWorkerUrl = null;
let lastKnownChatId = null;
let lastKnownSenderId = null;
let lastKnownIsGroup = null;
let lastKnownApiKey = null;
const AUTO_SNAPSHOT_AFTER_MS = 55 * 60 * 1000; // 55 minutes
const SNAPSHOT_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

// Timestamped logging
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.error(line);
  appendFileSync(LOG_FILE, line + "\n");
}

// Append conversation turn to Memvid memory
// See: https://docs.memvid.com/ for CLI reference
// Note: memvid CLI requires content via --contextual <FILE>, not inline text
function appendToMemvid(ctx, userMessage, assistantResponse) {
  try {
    // Determine memory file location
    const memoryFile = ctx.isGroup
      ? '/home/claude/shared/shared.mv2'
      : `/home/claude/private/${ctx.senderId}/memory.mv2`;

    // Ensure private directory exists if needed
    if (!ctx.isGroup) {
      const privateDir = `/home/claude/private/${ctx.senderId}`;
      if (!existsSync(privateDir)) {
        mkdirSync(privateDir, { recursive: true });
        log(`MEMVID created private dir: ${privateDir}`);
      }
    }

    // Create memory file if it doesn't exist
    if (!existsSync(memoryFile)) {
      try {
        execSync(`memvid create "${memoryFile}"`, { timeout: 5000 });
        log(`MEMVID created new memory file: ${memoryFile}`);
      } catch (e) {
        log(`MEMVID create failed: ${e.message}`);
        return; // Can't continue without the file
      }
    }

    const timestamp = new Date().toISOString();
    const tempDir = '/tmp/memvid';

    // Ensure temp directory exists
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Write user message to temp file and append using --input
    const userTempFile = `${tempDir}/user_${Date.now()}.txt`;
    try {
      writeFileSync(userTempFile, userMessage);
      execSync(`memvid put "${memoryFile}" --input "${userTempFile}" --title "user @ ${timestamp}" --label "conversation"`, { timeout: 5000 });
      log("MEMVID appended user turn");
    } catch (e) {
      log(`MEMVID user append failed: ${e.message}`);
    } finally {
      // Clean up temp file
      try { execSync(`rm -f "${userTempFile}"`); } catch {}
    }

    // Write assistant response to temp file and append using --input
    const assistantTempFile = `${tempDir}/assistant_${Date.now()}.txt`;
    try {
      writeFileSync(assistantTempFile, assistantResponse);
      execSync(`memvid put "${memoryFile}" --input "${assistantTempFile}" --title "assistant @ ${timestamp}" --label "conversation"`, { timeout: 5000 });
      log("MEMVID appended assistant turn");
    } catch (e) {
      log(`MEMVID assistant append failed: ${e.message}`);
    } finally {
      // Clean up temp file
      try { execSync(`rm -f "${assistantTempFile}"`); } catch {}
    }

  } catch (err) {
    // Don't fail the whole flow if Memvid fails
    log(`MEMVID error: ${err.message}`);
  }
}

// Send typing indicator to Telegram
async function sendTypingIndicator(botToken, chatId) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" })
    });
  } catch (err) {
    log(`TYPING_ERROR: ${err.message}`);
  }
}

// Wait for next message from queue
function waitForNextMessage() {
  return new Promise((resolve) => {
    if (messageQueue.length > 0) {
      resolve(messageQueue.shift());
    } else {
      resolveNextMessage = resolve;
    }
  });
}

// Add message to queue
function enqueueMessage(msg) {
  if (resolveNextMessage) {
    const resolve = resolveNextMessage;
    resolveNextMessage = null;
    resolve(msg);
  } else {
    messageQueue.push(msg);
  }
}

// Send to Telegram
async function sendToTelegram(text, botToken, chatId) {
  const maxLen = 4000;
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let idx = remaining.lastIndexOf("\n", maxLen);
    if (idx === -1 || idx < maxLen / 2) idx = maxLen;
    chunks.push(remaining.substring(0, idx));
    remaining = remaining.substring(idx).trimStart();
  }

  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: escapeMarkdownV2(chunk),
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true
      })
    });
  }
}

async function removeReaction(botToken, chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reaction: []
    })
  }).catch(() => {});
}

// Create and upload auto-snapshot
async function createAutoSnapshot() {
  if (!lastKnownWorkerUrl || !lastKnownChatId || lastKnownSenderId === null) {
    log("AUTO_SNAPSHOT skipped: missing context (workerUrl, chatId, or senderId)");
    return false;
  }

  try {
    log("AUTO_SNAPSHOT creating...");

    // Create tar archive of workspace and home
    const { execSync } = await import("child_process");
    const snapshotPath = "/tmp/auto_snapshot.tar.gz";

    // Check what directories exist and have content
    const dirsToBackup = [];
    try {
      execSync("test -d /workspace && ls -A /workspace | head -1", { encoding: "utf8" });
      dirsToBackup.push("/workspace");
    } catch {}
    try {
      execSync("test -d /home/claude && ls -A /home/claude | head -1", { encoding: "utf8" });
      dirsToBackup.push("/home/claude");
    } catch {}

    if (dirsToBackup.length === 0) {
      log("AUTO_SNAPSHOT skipped: no content to backup");
      return false;
    }

    // Create tar archive
    execSync(`tar -czf ${snapshotPath} ${dirsToBackup.join(" ")} 2>/dev/null || true`);

    // Read the tar file
    const { readFileSync } = await import("fs");
    const tarData = readFileSync(snapshotPath);

    // Upload to worker via POST /snapshot
    const headers = { "Content-Type": "application/json" };
    if (lastKnownApiKey) headers["X-API-Key"] = lastKnownApiKey;
    const response = await fetch(`${lastKnownWorkerUrl}/snapshot`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        chatId: lastKnownChatId,
        senderId: lastKnownSenderId,
        isGroup: lastKnownIsGroup
      })
    });

    if (response.ok) {
      const result = await response.json();
      log(`AUTO_SNAPSHOT success: ${result.key || "uploaded"}`);
      return true;
    } else {
      log(`AUTO_SNAPSHOT failed: ${response.status}`);
      return false;
    }
  } catch (err) {
    log(`AUTO_SNAPSHOT error: ${err.message}`);
    return false;
  }
}

// Async generator that yields messages as they arrive
async function* messageGenerator() {
  while (true) {
    log("GENERATOR waiting for message...");
    const msg = await waitForNextMessage();

    const hasImages = msg.images && msg.images.length > 0;
    const textPreview = msg.text ? msg.text.substring(0, 50) + "..." : "[no text]";
    const imageInfo = hasImages ? ` +${msg.images.length} image(s)` : "";
    log(`GENERATOR yielding message: ${textPreview}${imageInfo}`);

    // Store context for response handling
    currentRequestContext = msg;

    // Write context to PROTECTED file so skill scripts can read it
    // Claude cannot access /tmp/protected/ directly (blocked by disallowedPaths)
    // But skill scripts CAN read it since they execute in shell, not through Claude's tools
    const contextDir = "/tmp/protected/telegram_context";
    const contextFile = `${contextDir}/context.json`;
    try {
      mkdirSync(contextDir, { recursive: true });
      const context = {
        senderId: msg.senderId,
        chatId: msg.chatId,
        isGroup: msg.isGroup,
        botToken: msg.botToken,
        workerUrl: msg.workerUrl,
        apiKey: msg.apiKey,
        userMessageId: msg.userMessageId,
        timestamp: new Date().toISOString()
      };
      writeFileSync(contextFile, JSON.stringify(context, null, 2));
      log(`CONTEXT written to ${contextFile}`);
    } catch (e) {
      log(`CONTEXT write failed: ${e.message}`);
    }

    // Start typing indicator immediately when we pick up a message
    if (!typingInterval) {
      const { botToken, chatId } = msg;
      sendTypingIndicator(botToken, chatId); // Send immediately
      typingInterval = setInterval(() => {
        sendTypingIndicator(botToken, chatId);
      }, 4000);
    }

    // Build content for Claude
    // If images present, use content array format for multimodal
    // Otherwise, use simple string for backward compatibility
    let content;

    if (hasImages) {
      content = [];

      // Add text first if present
      if (msg.text) {
        content.push({ type: "text", text: msg.text });
      }

      // Add images
      for (const img of msg.images) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mediaType,
            data: img.base64,
          },
        });
      }

      log(`YIELD multimodal: ${msg.text ? "text + " : ""}${msg.images.length} image(s)`);
    } else {
      // Text-only message - use simple string
      content = msg.text;
      log(`YIELD text: ${textPreview}`);
    }

    yield {
      type: "user",
      message: {
        role: "user",
        content
      }
    };
  }
}

// HTTP server to receive messages
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      sessionId,
      isProcessing,
      queueLength: messageQueue.length
    }));
    return;
  }

  // Status endpoint
  if (req.method === "GET" && url.pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ready: true,
      sessionId,
      isProcessing,
      queueLength: messageQueue.length
    }));
    return;
  }

  // Message endpoint
  if (req.method === "POST" && url.pathname === "/message") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    try {
      const data = JSON.parse(body);
      const { text, botToken, chatId, userMessageId, workerUrl, claudeSessionId, senderId, isGroup, apiKey, images, mediaGroupId } = data;

      const hasImages = images && images.length > 0;
      const textPreview = text ? text.substring(0, 30) + "..." : "[no text]";
      const imageInfo = hasImages ? ` +${images.length} image(s)` : "";
      const albumInfo = mediaGroupId ? ` (album: ${mediaGroupId})` : "";

      log(`MESSAGE received: chat=${chatId} senderId=${senderId} isGroup=${isGroup} text=${textPreview}${imageInfo}${albumInfo}`);

      // Track context for auto-snapshot and session updates
      lastKnownWorkerUrl = workerUrl;
      lastKnownChatId = chatId;
      lastKnownSenderId = senderId;
      lastKnownIsGroup = isGroup;
      lastKnownApiKey = apiKey;

      // Reset activity tracking on new message
      lastActivityTime = Date.now();
      hasAutoSnapshotted = false;

      // If this is the first message and we have a session ID to resume, update our state
      if (claudeSessionId && !sessionId) {
        sessionId = claudeSessionId;
        log(`RESUME session=${sessionId}`);
      }

      // Add to queue - the generator will pick it up
      // Note: Album buffering now happens at the telegram-bot level, so images arrive as a single batch
      enqueueMessage({ text, botToken, chatId, userMessageId, workerUrl, senderId, isGroup, apiKey, images });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ queued: true, queueLength: messageQueue.length + 1 }));
    } catch (err) {
      log(`ERROR parsing message: ${err.message}`);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

/**
 * Run the Claude query loop.
 * @param {string|undefined} resumeSessionId - Session ID to resume, or undefined for fresh start
 * @returns {Promise<void>}
 */
async function runQueryLoop(resumeSessionId) {
  log(`CLAUDE starting query loop (resume=${resumeSessionId || "none"})...`);

  // Build query options
  const queryOptions = {
    resume: resumeSessionId,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [
      "Read", "Write", "Edit",
      "Bash",
      "Glob", "Grep",
      "WebSearch", "WebFetch",
      "Task",
      "Skill"
    ],
    settingSources: ["user"],
    cwd: "/workspace/files",
    model: "claude-sonnet-4-5",
    maxTurns: 25
  };

  // Add personality prompt if loaded
  if (personalityPrompt) {
    queryOptions.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      append: personalityPrompt
    };
    log(`PERSONALITY appended (${personalityPrompt.length} chars)`);
  }

  for await (const msg of query({
    prompt: messageGenerator(),
    options: queryOptions
  })) {
    // Capture session ID
    if (msg.type === "system" && msg.subtype === "init") {
      sessionId = msg.session_id;
      log(`SESSION id=${sessionId}`);
    }

    // Log tool usage
    if (msg.type === "assistant" && msg.message?.content) {
      isProcessing = true;
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          log(`TOOL_START name=${block.name}`);
        }
      }
    }

    if (msg.type === "user" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "tool_result") {
          log(`TOOL_END id=${block.tool_use_id}`);
        }
      }
    }

    // Handle result - send to Telegram
    if (msg.type === "result") {
      isProcessing = false;

      // Clear typing interval
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
      }

      const ctx = currentRequestContext;

      if (ctx) {
        const responseText = msg.subtype === "success"
          ? msg.result
          : `Error: ${msg.subtype}${msg.errors ? "\n" + msg.errors.join("\n") : ""}`;

        log(`COMPLETE cost=$${msg.total_cost_usd?.toFixed(4)} chars=${responseText.length}`);

        // Send to Telegram
        await sendToTelegram(responseText, ctx.botToken, ctx.chatId);
        log("TELEGRAM_SENT");

        // Remove reaction
        await removeReaction(ctx.botToken, ctx.chatId, ctx.userMessageId);

        // Update R2 session
        if (sessionId && ctx.workerUrl) {
          try {
            const headers = { "Content-Type": "application/json" };
            if (ctx.apiKey) headers["X-API-Key"] = ctx.apiKey;
            await fetch(`${ctx.workerUrl}/session-update`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                chatId: ctx.chatId,
                claudeSessionId: sessionId,
                senderId: ctx.senderId,
                isGroup: ctx.isGroup
              })
            });
            log("R2_SESSION_UPDATED");
          } catch (e) {
            log(`R2_SESSION_FAILED: ${e.message}`);
          }
        }

        // Append conversation to Memvid memory (async, non-blocking)
        // Include image info in the logged message if present
        const hasImages = ctx.images && ctx.images.length > 0;
        const userMessageForLog = hasImages
          ? `[${ctx.images.length} image(s) attached]\n${ctx.text || ""}`
          : ctx.text;

        if (userMessageForLog && responseText) {
          appendToMemvid(ctx, userMessageForLog, responseText);
        }

        currentRequestContext = null;
      }
    }
  }
}

// Main: Start server and Claude query loop
async function main() {
  log("SERVER starting on port " + PORT);

  server.listen(PORT, () => {
    log("SERVER ready on port " + PORT);
  });

  // Start auto-snapshot timer
  setInterval(async () => {
    const idleTime = Date.now() - lastActivityTime;
    const idleMinutes = Math.floor(idleTime / 60000);

    if (idleTime > AUTO_SNAPSHOT_AFTER_MS && !hasAutoSnapshotted && !isProcessing) {
      log(`AUTO_SNAPSHOT triggered after ${idleMinutes} minutes idle`);
      const success = await createAutoSnapshot();
      if (success) {
        hasAutoSnapshotted = true;
      }
    }
  }, SNAPSHOT_CHECK_INTERVAL_MS);

  log("AUTO_SNAPSHOT timer started (check every 5 min, trigger at 55 min idle)");

  // Track retry state
  let hasRetried = false;

  try {
    // Start query loop (no resume on fresh container start)
    await runQueryLoop(undefined);
  } catch (err) {
    const errorMsg = err.message || "";
    const isCliExitError = errorMsg.includes("exited with code 1") ||
                           errorMsg.includes("process exited");

    // Retry once on CLI exit errors - these can be transient
    if (isCliExitError && !hasRetried) {
      log(`CLI_EXIT_ERROR detected, retrying once...`);
      log(`ERROR details: ${errorMsg}`);
      hasRetried = true;

      // Clear any stored session ID that might be stale
      if (sessionId) {
        log(`CLEARING stale sessionId=${sessionId}`);
        sessionId = null;
      }

      // Clear R2 session if we have context (in case it was orphaned)
      if (lastKnownWorkerUrl && lastKnownChatId) {
        try {
          const headers = { "Content-Type": "application/json" };
          if (lastKnownApiKey) headers["X-API-Key"] = lastKnownApiKey;
          await fetch(`${lastKnownWorkerUrl}/session-update`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              chatId: lastKnownChatId,
              claudeSessionId: null,  // Clear any orphaned session
              senderId: lastKnownSenderId,
              isGroup: lastKnownIsGroup
            })
          });
          log(`CLEARED R2 session for chat ${lastKnownChatId}`);
        } catch (clearErr) {
          log(`R2 session clear failed: ${clearErr.message}`);
        }
      }

      // Small delay before retry to let resources settle
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        // Retry with fresh state
        await runQueryLoop(undefined);
      } catch (retryErr) {
        log(`FATAL after retry: ${retryErr.message}`);
        handleFatalError(retryErr);
      }
    } else {
      // Not a CLI exit error or already retried - fail permanently
      handleFatalError(err);
    }
  }
}

/**
 * Handle fatal errors - cleanup and exit.
 */
function handleFatalError(err) {
  const errorMsg = err.message || "Unknown error";
  log(`FATAL: ${errorMsg}`);

  // Clear typing indicator to stop "typing..." from showing forever
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
    log("CLEANUP cleared typing interval");
  }

  // Try to notify user if we have context
  if (currentRequestContext) {
    const ctx = currentRequestContext;
    // Use sync-style promise to ensure we try to notify before exit
    sendToTelegram(`Server error: ${errorMsg}`, ctx.botToken, ctx.chatId)
      .then(() => removeReaction(ctx.botToken, ctx.chatId, ctx.userMessageId))
      .catch((notifyErr) => log(`CLEANUP notify failed: ${notifyErr.message}`))
      .finally(() => {
        currentRequestContext = null;
        log("CLEANUP cleared request context");
        process.exit(1);
      });
    return;
  }

  process.exit(1);
}

main().catch((err) => {
  log(`STARTUP_ERROR: ${err.message}`);
  process.exit(1);
});
