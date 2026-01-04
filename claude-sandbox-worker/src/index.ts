import { getSandbox, Sandbox } from "@cloudflare/sandbox";

// Re-export Sandbox for Durable Object binding
export { Sandbox } from "@cloudflare/sandbox";

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ANTHROPIC_API_KEY: string;
}

interface AskRequest {
  chatId: string;
  message: string;
  claudeSessionId: string | null;
}

interface ResetRequest {
  chatId: string;
}

interface AgentOutput {
  success: boolean;
  response: string;
  claudeSessionId: string | null;
}

// Agent script content - embedded for simplicity
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
          "Task"
        ],
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
          sleepAfter: 10 * 60 * 1000,  // Sleep after 10 min inactivity
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

    // Reset endpoint: /reset (destroy sandbox for chat)
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

        const sandbox = getSandbox(env.Sandbox, `chat-${chatId}`);
        await sandbox.destroy();

        console.log(`[Worker] Sandbox destroyed for chat ${chatId}`);

        return Response.json({ success: true, message: "Sandbox reset" }, { headers: corsHeaders });

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
