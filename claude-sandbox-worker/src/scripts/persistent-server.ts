/**
 * Persistent server script - runs an HTTP server that keeps Claude alive between messages.
 * Uses streaming input mode with async generator for message passing.
 * This provides ~50% faster response times for subsequent messages.
 */
export const PERSISTENT_SERVER_SCRIPT = `#!/usr/bin/env node

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createServer } from "http";
import { appendFileSync, writeFileSync } from "fs";

const PORT = 8080;
const LOG_FILE = "/workspace/telegram_agent.log";

// Escape text for Telegram MarkdownV2 format
// Converts Claude's natural markdown to Telegram-compatible MarkdownV2
function escapeMarkdownV2(text) {
  // Characters that need escaping in MarkdownV2 (outside of code blocks)
  // _ * [ ] ( ) ~ \` > # + - = | { } . !

  // First, handle code blocks - extract and protect them
  const codeBlockPlaceholders = [];
  let processed = text.replace(/\\\`\\\`\\\`([\\s\\S]*?)\\\`\\\`\\\`/g, (match) => {
    codeBlockPlaceholders.push(match);
    return "%%CODEBLOCK" + (codeBlockPlaceholders.length - 1) + "%%";
  });

  // Handle inline code
  const inlineCodePlaceholders = [];
  processed = processed.replace(/\\\`([^\\\`]+)\\\`/g, (match) => {
    inlineCodePlaceholders.push(match);
    return "%%INLINECODE" + (inlineCodePlaceholders.length - 1) + "%%";
  });

  // Handle markdown links [text](url) - protect them and escape URL chars
  const linkPlaceholders = [];
  processed = processed.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, (match, linkText, url) => {
    // Escape special chars in link text (but allow formatting)
    const escapedText = linkText
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/_/g, "\\\\_")
      .replace(/\\*/g, "\\\\*")
      .replace(/\\[/g, "\\\\[")
      .replace(/\\]/g, "\\\\]")
      .replace(/\\(/g, "\\\\(")
      .replace(/\\)/g, "\\\\)")
      .replace(/~/g, "\\\\~")
      .replace(/>/g, "\\\\>")
      .replace(/#/g, "\\\\#")
      .replace(/\\+/g, "\\\\+")
      .replace(/-/g, "\\\\-")
      .replace(/=/g, "\\\\=")
      .replace(/\\|/g, "\\\\|")
      .replace(/\\{/g, "\\\\{")
      .replace(/\\}/g, "\\\\}")
      .replace(/\\./g, "\\\\.")
      .replace(/!/g, "\\\\!");

    // In URLs, only escape ) and \\
    const escapedUrl = url.replace(/\\\\/g, "\\\\\\\\").replace(/\\)/g, "\\\\)");

    const formattedLink = "[" + escapedText + "](" + escapedUrl + ")";
    linkPlaceholders.push(formattedLink);
    return "%%LINK" + (linkPlaceholders.length - 1) + "%%";
  });

  // Convert **bold** to *bold* (Telegram uses single asterisks)
  processed = processed.replace(/\\*\\*(.+?)\\*\\*/g, "*\$1*");

  // Convert ~~strikethrough~~ to ~strikethrough~
  processed = processed.replace(/~~(.+?)~~/g, "~\$1~");

  // Handle italic text _content_ - protect before escaping
  const italicPlaceholders = [];
  processed = processed.replace(/_([^_\\n]+)_/g, (match, content) => {
    // Escape special chars in content (but NOT underscore - we're preserving the italic formatting)
    const escapedContent = content
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/\\[/g, "\\\\[")
      .replace(/\\]/g, "\\\\]")
      .replace(/\\(/g, "\\\\(")
      .replace(/\\)/g, "\\\\)")
      .replace(/>/g, "\\\\>")
      .replace(/#/g, "\\\\#")
      .replace(/\\+/g, "\\\\+")
      .replace(/-/g, "\\\\-")
      .replace(/=/g, "\\\\=")
      .replace(/\\|/g, "\\\\|")
      .replace(/\\{/g, "\\\\{")
      .replace(/\\}/g, "\\\\}")
      .replace(/\\./g, "\\\\.")
      .replace(/!/g, "\\\\!");
    const formattedItalic = "_" + escapedContent + "_";
    italicPlaceholders.push(formattedItalic);
    return "%%ITALIC" + (italicPlaceholders.length - 1) + "%%";
  });

  // Escape special characters (NOT underscore - italics already handled above)
  // Must escape: [ ] ( ) ~ > # + - = | { } . ! \\
  processed = processed
    .replace(/\\\\/g, "\\\\\\\\")  // Backslash first
    .replace(/_/g, "\\\\_")  // Escape remaining underscores (not part of italic formatting)
    .replace(/\\[/g, "\\\\[")
    .replace(/\\]/g, "\\\\]")
    .replace(/\\(/g, "\\\\(")
    .replace(/\\)/g, "\\\\)")
    .replace(/>/g, "\\\\>")
    .replace(/#/g, "\\\\#")
    .replace(/\\+/g, "\\\\+")
    .replace(/(?<!\\\\)-/g, "\\\\-")  // Dash (but not already escaped)
    .replace(/=/g, "\\\\=")
    .replace(/\\|/g, "\\\\|")
    .replace(/\\{/g, "\\\\{")
    .replace(/\\}/g, "\\\\}")
    .replace(/\\./g, "\\\\.")
    .replace(/!/g, "\\\\!");

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

// Timestamped logging
function log(msg) {
  const ts = new Date().toISOString();
  const line = \`[\${ts}] \${msg}\`;
  console.error(line);
  appendFileSync(LOG_FILE, line + "\\n");
}

// Send typing indicator to Telegram
async function sendTypingIndicator(botToken, chatId) {
  try {
    await fetch(\`https://api.telegram.org/bot\${botToken}/sendChatAction\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" })
    });
  } catch (err) {
    log(\`TYPING_ERROR: \${err.message}\`);
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
    let idx = remaining.lastIndexOf("\\n", maxLen);
    if (idx === -1 || idx < maxLen / 2) idx = maxLen;
    chunks.push(remaining.substring(0, idx));
    remaining = remaining.substring(idx).trimStart();
  }

  for (const chunk of chunks) {
    await fetch(\`https://api.telegram.org/bot\${botToken}/sendMessage\`, {
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
  await fetch(\`https://api.telegram.org/bot\${botToken}/setMessageReaction\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reaction: []
    })
  }).catch(() => {});
}

// Async generator that yields messages as they arrive
async function* messageGenerator() {
  while (true) {
    log("GENERATOR waiting for message...");
    const msg = await waitForNextMessage();
    log(\`GENERATOR yielding message: \${msg.text.substring(0, 50)}...\`);

    // Store context for response handling
    currentRequestContext = msg;

    // Start typing indicator immediately when we pick up a message
    if (!typingInterval) {
      const { botToken, chatId } = msg;
      sendTypingIndicator(botToken, chatId); // Send immediately
      typingInterval = setInterval(() => {
        sendTypingIndicator(botToken, chatId);
      }, 4000);
    }

    yield {
      type: "user",
      message: {
        role: "user",
        content: msg.text
      }
    };
  }
}

// HTTP server to receive messages
const server = createServer(async (req, res) => {
  const url = new URL(req.url, \`http://localhost:\${PORT}\`);

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
      const { text, botToken, chatId, userMessageId, workerUrl, claudeSessionId } = data;

      log(\`MESSAGE received: chat=\${chatId} text=\${text.substring(0, 30)}...\`);

      // If this is the first message and we have a session ID to resume, update our state
      if (claudeSessionId && !sessionId) {
        sessionId = claudeSessionId;
        log(\`RESUME session=\${sessionId}\`);
      }

      // Add to queue - the generator will pick it up
      enqueueMessage({ text, botToken, chatId, userMessageId, workerUrl });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ queued: true, queueLength: messageQueue.length + 1 }));
    } catch (err) {
      log(\`ERROR parsing message: \${err.message}\`);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// Main: Start server and Claude query loop
async function main() {
  log("SERVER starting on port " + PORT);

  server.listen(PORT, () => {
    log("SERVER ready on port " + PORT);
  });

  log("CLAUDE starting query loop with streaming input...");

  try {
    for await (const msg of query({
      prompt: messageGenerator(),
      options: {
        resume: sessionId || undefined,
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
      }
    })) {
      // Capture session ID
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id;
        log(\`SESSION id=\${sessionId}\`);
      }

      // Log tool usage
      if (msg.type === "assistant" && msg.message?.content) {
        isProcessing = true;
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            log(\`TOOL_START name=\${block.name}\`);
          }
        }
      }

      if (msg.type === "user" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "tool_result") {
            log(\`TOOL_END id=\${block.tool_use_id}\`);
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
            : \`Error: \${msg.subtype}\${msg.errors ? "\\n" + msg.errors.join("\\n") : ""}\`;

          log(\`COMPLETE cost=$\${msg.total_cost_usd?.toFixed(4)} chars=\${responseText.length}\`);

          // Send to Telegram
          await sendToTelegram(responseText, ctx.botToken, ctx.chatId);
          log("TELEGRAM_SENT");

          // Remove reaction
          await removeReaction(ctx.botToken, ctx.chatId, ctx.userMessageId);

          // Update R2 session
          if (sessionId && ctx.workerUrl) {
            try {
              await fetch(\`\${ctx.workerUrl}/session-update\`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chatId: ctx.chatId, claudeSessionId: sessionId })
              });
              log("R2_SESSION_UPDATED");
            } catch (e) {
              log(\`R2_SESSION_FAILED: \${e.message}\`);
            }
          }

          currentRequestContext = null;
        }
      }
    }
  } catch (err) {
    log(\`FATAL: \${err.message}\`);

    // Try to notify user if we have context
    if (currentRequestContext) {
      const ctx = currentRequestContext;
      await sendToTelegram(\`Server error: \${err.message}\`, ctx.botToken, ctx.chatId);
      await removeReaction(ctx.botToken, ctx.chatId, ctx.userMessageId);
    }

    process.exit(1);
  }
}

main().catch((err) => {
  log(\`STARTUP_ERROR: \${err.message}\`);
  process.exit(1);
});
`;
