#!/usr/bin/env node

/**
 * OpenCode Persistent Server Script
 *
 * Runs inside the container to provide persistent AI inference using OpenCode SDK.
 * Uses Cerebras GLM-4.7 for cheap, fast inference with persistent server model.
 *
 * Architecture:
 * - Port 8080: HTTP server for message queue (same as Claude SDK version)
 * - Port 4096: OpenCode server for AI inference
 * - SDK client connects to OpenCode server, uses auth.set() for credentials
 *
 * Key insight: Use client.auth.set() for programmatic auth instead of auth.json file
 * See: https://opencode.ai/docs/sdk/#auth
 */

import { createOpencodeClient } from "@opencode-ai/sdk";
import { spawn } from "child_process";
import { createServer } from "http";
import { appendFileSync, writeFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import net from "net";

const HTTP_PORT = 8080;
const OPENCODE_PORT = 4096;
const LOG_FILE = "/workspace/telegram_agent.log";
const PERSONALITY_PATH = "/home/claude/CLAUDE.md";
const OPENCODE_CONFIG_PATH = "/home/claude/opencode.json";

/**
 * Generate OpenCode config with actual environment variable values.
 *
 * The static opencode.json uses {env:VAR_NAME} template syntax, but OpenCode's
 * MCP spawning doesn't resolve these templates for the `environment` field.
 * This function writes the config with actual values at runtime.
 */
function generateOpencodeConfig() {
  const config = {
    "$schema": "https://opencode.ai/config.json",
    "permission": {
      "*": "allow"
    },
    "mcp": {
      "perplexity": {
        "type": "local",
        "command": ["npx", "-y", "server-perplexity-ask"],
        "enabled": true,
        "environment": {
          // Substitute actual env value - OpenCode doesn't resolve {env:...} for MCP environment
          "PERPLEXITY_API_KEY": process.env.PERPLEXITY_API_KEY || ""
        }
      }
    },
    "provider": {
      "cerebras": {
        "npm": "@ai-sdk/openai-compatible",
        "name": "Cerebras",
        "options": {
          "baseURL": "https://api.cerebras.ai/v1",
          // Provider apiKey DOES support {env:...} but we'll use actual value for consistency
          "apiKey": process.env.CEREBRAS_API_KEY || ""
        },
        "models": {
          "zai-glm-4.7": {
            "name": "GLM-4.7",
            "limit": {
              "context": 200000,
              "output": 65536
            }
          }
        }
      }
    },
    "model": "cerebras/zai-glm-4.7"
  };

  writeFileSync(OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2));

  // Log key presence (not values) for debugging
  const hasPerplexity = !!process.env.PERPLEXITY_API_KEY;
  const hasCerebras = !!process.env.CEREBRAS_API_KEY;
  console.error(`[STARTUP] Generated opencode.json (perplexity=${hasPerplexity}, cerebras=${hasCerebras})`);
}

// Load personality prompt at startup
let personalityPrompt = "";
try {
  personalityPrompt = readFileSync(PERSONALITY_PATH, "utf-8");
  console.error(`[STARTUP] Loaded personality from ${PERSONALITY_PATH} (${personalityPrompt.length} chars)`);
} catch (e) {
  console.error(`[STARTUP] No personality file at ${PERSONALITY_PATH}, using defaults`);
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

  const linkPlaceholders = [];
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
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
    const escapedUrl = url.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
    const formattedLink = "[" + escapedText + "](" + escapedUrl + ")";
    linkPlaceholders.push(formattedLink);
    return "%%LINK" + (linkPlaceholders.length - 1) + "%%";
  });

  processed = processed.replace(/\*\*(.+?)\*\*/g, "*$1*");
  processed = processed.replace(/~~(.+?)~~/g, "~$1~");

  const italicPlaceholders = [];
  processed = processed.replace(/_([^_\n]+)_/g, (match, content) => {
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

  processed = processed
    .replace(/\\/g, "\\\\")
    .replace(/_/g, "\\_")
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

  italicPlaceholders.forEach((italic, i) => {
    processed = processed.replace("%%ITALIC" + i + "%%", italic);
  });
  linkPlaceholders.forEach((link, i) => {
    processed = processed.replace("%%LINK" + i + "%%", link);
  });
  codeBlockPlaceholders.forEach((block, i) => {
    processed = processed.replace("%%CODEBLOCK" + i + "%%", block);
  });
  inlineCodePlaceholders.forEach((code, i) => {
    processed = processed.replace("%%INLINECODE" + i + "%%", code);
  });

  return processed;
}

// State
let opencodeClient = null;
let sessionId = null;
let authConfigured = false;
let isProcessing = false;
const messageQueue = [];
let resolveNextMessage = null;
let currentRequestContext = null;
let typingInterval = null;

// Context tracking for snapshots
let lastKnownWorkerUrl = null;
let lastKnownChatId = null;
let lastKnownSenderId = null;
let lastKnownIsGroup = null;
let lastKnownApiKey = null;

// R2 mount detection for memvid storage
const isR2Mounted = () => {
  try {
    const files = readdirSync('/media');
    return files.length > 0 || existsSync('/media/.memvid');
  } catch {
    return false;
  }
};

const getMediaBase = () => isR2Mounted() ? '/media' : '/tmp/media';

const getMemoryFilePath = (chatId) => {
  const base = getMediaBase();
  return `${base}/conversation-history/${chatId}/memory.mv2`;
};

const getModelsDir = () => `${getMediaBase()}/.memvid/models`;

// Timestamped logging
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.error(line);
  appendFileSync(LOG_FILE, line + "\n");
}

// Memvid auto-recovery helpers

/**
 * Check if error indicates TOC/file corruption
 */
function isMemvidCorruption(errorMessage) {
  const corruptionPatterns = [
    'TOC',
    'sequence length',
    'footer',
    'Deserialization error',
    'unable to recover table of contents'
  ];
  return corruptionPatterns.some(pattern =>
    errorMessage.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Attempt to repair corrupted memvid file using doctor command
 */
function tryMemvidDoctor(memoryFile, memvidEnv) {
  log(`MEMVID_DOCTOR attempting repair of ${memoryFile}`);
  try {
    execSync(`memvid doctor "${memoryFile}"`, {
      timeout: 60000,
      env: memvidEnv
    });
    log(`MEMVID_DOCTOR repair succeeded`);
    return true;
  } catch (e) {
    log(`MEMVID_DOCTOR repair failed: ${e.message}`);
    return false;
  }
}

/**
 * Reset corrupted memory file by deleting and creating fresh
 */
function resetMemvidFile(memoryFile, memvidEnv) {
  log(`MEMVID_RESET deleting corrupted file and creating fresh: ${memoryFile}`);
  try {
    if (existsSync(memoryFile)) {
      unlinkSync(memoryFile);
      log(`MEMVID_RESET deleted corrupted file`);
    }
    execSync(`memvid create "${memoryFile}"`, {
      timeout: 60000,
      env: memvidEnv
    });
    log(`MEMVID_RESET created fresh memory file (previous history lost)`);
    return true;
  } catch (e) {
    log(`MEMVID_RESET failed: ${e.message}`);
    return false;
  }
}

// Append to Memvid memory (with auto-recovery on corruption)
function appendToMemvid(ctx, userMessage, assistantResponse) {
  try {
    const memoryFile = getMemoryFilePath(ctx.chatId);
    const memoryDir = memoryFile.replace(/\/[^/]+$/, '');
    const modelsDir = getModelsDir();
    const mediaBase = getMediaBase();

    log(`MEMVID using path: ${memoryFile} (base: ${mediaBase})`);

    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true });
      log(`MEMVID created dir: ${memoryDir}`);
    }

    if (!existsSync(modelsDir)) {
      mkdirSync(modelsDir, { recursive: true });
      log(`MEMVID created models dir: ${modelsDir}`);
    }

    const memvidEnv = { ...process.env, MEMVID_MODELS_DIR: modelsDir };

    if (!existsSync(memoryFile)) {
      try {
        execSync(`memvid create "${memoryFile}"`, {
          timeout: 60000,
          env: memvidEnv
        });
        log(`MEMVID created new memory file: ${memoryFile}`);
      } catch (e) {
        log(`MEMVID create failed: ${e.message}`);
        return;
      }
    }

    const timestamp = new Date().toISOString();
    const tempDir = '/tmp/memvid';

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Track if we've already attempted recovery to avoid infinite loops
    let recoveryAttempted = false;

    // Helper to execute memvid put with auto-recovery on corruption
    const memvidPutWithRecovery = (inputFile, title) => {
      try {
        execSync(`memvid put "${memoryFile}" --input "${inputFile}" --title "${title}" --label "conversation"`, {
          timeout: 30000,
          env: memvidEnv
        });
        return true;
      } catch (e) {
        if (isMemvidCorruption(e.message) && !recoveryAttempted) {
          recoveryAttempted = true;
          log(`MEMVID corruption detected, attempting recovery...`);

          // Try doctor first
          if (tryMemvidDoctor(memoryFile, memvidEnv)) {
            try {
              execSync(`memvid put "${memoryFile}" --input "${inputFile}" --title "${title}" --label "conversation"`, {
                timeout: 30000,
                env: memvidEnv
              });
              log(`MEMVID retry after doctor succeeded`);
              return true;
            } catch (retryErr) {
              log(`MEMVID retry after doctor failed: ${retryErr.message}`);
            }
          }

          // Doctor failed, reset the file
          if (resetMemvidFile(memoryFile, memvidEnv)) {
            try {
              execSync(`memvid put "${memoryFile}" --input "${inputFile}" --title "${title}" --label "conversation"`, {
                timeout: 30000,
                env: memvidEnv
              });
              log(`MEMVID retry after reset succeeded`);
              return true;
            } catch (resetRetryErr) {
              log(`MEMVID retry after reset failed: ${resetRetryErr.message}`);
            }
          }
        }
        throw e;
      }
    };

    const userTempFile = `${tempDir}/user_${Date.now()}.txt`;
    try {
      writeFileSync(userTempFile, userMessage);
      if (memvidPutWithRecovery(userTempFile, `user @ ${timestamp}`)) {
        log("MEMVID appended user turn");
      }
    } catch (e) {
      log(`MEMVID user append failed: ${e.message}`);
    } finally {
      try { execSync(`rm -f "${userTempFile}"`); } catch {}
    }

    const assistantTempFile = `${tempDir}/assistant_${Date.now()}.txt`;
    try {
      writeFileSync(assistantTempFile, assistantResponse);
      if (memvidPutWithRecovery(assistantTempFile, `assistant @ ${timestamp}`)) {
        log("MEMVID appended assistant turn");
      }
    } catch (e) {
      log(`MEMVID assistant append failed: ${e.message}`);
    } finally {
      try { execSync(`rm -f "${assistantTempFile}"`); } catch {}
    }

  } catch (err) {
    log(`MEMVID error: ${err.message}`);
  }
}

// Send typing indicator
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

// Message queue functions
function waitForNextMessage() {
  return new Promise((resolve) => {
    if (messageQueue.length > 0) {
      resolve(messageQueue.shift());
    } else {
      resolveNextMessage = resolve;
    }
  });
}

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

// Filter OpenCode response (same >>> delimiter pattern as Goose)
function filterResponse(response) {
  const delimiterMatch = response.match(/>>>\s*([\s\S]+)$/);
  if (delimiterMatch) {
    return delimiterMatch[1].replace(/\n{3,}/g, "\n\n").trim();
  }

  // Fallback: minimal cleanup
  let filtered = response;
  filtered = filtered.replace(/^─+.*─+$/gm, "");
  filtered = filtered.replace(/^(path|command|content):\s*.*$/gim, "");
  filtered = filtered.replace(/\n{3,}/g, "\n\n");
  return filtered.trim();
}

// Trigger async snapshot
async function triggerAsyncSnapshot(msg) {
  if (!msg.workerUrl || !msg.chatId) {
    log("ASYNC_SNAPSHOT skipped: missing workerUrl or chatId");
    return;
  }

  try {
    const headers = { "Content-Type": "application/json" };
    if (msg.apiKey) headers["X-API-Key"] = msg.apiKey;

    const response = await fetch(`${msg.workerUrl}/snapshot`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        chatId: msg.chatId,
        senderId: msg.senderId,
        isGroup: msg.isGroup
      })
    });

    if (response.ok) {
      const result = await response.json();
      log(`ASYNC_SNAPSHOT success: ${result.key || "created"}`);
    } else {
      log(`ASYNC_SNAPSHOT failed: ${response.status}`);
    }
  } catch (err) {
    log(`ASYNC_SNAPSHOT error: ${err.message}`);
  }
}

// Write context file for skill scripts
function writeContextFile(msg) {
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
}

// Wait for port to be available
function waitForPort(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const tryConnect = () => {
      const socket = new net.Socket();

      socket.on("connect", () => {
        socket.destroy();
        resolve();
      });

      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });

      socket.connect(port, "127.0.0.1");
    };

    tryConnect();
  });
}

// Generate system prompt for OpenCode
function generateSystemPrompt(chatId, senderId) {
  return `${personalityPrompt}

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

## Processing Attached Media (<attached_media_context> blocks)

When the message contains an \`<attached_media_context>\` block, it means:
- The user sent media (image, video, document)
- The file has been saved to the path shown
- A detailed description of the content is provided

Example:
\`\`\`
<attached_media_context>
**Attached Media:**
• photo: /tmp/media/123/456/photos/2026-01-16-abc.png

**Content Description:**
**Whisky Sour Recipe**

This vintage-style cocktail card shows:

**Ingredients:**
• 2 oz bourbon or rye whiskey
• 1 oz fresh lemon juice
• 3/4 oz simple syrup
• Egg white (optional)
• Angostura bitters

**Instructions:**
• Dry shake all ingredients without ice
• Add ice and shake again until chilled
• Strain into rocks glass with fresh ice
• Garnish with lemon wheel and cherry
</attached_media_context>

Save this recipe to my recipes
\`\`\`

Use the description and the user's request to decide what action to take.
If they ask to save something, use the **managing-artifacts** skill.

## CRITICAL: You MUST Use Tools

You have developer tools available:
- **shell**: Run bash commands
- **read_file**: Read file contents
- **write_file**: Write/create files
- **patch_file**: Edit existing files

When user asks to SAVE something (recipe, list, note), you MUST:
1. Run: \`cat ~/.claude/skills/managing-artifacts/SKILL.md\` to read the skill
2. Run: \`/home/claude/.claude/skills/managing-artifacts/scripts/create-artifact.sh {type} "{title}" {senderId}\`
3. Write the content to the created file
4. Respond with confirmation

**WARNING:** Do NOT just say "Done!" or "Saved!" without actually running the commands.
If you skip the tool calls, the artifact will NOT be saved and you will have lied to the user.

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

// HTTP server for message queue
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      sessionId,
      authConfigured,
      isProcessing,
      queueLength: messageQueue.length,
      engine: "opencode"
    }));
    return;
  }

  // Status endpoint
  if (req.method === "GET" && url.pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ready: opencodeClient !== null && authConfigured,
      sessionId,
      isProcessing,
      queueLength: messageQueue.length,
      engine: "opencode"
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
      const { text, botToken, chatId, userMessageId, workerUrl, claudeSessionId, senderId, isGroup, apiKey, images, document, mediaPaths } = data;

      const textPreview = text ? text.substring(0, 30) + "..." : "[no text]";
      log(`MESSAGE received: chat=${chatId} senderId=${senderId} isGroup=${isGroup} text=${textPreview}`);

      // Track context
      lastKnownWorkerUrl = workerUrl;
      lastKnownChatId = chatId;
      lastKnownSenderId = senderId;
      lastKnownIsGroup = isGroup;
      lastKnownApiKey = apiKey;

      // Resume session if provided
      if (claudeSessionId && !sessionId) {
        sessionId = claudeSessionId;
        log(`RESUME session=${sessionId}`);
      }

      // Enqueue message
      enqueueMessage({ text, botToken, chatId, userMessageId, workerUrl, senderId, isGroup, apiKey, images, document, mediaPaths });

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
 * Start OpenCode server and connect SDK client with auth
 */
async function startOpenCodeServer() {
  log("OPENCODE starting server on port " + OPENCODE_PORT);

  // Start OpenCode server as background process from /home/claude
  // The working directory affects session directory and tool execution
  const opencodeServer = spawn("opencode", ["serve", "--port", String(OPENCODE_PORT)], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: "/home/claude",
    env: {
      ...process.env,
      HOME: "/home/claude",
      CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
      PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY
    }
  });

  // Log server output
  opencodeServer.stdout.on("data", (data) => {
    log(`OPENCODE_SERVER stdout: ${data.toString().trim()}`);
  });
  opencodeServer.stderr.on("data", (data) => {
    log(`OPENCODE_SERVER stderr: ${data.toString().trim()}`);
  });

  opencodeServer.on("error", (err) => {
    log(`OPENCODE_SERVER error: ${err.message}`);
  });

  // Detach so it runs independently
  opencodeServer.unref();

  // Wait for server to be ready
  log("OPENCODE waiting for server to be ready...");
  await waitForPort(OPENCODE_PORT, 60000);
  log("OPENCODE server ready on port " + OPENCODE_PORT);

  // Connect SDK client
  opencodeClient = createOpencodeClient({
    baseUrl: `http://127.0.0.1:${OPENCODE_PORT}`
  });
  log("OPENCODE SDK client connected");

  // Configure authentication using auth.set() API
  // See: https://opencode.ai/docs/sdk/#auth
  const cerebrasApiKey = process.env.CEREBRAS_API_KEY;
  if (cerebrasApiKey) {
    log("OPENCODE configuring Cerebras auth via SDK auth.set()...");
    try {
      await opencodeClient.auth.set({
        path: { id: "cerebras" },
        body: { type: "api", key: cerebrasApiKey }
      });
      authConfigured = true;
      log("OPENCODE Cerebras auth configured successfully");
    } catch (authErr) {
      log(`OPENCODE auth.set() error: ${authErr.message}`);
      log(`OPENCODE auth.set() full error: ${JSON.stringify(authErr)}`);
    }
  } else {
    log("WARNING: CEREBRAS_API_KEY not set, OpenCode may not work");
  }
}

/**
 * Process messages using OpenCode SDK
 */
async function runMessageLoop() {
  log(`LOOP starting (session=${sessionId || "fresh"})`);

  while (true) {
    log("LOOP waiting for message...");
    const msg = await waitForNextMessage();

    const textPreview = msg.text ? msg.text.substring(0, 50) + "..." : "[no text]";
    log(`LOOP processing: ${textPreview}`);

    currentRequestContext = msg;
    writeContextFile(msg);

    // Start typing indicator
    const { botToken, chatId } = msg;
    sendTypingIndicator(botToken, chatId);
    typingInterval = setInterval(() => {
      sendTypingIndicator(botToken, chatId);
    }, 4000);

    isProcessing = true;

    try {
      // Create session if needed - also validate session format is OpenCode (ses_*)
      // Claude SDK uses UUIDs, OpenCode uses ses_* prefix - must detect mismatch
      if (!sessionId || !sessionId.startsWith('ses_')) {
        if (sessionId && !sessionId.startsWith('ses_')) {
          log(`OPENCODE invalid session format (not ses_*): ${sessionId} - creating new`);
          sessionId = null; // Clear invalid session
        }
        log("OPENCODE creating new session...");
        const session = await opencodeClient.session.create({
          body: { title: `Chat ${chatId}` }
        });
        // Log full session object to debug
        log(`OPENCODE session response: ${JSON.stringify(session)}`);
        // SDK returns session in data.id format
        sessionId = session?.data?.id || session?.path || session?.id;
        log(`OPENCODE session created: ${sessionId}`);

        if (!sessionId) {
          throw new Error("Failed to create session - no session ID returned");
        }

        // Inject system prompt (noReply = don't generate response)
        const systemPrompt = generateSystemPrompt(chatId, msg.senderId || "unknown");
        log("OPENCODE injecting system prompt...");
        await opencodeClient.session.prompt({
          path: { id: sessionId },
          body: {
            noReply: true,
            parts: [{ type: "text", text: systemPrompt }]
          }
        });
        log("OPENCODE system prompt injected");
      }

      // Subscribe to events BEFORE sending prompt to monitor tool execution
      log(`OPENCODE subscribing to events for session ${sessionId}...`);
      let eventSubscription = null;
      let eventCount = 0;

      try {
        // Subscribe to server events to monitor tool execution
        eventSubscription = await opencodeClient.event.subscribe();
        log(`OPENCODE event subscription started`);

        // Start async event logging (fire and forget)
        (async () => {
          try {
            for await (const event of eventSubscription) {
              eventCount++;
              const eventStr = JSON.stringify(event).substring(0, 200);
              log(`OPENCODE_EVENT[${eventCount}]: ${eventStr}`);

              // Log tool-specific events
              if (event?.type?.includes('tool') || event?.type?.includes('part')) {
                log(`OPENCODE_TOOL_EVENT: ${JSON.stringify(event)}`);
              }
            }
          } catch (eventErr) {
            log(`OPENCODE event stream error: ${eventErr.message}`);
          }
        })();
      } catch (subErr) {
        log(`OPENCODE event subscription failed (continuing): ${subErr.message}`);
      }

      // Send user message using promptAsync to monitor progress
      log(`OPENCODE sending message to session ${sessionId} (async with events)...`);
      const promptStart = Date.now();

      let result;
      let responseText = "";

      try {
        // Use synchronous prompt - events will show what's happening
        result = await opencodeClient.session.prompt({
          path: { id: sessionId },
          body: {
            model: { providerID: "cerebras", modelID: "zai-glm-4.7" },
            parts: [{ type: "text", text: msg.text || "" }]
          }
        });

        const elapsed = Date.now() - promptStart;
        log(`OPENCODE prompt completed in ${elapsed}ms`);
        log(`OPENCODE result: ${JSON.stringify(result).substring(0, 500)}`);

        // Extract response text from result
        const data = result?.data || result;

        // Try different response formats
        if (data?.parts && Array.isArray(data.parts)) {
          // Log all part types for debugging
          const partTypes = data.parts.map(p => p.type || 'unknown').join(', ');
          log(`OPENCODE parts types: [${partTypes}]`);

          for (const part of data.parts) {
            // Primary: look for text parts
            if (part.type === "text" && part.text) {
              responseText += part.text;
            }
            // Fallback: some parts might have text without type field
            else if (!part.type && part.text) {
              responseText += part.text;
            }
            // Check for 'step' parts which may contain text (OpenCode uses these)
            else if (part.type === "step" && part.text) {
              responseText += part.text;
            }
          }
        }
        if (!responseText && typeof data?.content === "string") {
          responseText = data.content;
        }
        if (!responseText && typeof data?.text === "string") {
          responseText = data.text;
        }

        // If still no text, log full parts for debugging
        if (!responseText && data?.parts) {
          log(`OPENCODE no text found in parts: ${JSON.stringify(data.parts).substring(0, 1000)}`);
        }

      } catch (promptErr) {
        const elapsed = Date.now() - promptStart;
        log(`OPENCODE prompt error after ${elapsed}ms: ${promptErr.message}`);

        // If it timed out, try to recover by checking messages
        if (promptErr.message.includes("fetch failed") || elapsed > 60000) {
          log(`OPENCODE attempting recovery via messages API...`);

          try {
            const messagesResult = await opencodeClient.session.messages({ path: { id: sessionId } });
            const messages = messagesResult?.data || [];

            // Find the last completed assistant message
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i];
              const role = msg?.info?.role;
              const isCompleted = msg?.info?.time?.completed > 0;

              if (role === "assistant" && isCompleted && msg.parts) {
                for (const part of msg.parts) {
                  if (part.type === "text" && part.text) {
                    responseText += part.text;
                  }
                }
                if (responseText) {
                  log(`OPENCODE recovered response from messages API`);
                  break;
                }
              }
            }
          } catch (recoveryErr) {
            log(`OPENCODE recovery failed: ${recoveryErr.message}`);
          }
        }

        if (!responseText) {
          throw promptErr;
        }
      }

      if (!responseText) {
        // Check if tools were used (might explain missing text)
        const partTypes = result?.data?.parts?.map(p => p.type).join(', ') || 'none';
        log(`OPENCODE extraction failed. Part types: [${partTypes}]`);
        throw new Error(`No response text extracted from OpenCode result (parts: ${partTypes})`);
      }

      log(`OPENCODE response (${responseText.length} chars): ${responseText.substring(0, 100)}...`)

      // Filter response for Telegram
      const filteredResponse = filterResponse(responseText);
      log(`OPENCODE response (${filteredResponse.length} chars): ${filteredResponse.substring(0, 100)}...`);

      // Clear typing indicator
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
      }
      isProcessing = false;

      // Send to Telegram
      if (filteredResponse) {
        await sendToTelegram(filteredResponse, msg.botToken, msg.chatId);
        log("TELEGRAM_SENT");
      } else {
        log("WARN: Empty response from OpenCode");
        await sendToTelegram("I couldn't generate a response. Please try again.", msg.botToken, msg.chatId);
      }

      // Fire-and-forget snapshot
      triggerAsyncSnapshot(msg).catch(err => {
        log(`ASYNC_SNAPSHOT error: ${err.message}`);
      });

      // Remove reaction
      await removeReaction(msg.botToken, msg.chatId, msg.userMessageId);

      // Append to memvid
      if (msg.text && filteredResponse) {
        appendToMemvid(msg, msg.text, filteredResponse);
      }

    } catch (err) {
      log(`OPENCODE_ERROR: ${err.message}`);
      if (err.stack) {
        log(`OPENCODE_STACK: ${err.stack}`);
      }

      // Clear typing indicator on error
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
      }
      isProcessing = false;

      // Notify user of error
      try {
        await sendToTelegram(`Error: ${err.message}`, msg.botToken, msg.chatId);
        await removeReaction(msg.botToken, msg.chatId, msg.userMessageId);
      } catch (notifyErr) {
        log(`NOTIFY_ERROR: ${notifyErr.message}`);
      }

      // Reset session on error (may be corrupted)
      sessionId = null;
    }

    currentRequestContext = null;
    log("LOOP iteration complete, waiting for next message...");
  }
}

// Main entry point
async function main() {
  log("STARTUP OpenCode persistent server (SDK with auth.set)");

  // Generate OpenCode config with actual env values (fixes MCP env template issue)
  generateOpencodeConfig();

  // Start HTTP server first
  server.listen(HTTP_PORT, () => {
    log("HTTP_SERVER ready on port " + HTTP_PORT);
  });

  // Start OpenCode server and connect client with auth
  await startOpenCodeServer();

  // Run message processing loop
  await runMessageLoop();
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
