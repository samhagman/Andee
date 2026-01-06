/**
 * Diagnostic endpoint: GET /diag
 * Tests Claude CLI and SDK inside the container.
 */

import { getSandbox } from "@cloudflare/sandbox";
import { CORS_HEADERS, HandlerContext } from "../types";

export async function handleDiag(ctx: HandlerContext): Promise<Response> {
  try {
    const sandbox = getSandbox(ctx.env.Sandbox, "diagnostic-test2", {});

    // Test 1: Check environment
    const envResult = await sandbox.exec(
      "echo HOME=$HOME && echo USER=$USER && whoami && pwd",
      { timeout: 10000 }
    );

    // Test 2: Check .claude directory
    const claudeDirResult = await sandbox.exec(
      "ls -la ~/.claude 2>&1 || echo 'No .claude dir'",
      { timeout: 10000 }
    );

    // Test 3: Check claude version
    const versionResult = await sandbox.exec("claude --version", {
      timeout: 30000,
    });

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
      `HOME=/root ANTHROPIC_API_KEY=${ctx.env.ANTHROPIC_API_KEY} claude --version 2>&1`,
      { timeout: 30000 }
    );

    // Check what's in .claude now
    const claudeDirAfter = await sandbox.exec("ls -la /root/.claude 2>&1", {
      timeout: 5000,
    });

    // Try running claude without --print (like SDK does) with echo input
    const claudeRawResult = await sandbox.exec(
      `echo "say hi" | HOME=/root ANTHROPIC_API_KEY=${ctx.env.ANTHROPIC_API_KEY} timeout 30 claude --dangerously-skip-permissions 2>&1 || echo "Exit code: $?"`,
      { timeout: 60000 }
    );

    // Now try the SDK
    const sdkResult = await sandbox.exec(
      `HOME=/root ANTHROPIC_API_KEY=${ctx.env.ANTHROPIC_API_KEY} node /workspace/sdk_test.mjs 2>&1`,
      { timeout: 120000 }
    );

    return Response.json(
      {
        env: {
          exitCode: envResult.exitCode,
          stdout: envResult.stdout,
          stderr: envResult.stderr,
        },
        claudeDir: {
          exitCode: claudeDirResult.exitCode,
          stdout: claudeDirResult.stdout,
          stderr: claudeDirResult.stderr,
        },
        version: {
          exitCode: versionResult.exitCode,
          stdout: versionResult.stdout,
          stderr: versionResult.stderr,
        },
        init: {
          exitCode: initResult.exitCode,
          stdout: initResult.stdout,
          stderr: initResult.stderr,
        },
        claudeDirAfter: {
          exitCode: claudeDirAfter.exitCode,
          stdout: claudeDirAfter.stdout,
          stderr: claudeDirAfter.stderr,
        },
        claudeRaw: {
          exitCode: claudeRawResult.exitCode,
          stdout: claudeRawResult.stdout,
          stderr: claudeRawResult.stderr,
        },
        sdkTest: {
          exitCode: sdkResult.exitCode,
          stdout: sdkResult.stdout,
          stderr: sdkResult.stderr,
        },
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    return Response.json(
      { error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
