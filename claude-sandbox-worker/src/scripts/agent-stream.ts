/**
 * Streaming agent script - writes progress to file instead of HTTP.
 * Used for polling-based streaming queries.
 */
export const AGENT_STREAM_SCRIPT = `#!/usr/bin/env node

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
