import { getSandbox, Sandbox } from "@cloudflare/sandbox";

// Re-export Sandbox for Durable Object binding
export { Sandbox } from "@cloudflare/sandbox";

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ANTHROPIC_API_KEY: string;
  SESSIONS: R2Bucket;  // For session persistence
}

interface AskRequest {
  chatId: string;
  message: string;
  claudeSessionId: string | null;
}

// New endpoint for fire-and-forget Telegram processing
interface AskTelegramRequest {
  chatId: string;
  message: string;
  claudeSessionId: string | null;
  botToken: string;
  userMessageId: number;  // To remove reaction when done
}

interface SessionData {
  claudeSessionId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ResetRequest {
  chatId: string;
}

interface AgentOutput {
  success: boolean;
  response: string;
  claudeSessionId: string | null;
}

// Agent script content - embedded for simplicity (legacy sync mode)
const AGENT_SCRIPT = `#!/usr/bin/env node

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync } from "fs";

const input = JSON.parse(readFileSync("/workspace/input.json", "utf-8"));
const { message, claudeSessionId } = input;

async function main() {
  let sessionId = claudeSessionId;
  let response = "";
  let errorMessage = "";

  console.error(\`[Agent] Starting query (resume: \${claudeSessionId ? "yes" : "no"})\`);

  try {
    for await (const msg of query({
      prompt: message,
      options: {
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
      }
    })) {
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id;
        console.error(\`[Agent] Session initialized: \${sessionId}\`);
      }

      if (msg.type === "result") {
        if (msg.subtype === "success") {
          response = msg.result;
          console.error(\`[Agent] Query completed. Cost: $\${msg.total_cost_usd?.toFixed(4)}\`);
        } else {
          errorMessage = \`Query ended with: \${msg.subtype}\`;
          if (msg.errors) {
            errorMessage += "\\n" + msg.errors.join("\\n");
          }
        }
      }
    }
  } catch (error) {
    console.error("[Agent] Error:", error);
    errorMessage = error.message || "Unknown error";
  }

  const output = {
    success: !errorMessage,
    response: response || errorMessage || "No response from Claude",
    claudeSessionId: sessionId
  };

  writeFileSync("/workspace/output.json", JSON.stringify(output, null, 2));
  console.error("[Agent] Output written to /workspace/output.json");
}

main().catch(console.error);
`;

// Streaming agent - writes progress to file instead of HTTP
const AGENT_STREAM_SCRIPT = `#!/usr/bin/env node

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync } from "fs";

const input = JSON.parse(readFileSync("/workspace/input.json", "utf-8"));
const { message, claudeSessionId } = input;

// Progress file for streaming updates
const PROGRESS_FILE = "/workspace/progress.json";

function writeProgress(state) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  let sessionId = claudeSessionId;
  let text = "";

  writeProgress({ text: "", done: false, sessionId: null, error: null });
  console.error("[Agent] Starting streaming query...");

  try {
    for await (const msg of query({
      prompt: message,
      options: {
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
      }
    })) {
      // Debug: log all message types to understand SDK streaming behavior
      console.error(\`[Agent] Message: type=\${msg.type} subtype=\${msg.subtype || "none"}\`);

      // Capture session ID
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id;
        console.error(\`[Agent] Session: \${sessionId}\`);
        writeProgress({ text, done: false, sessionId, error: null });
      }

      // Capture assistant text - accumulate content from each turn
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            text = block.text;
            console.error(\`[Agent] Got text: \${text.length} chars\`);
            writeProgress({ text, done: false, sessionId, error: null });
          }
        }
      }

      // Capture final result
      if (msg.type === "result") {
        if (msg.subtype === "success") {
          text = msg.result;
          console.error("[Agent] Query completed successfully");
          writeProgress({ text, done: true, sessionId, error: null });
        } else {
          let error = \`Query ended: \${msg.subtype}\`;
          if (msg.errors) {
            error += "\\n" + msg.errors.join("\\n");
          }
          writeProgress({ text, done: true, sessionId, error });
        }
      }
    }
  } catch (error) {
    console.error("[Agent] Error:", error);
    writeProgress({ text, done: true, sessionId, error: error.message || "Unknown error" });
  }
}

main().catch(console.error);
`;

// Telegram agent - runs query AND sends to Telegram directly (for background execution)
const AGENT_TELEGRAM_SCRIPT = `#!/usr/bin/env node

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync, appendFileSync } from "fs";

const input = JSON.parse(readFileSync("/workspace/input.json", "utf-8"));
const { message, claudeSessionId, botToken, chatId, userMessageId, workerUrl } = input;

// Timestamped logging
function log(msg) {
  const ts = new Date().toISOString();
  const line = \`[\${ts}] \${msg}\`;
  console.error(line);
  appendFileSync("/workspace/telegram_agent.log", line + "\\n");
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
        text: chunk,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
  }
}

async function removeReaction() {
  await fetch(\`https://api.telegram.org/bot\${botToken}/setMessageReaction\`, {
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

  log(\`START chat=\${chatId} resume=\${claudeSessionId ? "yes" : "no"}\`);
  const startTime = Date.now();

  try {
    for await (const msg of query({
      prompt: message,
      options: {
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
      }
    })) {
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id;
        log(\`SESSION id=\${sessionId}\`);
      }

      // Log tool usage for timing analysis
      if (msg.type === "assistant" && msg.message?.content) {
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

      if (msg.type === "result") {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (msg.subtype === "success") {
          response = msg.result;
          log(\`COMPLETE elapsed=\${elapsed}s cost=$\${msg.total_cost_usd?.toFixed(4)} chars=\${response.length}\`);
        } else {
          errorMessage = \`Query ended with: \${msg.subtype}\`;
          if (msg.errors) {
            errorMessage += "\\n" + msg.errors.join("\\n");
          }
          log(\`ERROR elapsed=\${elapsed}s subtype=\${msg.subtype}\`);
        }
      }
    }
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(\`EXCEPTION elapsed=\${elapsed}s error=\${error.message}\`);
    errorMessage = error.message || "Unknown error";
  }

  const responseText = response || errorMessage || "No response from Claude";

  // Send to Telegram
  log(\`TELEGRAM_SEND chars=\${responseText.length}\`);
  await sendToTelegram(responseText);
  log(\`TELEGRAM_SENT\`);

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
      await fetch(\`\${workerUrl}/session-update\`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, claudeSessionId: sessionId })
      });
      log(\`R2_SESSION_UPDATED\`);
    } catch (e) {
      log(\`R2_SESSION_FAILED error=\${e.message}\`);
    }
  }

  log(\`DONE\`);
}

main().catch(async (err) => {
  log(\`FATAL error=\${err.message}\`);
  await sendToTelegram(\`Error: \${err.message || "Unknown error"}\`);
  await removeReaction();
});
`;

// Persistent server script - runs an HTTP server that keeps Claude alive between messages
// Uses streaming input mode with async generator for message passing
const PERSISTENT_SERVER_SCRIPT = `#!/usr/bin/env node

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createServer } from "http";
import { appendFileSync, writeFileSync } from "fs";

const PORT = 8080;
const LOG_FILE = "/workspace/telegram_agent.log";

// State
let sessionId = null;
let isProcessing = false;
const messageQueue = [];
let resolveNextMessage = null;
let currentRequestContext = null;

// Timestamped logging
function log(msg) {
  const ts = new Date().toISOString();
  const line = \`[\${ts}] \${msg}\`;
  console.error(line);
  appendFileSync(LOG_FILE, line + "\\n");
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
        text: chunk,
        parse_mode: "HTML",
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers for local development
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", service: "claude-sandbox-worker" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Diagnostic endpoint - test claude CLI inside container
    if (url.pathname === "/diag" && request.method === "GET") {
      try {
        const sandbox = getSandbox(env.Sandbox, "diagnostic-test2", {});

        // Test 1: Check environment
        const envResult = await sandbox.exec("echo HOME=$HOME && echo USER=$USER && whoami && pwd", { timeout: 10000 });

        // Test 2: Check .claude directory
        const claudeDirResult = await sandbox.exec("ls -la ~/.claude 2>&1 || echo 'No .claude dir'", { timeout: 10000 });

        // Test 3: Check claude version
        const versionResult = await sandbox.exec("claude --version", { timeout: 30000 });

        // Test 4: Try agent SDK with detailed error capture
        const agentTestScript = `
import { query } from "@anthropic-ai/claude-agent-sdk";
async function test() {
  try {
    console.error("Starting SDK test...");
    console.error("ANTHROPIC_API_KEY set:", !!process.env.ANTHROPIC_API_KEY);
    console.error("HOME:", process.env.HOME);

    for await (const msg of query({
      prompt: "say hello",
      options: {
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: [],
        maxTurns: 1
      }
    })) {
      console.error("Message type:", msg.type, msg.subtype || "");
      if (msg.type === "result") {
        console.log(JSON.stringify({ success: true, result: msg.result }));
      }
    }
  } catch (err) {
    console.error("SDK Error:", err.message);
    console.error("Stack:", err.stack);
    console.log(JSON.stringify({ success: false, error: err.message }));
  }
}
test();
`;
        await sandbox.writeFile("/workspace/sdk_test.mjs", agentTestScript);

        // Create .claude directory and try to initialize
        await sandbox.exec("mkdir -p /root/.claude", { timeout: 5000 });

        // First run claude --version with HOME set to ensure initialization
        const initResult = await sandbox.exec(
          `HOME=/root ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY} claude --version 2>&1`,
          { timeout: 30000 }
        );

        // Check what's in .claude now
        const claudeDirAfter = await sandbox.exec("ls -la /root/.claude 2>&1", { timeout: 5000 });

        // Try running claude without --print (like SDK does) with echo input
        const claudeRawResult = await sandbox.exec(
          `echo "say hi" | HOME=/root ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY} timeout 30 claude --dangerously-skip-permissions 2>&1 || echo "Exit code: $?"`,
          { timeout: 60000 }
        );

        // Now try the SDK
        const sdkResult = await sandbox.exec(
          `HOME=/root ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY} node /workspace/sdk_test.mjs 2>&1`,
          { timeout: 120000 }
        );

        return Response.json({
          env: { exitCode: envResult.exitCode, stdout: envResult.stdout, stderr: envResult.stderr },
          claudeDir: { exitCode: claudeDirResult.exitCode, stdout: claudeDirResult.stdout, stderr: claudeDirResult.stderr },
          version: { exitCode: versionResult.exitCode, stdout: versionResult.stdout, stderr: versionResult.stderr },
          init: { exitCode: initResult.exitCode, stdout: initResult.stdout, stderr: initResult.stderr },
          claudeDirAfter: { exitCode: claudeDirAfter.exitCode, stdout: claudeDirAfter.stdout, stderr: claudeDirAfter.stderr },
          claudeRaw: { exitCode: claudeRawResult.exitCode, stdout: claudeRawResult.stdout, stderr: claudeRawResult.stderr },
          sdkTest: { exitCode: sdkResult.exitCode, stdout: sdkResult.stdout, stderr: sdkResult.stderr }
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500, headers: corsHeaders });
      }
    }

    // Main endpoint: /ask
    if (url.pathname === "/ask" && request.method === "POST") {
      try {
        const body = await request.json() as AskRequest;
        const { chatId, message, claudeSessionId } = body;

        if (!chatId || !message) {
          return Response.json(
            { error: "Missing chatId or message" },
            { status: 400, headers: corsHeaders }
          );
        }

        console.log(`[Worker] Processing request for chat ${chatId}`);

        // Get or create sandbox for this chat
        // Same chatId = same container (persistent between messages)
        const sandbox = getSandbox(env.Sandbox, `chat-${chatId}`, {
          sleepAfter: "1h",  // Sleep after 1 hour inactivity
        });

        // Write agent script to container
        await sandbox.writeFile("/workspace/agent.mjs", AGENT_SCRIPT);

        // Write input
        const input = { message, claudeSessionId };
        await sandbox.writeFile("/workspace/input.json", JSON.stringify(input));

        // Set API key and run agent (container runs as non-root user 'claude')
        const result = await sandbox.exec(
          `ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY} HOME=/home/claude node /workspace/agent.mjs`,
          { timeout: 180000 }  // 3 minute timeout
        );

        console.log(`[Worker] Exec completed. Exit code: ${result.exitCode}`);
        if (result.stderr) {
          console.log(`[Worker] Stderr: ${result.stderr}`);
        }

        // Check if agent failed before trying to read output
        if (result.exitCode !== 0) {
          console.error(`[Worker] Agent failed with exit code ${result.exitCode}`);
          return Response.json(
            {
              success: false,
              response: `Agent error (exit ${result.exitCode}): ${result.stderr || result.stdout || "Unknown error"}`,
              claudeSessionId: null
            },
            { status: 500, headers: corsHeaders }
          );
        }

        // Read output
        const outputFile = await sandbox.readFile("/workspace/output.json");
        const output: AgentOutput = JSON.parse(outputFile.content);

        console.log(`[Worker] Response ready for chat ${chatId}`);

        return Response.json(output, { headers: corsHeaders });

      } catch (error) {
        console.error("[Worker] Error:", error);
        return Response.json(
          {
            success: false,
            response: `Sandbox error: ${error instanceof Error ? error.message : "Unknown error"}`,
            claudeSessionId: null
          },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Streaming endpoint: /ask-stream - Start a streaming query (file-based)
    if (url.pathname === "/ask-stream" && request.method === "POST") {
      try {
        const body = await request.json() as AskRequest;
        const { chatId, message, claudeSessionId } = body;

        if (!chatId || !message) {
          return Response.json(
            { error: "Missing chatId or message" },
            { status: 400, headers: corsHeaders }
          );
        }

        console.log(`[Worker] Starting streaming request for chat ${chatId}`);

        // Get or create sandbox for this chat
        const sandbox = getSandbox(env.Sandbox, `chat-${chatId}`, {
          sleepAfter: "1h",
        });

        // Write the streaming agent script
        await sandbox.writeFile("/workspace/stream_agent.mjs", AGENT_STREAM_SCRIPT);

        // Write input
        const input = { message, claudeSessionId };
        await sandbox.writeFile("/workspace/input.json", JSON.stringify(input));

        // Initialize progress file
        await sandbox.writeFile("/workspace/progress.json", JSON.stringify({
          text: "",
          done: false,
          sessionId: null,
          error: null
        }));

        // Start agent in background (returns immediately)
        const startResult = await sandbox.exec(
          `ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY} HOME=/home/claude nohup node /workspace/stream_agent.mjs > /workspace/agent.log 2>&1 &`,
          { timeout: 5000 }
        );
        console.log(`[Worker] Agent started: exit=${startResult.exitCode}`);

        // Return immediately - client will poll for progress
        return Response.json({ started: true, chatId }, { headers: corsHeaders });

      } catch (error) {
        console.error("[Worker] Streaming error:", error);
        return Response.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Streaming endpoint: /poll - Poll for query status (file-based)
    if (url.pathname === "/poll" && request.method === "GET") {
      try {
        const chatId = url.searchParams.get("chatId");

        if (!chatId) {
          return Response.json(
            { error: "Missing chatId" },
            { status: 400, headers: corsHeaders }
          );
        }

        const sandbox = getSandbox(env.Sandbox, `chat-${chatId}`, {
          sleepAfter: "1h",
        });

        // Read progress file
        try {
          const progressFile = await sandbox.readFile("/workspace/progress.json");
          const progress = JSON.parse(progressFile.content);
          return Response.json(progress, { headers: corsHeaders });
        } catch (e) {
          // File doesn't exist yet or is invalid
          return Response.json({
            text: "",
            done: false,
            sessionId: null,
            error: null
          }, { headers: corsHeaders });
        }

      } catch (error) {
        console.error("[Worker] Poll error:", error);
        return Response.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Fire-and-forget Telegram endpoint: /ask-telegram
    // Uses persistent server if available, falls back to spawning agent process
    if (url.pathname === "/ask-telegram" && request.method === "POST") {
      try {
        const body = await request.json() as AskTelegramRequest;
        const { chatId, message, claudeSessionId, botToken, userMessageId } = body;

        if (!chatId || !message || !botToken) {
          return Response.json(
            { error: "Missing required fields" },
            { status: 400, headers: corsHeaders }
          );
        }

        console.log(`[Worker] Processing message for chat ${chatId}`);

        // Get sandbox with 1 hour sleep timeout
        const sandbox = getSandbox(env.Sandbox, `chat-${chatId}`, {
          sleepAfter: "1h",
        });

        // Send typing indicator
        await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, action: "typing" })
        }).catch(() => {});

        const workerUrl = "https://claude-sandbox-worker.samuel-hagman.workers.dev";

        // Check if persistent server is running
        const processes = await sandbox.listProcesses();
        const serverProcess = processes.find(p => p.command?.includes("persistent_server.mjs"));

        if (!serverProcess) {
          console.log(`[Worker] Starting persistent server for chat ${chatId}`);

          // Write the persistent server script
          await sandbox.writeFile("/workspace/persistent_server.mjs", PERSISTENT_SERVER_SCRIPT);

          // Ensure workspace/files directory exists
          await sandbox.exec("mkdir -p /workspace/files", { timeout: 5000 });

          // Start the persistent server with proper environment variables
          const server = await sandbox.startProcess(
            "node /workspace/persistent_server.mjs",
            {
              env: {
                ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
                HOME: "/home/claude"
              }
            }
          );

          // Wait for server to be ready on port 8080 (3000 is used by Sandbox infrastructure)
          console.log(`[Worker] Waiting for server to be ready...`);
          await server.waitForPort(8080, {
            path: "/health",
            timeout: 60000,
            status: { min: 200, max: 299 }
          });

          console.log(`[Worker] Persistent server ready for chat ${chatId}`);
        } else {
          console.log(`[Worker] Persistent server already running for chat ${chatId}`);
        }

        // POST message to the internal server using exec + curl
        // This is the reliable way to communicate with the internal server
        const messagePayload = JSON.stringify({
          text: message,
          botToken,
          chatId,
          userMessageId,
          workerUrl,
          claudeSessionId
        });

        // Escape the payload for shell
        const escapedPayload = messagePayload.replace(/'/g, "'\\''");

        const curlResult = await sandbox.exec(
          `curl -s -X POST http://localhost:8080/message -H 'Content-Type: application/json' -d '${escapedPayload}'`,
          { timeout: 10000 }
        );

        if (curlResult.exitCode !== 0) {
          console.error(`[Worker] Failed to post message: ${curlResult.stderr}`);
          // Fall back to legacy agent approach
          console.log(`[Worker] Falling back to legacy agent for chat ${chatId}`);

          await sandbox.writeFile("/workspace/telegram_agent.mjs", AGENT_TELEGRAM_SCRIPT);
          await sandbox.writeFile("/workspace/input.json", JSON.stringify({
            message,
            claudeSessionId,
            botToken,
            chatId,
            userMessageId,
            workerUrl
          }));

          await sandbox.exec(
            `ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY} HOME=/home/claude nohup node /workspace/telegram_agent.mjs > /workspace/telegram_agent.log 2>&1 &`,
            { timeout: 5000 }
          );
        } else {
          console.log(`[Worker] Message queued: ${curlResult.stdout}`);
        }

        return Response.json({ started: true, chatId }, { headers: corsHeaders });

      } catch (error) {
        console.error("[Worker] Telegram endpoint error:", error);
        return Response.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Session update endpoint - called by agent to persist session to R2
    if (url.pathname === "/session-update" && request.method === "POST") {
      try {
        const body = await request.json() as { chatId: string; claudeSessionId: string };
        const { chatId, claudeSessionId } = body;

        if (!chatId || !claudeSessionId || !env.SESSIONS) {
          return Response.json({ error: "Missing required fields" }, { status: 400, headers: corsHeaders });
        }

        const sessionKey = `sessions/${chatId}.json`;
        let session: SessionData;
        try {
          const existing = await env.SESSIONS.get(sessionKey);
          if (existing) {
            session = await existing.json() as SessionData;
          } else {
            session = {
              claudeSessionId: null,
              messageCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
          }
        } catch {
          session = {
            claudeSessionId: null,
            messageCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
        }
        session.claudeSessionId = claudeSessionId;
        session.messageCount++;
        session.updatedAt = new Date().toISOString();
        await env.SESSIONS.put(sessionKey, JSON.stringify(session));

        console.log(`[Worker] Session updated for chat ${chatId}: ${claudeSessionId}`);
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (error) {
        console.error("[Worker] Session update error:", error);
        return Response.json({ error: String(error) }, { status: 500, headers: corsHeaders });
      }
    }

    // Logs endpoint - read agent log from a chat's sandbox
    if (url.pathname === "/logs" && request.method === "GET") {
      try {
        const chatId = url.searchParams.get("chatId");
        if (!chatId) {
          return Response.json({ error: "Missing chatId" }, { status: 400, headers: corsHeaders });
        }

        const sandbox = getSandbox(env.Sandbox, `chat-${chatId}`, {});

        // Read the agent log file
        const logFile = await sandbox.readFile("/workspace/telegram_agent.log").catch(() => null);
        const log = logFile?.content || "No log file found";

        return Response.json({ chatId, log }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500, headers: corsHeaders });
      }
    }

    // Reset endpoint: /reset (destroy sandbox for chat AND delete R2 session)
    if (url.pathname === "/reset" && request.method === "POST") {
      try {
        const body = await request.json() as ResetRequest;
        const { chatId } = body;

        if (!chatId) {
          return Response.json(
            { error: "Missing chatId" },
            { status: 400, headers: corsHeaders }
          );
        }

        console.log(`[Worker] Resetting sandbox for chat ${chatId}`);

        // Destroy the sandbox container
        const sandbox = getSandbox(env.Sandbox, `chat-${chatId}`);
        await sandbox.destroy();

        // Also delete the R2 session to prevent orphaned session IDs
        if (env.SESSIONS) {
          const sessionKey = `sessions/${chatId}.json`;
          await env.SESSIONS.delete(sessionKey);
          console.log(`[Worker] Deleted R2 session for chat ${chatId}`);
        }

        console.log(`[Worker] Sandbox destroyed for chat ${chatId}`);

        return Response.json({ success: true, message: "Sandbox and session reset" }, { headers: corsHeaders });

      } catch (error) {
        console.error("[Worker] Reset error:", error);
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
};
