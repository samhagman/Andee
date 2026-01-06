/**
 * Agent script for synchronous queries (legacy mode).
 * Reads input from /workspace/input.json, writes output to /workspace/output.json.
 */
export const AGENT_SYNC_SCRIPT = `#!/usr/bin/env node

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
