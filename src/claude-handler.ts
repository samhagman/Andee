import { query } from "@anthropic-ai/claude-agent-sdk";

const WORKSPACE = process.env.CLAUDE_WORKSPACE || `${process.env.HOME}/claude-workspace`;

export interface ClaudeResponse {
  response: string;
  sessionId: string;
}

export async function handleClaudeMessage(
  userMessage: string,
  existingSessionId: string | null
): Promise<ClaudeResponse> {

  let sessionId = existingSessionId;
  let response = "";
  let errorMessage = "";

  console.log(`Claude query starting... (resume: ${existingSessionId ? "yes" : "no"})`);

  try {
    for await (const message of query({
      prompt: userMessage,
      options: {
        // Session management
        resume: existingSessionId || undefined,

        // Permissions - fully autonomous
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,

        // All tools available
        allowedTools: [
          "Read", "Write", "Edit",      // File operations
          "Bash",                         // Command execution
          "Glob", "Grep",                // Search
          "WebSearch", "WebFetch",       // Web access
          "Task"                          // Subagents
        ],

        // Working directory
        cwd: WORKSPACE,

        // Model
        model: "claude-sonnet-4-5",

        // No cost limit per user preference
        // maxBudgetUsd: undefined,

        // Reasonable turn limit
        maxTurns: 25
      }
    })) {
      // Capture session ID from init message
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        console.log(`Session initialized: ${sessionId}`);
      }

      // Capture result
      if (message.type === "result") {
        if (message.subtype === "success") {
          response = message.result;
          console.log(`Query completed. Cost: $${message.total_cost_usd?.toFixed(4)}`);
        } else {
          // Error cases
          errorMessage = `Query ended with: ${message.subtype}`;
          if ("errors" in message && message.errors) {
            errorMessage += `\n${message.errors.join("\n")}`;
          }
        }
      }
    }
  } catch (error) {
    console.error("Claude query error:", error);
    throw error;
  }

  if (!sessionId) {
    throw new Error("No session ID received from Claude");
  }

  if (errorMessage && !response) {
    response = `Error: ${errorMessage}`;
  }

  if (!response) {
    response = "Claude completed the task but didn't provide a text response.";
  }

  return { response, sessionId };
}
