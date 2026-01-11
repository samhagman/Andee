#!/usr/bin/env node

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "fs";

const input = JSON.parse(readFileSync("/workspace/input.json", "utf-8"));
const { message, claudeSessionId, botToken, chatId, userMessageId, workerUrl, senderId, isGroup } = input;

const PERSONALITY_PATH = "/home/claude/.claude/PERSONALITY.md";

// Load personality prompt at startup (appended to system prompt)
let personalityPrompt = "";
try {
  if (existsSync(PERSONALITY_PATH)) {
    personalityPrompt = readFileSync(PERSONALITY_PATH, "utf-8");
    console.error(`[STARTUP] Loaded personality from ${PERSONALITY_PATH} (${personalityPrompt.length} chars)`);
  }
} catch (e) {
  console.error(`[STARTUP] No personality file at ${PERSONALITY_PATH}, using defaults`);
}

// Timestamped logging
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.error(line);
  appendFileSync("/workspace/telegram_agent.log", line + "\n");
}

// Escape text for Telegram MarkdownV2 format
function escapeMarkdownV2(text) {
  const codeBlockPlaceholders = [];
  let processed = text.replace(/```([\s\S]*?)```/g, (match) => {
    codeBlockPlaceholders.push(match);
    return "%%CODEBLOCK" + (codeBlockPlaceholders.length - 1) + "%%";
  });

  const inlineCodePlaceholders = [];
  processed = processed.replace(/`([^`]+)`/g, (match) => {
    inlineCodePlaceholders.push(match);
    return "%%INLINECODE" + (inlineCodePlaceholders.length - 1) + "%%";
  });

  processed = processed.replace(/\*\*(.+?)\*\*/g, "*$1*");
  processed = processed.replace(/~~(.+?)~~/g, "~$1~");

  processed = processed
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/>/g, "\\>")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/(?<!\\)-/g, "\\-")
    .replace(/=/g, "\\=")
    .replace(/\|/g, "\\|")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\./g, "\\.")
    .replace(/!/g, "\\!");

  codeBlockPlaceholders.forEach((block, i) => {
    processed = processed.replace("%%CODEBLOCK" + i + "%%", block);
  });
  inlineCodePlaceholders.forEach((code, i) => {
    processed = processed.replace("%%INLINECODE" + i + "%%", code);
  });

  return processed;
}

async function sendToTelegram(text) {
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

async function removeReaction() {
  await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: userMessageId,
      reaction: []
    })
  }).catch(() => {});
}

async function main() {
  let sessionId = claudeSessionId;
  let response = "";
  let errorMessage = "";

  log(`START chat=${chatId} resume=${claudeSessionId ? "yes" : "no"}`);
  const startTime = Date.now();

  // Build query options
  const queryOptions = {
    resume: claudeSessionId || undefined,
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

  try {
    for await (const msg of query({
      prompt: message,
      options: queryOptions
    })) {
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id;
        log(`SESSION id=${sessionId}`);
      }

      // Log tool usage for timing analysis
      if (msg.type === "assistant" && msg.message?.content) {
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

      if (msg.type === "result") {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (msg.subtype === "success") {
          response = msg.result;
          log(`COMPLETE elapsed=${elapsed}s cost=$${msg.total_cost_usd?.toFixed(4)} chars=${response.length}`);
        } else {
          errorMessage = `Query ended with: ${msg.subtype}`;
          if (msg.errors) {
            errorMessage += "\n" + msg.errors.join("\n");
          }
          log(`ERROR elapsed=${elapsed}s subtype=${msg.subtype}`);
        }
      }
    }
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`EXCEPTION elapsed=${elapsed}s error=${error.message}`);
    errorMessage = error.message || "Unknown error";
  }

  const responseText = response || errorMessage || "No response from Claude";

  // Send to Telegram
  log(`TELEGRAM_SEND chars=${responseText.length}`);
  await sendToTelegram(responseText);
  log(`TELEGRAM_SENT`);

  // Remove reaction
  await removeReaction();

  // Write output for session tracking
  const output = {
    success: !errorMessage,
    response: responseText,
    claudeSessionId: sessionId
  };
  writeFileSync("/workspace/output.json", JSON.stringify(output, null, 2));

  // Update session in R2 via worker endpoint
  if (sessionId && workerUrl) {
    try {
      await fetch(`${workerUrl}/session-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, claudeSessionId: sessionId, senderId, isGroup })
      });
      log(`R2_SESSION_UPDATED`);
    } catch (e) {
      log(`R2_SESSION_FAILED error=${e.message}`);
    }
  }

  log(`DONE`);
}

main().catch(async (err) => {
  log(`FATAL error=${err.message}`);
  await sendToTelegram(`Error: ${err.message || "Unknown error"}`);
  await removeReaction();
});
