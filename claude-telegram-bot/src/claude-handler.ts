// claude-telegram-bot/src/claude-handler.ts

const SANDBOX_WORKER_URL = process.env.SANDBOX_WORKER_URL || "http://localhost:8787";

export interface ClaudeResponse {
  response: string;
  sessionId: string;
}

export async function handleClaudeMessage(
  userMessage: string,
  existingSessionId: string | null,
  chatId: string  // Need chat ID for sandbox routing
): Promise<ClaudeResponse> {

  console.log(`Calling sandbox worker for chat ${chatId}...`);

  const response = await fetch(`${SANDBOX_WORKER_URL}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: chatId.toString(),
      message: userMessage,
      claudeSessionId: existingSessionId
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sandbox worker error: ${response.status} - ${error}`);
  }

  const result = await response.json() as {
    success: boolean;
    response: string;
    claudeSessionId: string | null;
  };

  if (!result.success) {
    throw new Error(result.response);
  }

  return {
    response: result.response,
    sessionId: result.claudeSessionId || existingSessionId || ""
  };
}

// Helper function to sleep
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Streaming version - polls for updates and calls onUpdate callback
export async function handleClaudeMessageStreaming(
  userMessage: string,
  existingSessionId: string | null,
  chatId: string,
  onUpdate: (text: string) => Promise<void>
): Promise<ClaudeResponse> {

  console.log(`Starting streaming request for chat ${chatId}...`);

  // 1. Start the query
  const startResponse = await fetch(`${SANDBOX_WORKER_URL}/ask-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: chatId.toString(),
      message: userMessage,
      claudeSessionId: existingSessionId
    })
  });

  if (!startResponse.ok) {
    const error = await startResponse.text();
    throw new Error(`Failed to start streaming: ${startResponse.status} - ${error}`);
  }

  const startResult = await startResponse.json() as { started?: boolean; error?: string };

  if (!startResult.started) {
    throw new Error(startResult.error || "Failed to start query");
  }

  console.log(`Query started for chat: ${chatId}`);

  // 2. Poll loop (file-based)
  let lastText = "";
  const maxPolls = 360; // 3 min max at 500ms intervals

  for (let i = 0; i < maxPolls; i++) {
    await sleep(500); // Poll every 500ms

    try {
      const pollResponse = await fetch(
        `${SANDBOX_WORKER_URL}/poll?chatId=${chatId}`,
        { method: "GET" }
      );

      if (!pollResponse.ok) {
        console.error(`Poll failed: ${pollResponse.status}`);
        continue; // Keep trying
      }

      const state = await pollResponse.json() as {
        text: string;
        done: boolean;
        sessionId: string | null;
        error: string | null;
      };

      // Update Telegram if text changed
      if (state.text && state.text !== lastText) {
        try {
          await onUpdate(state.text);
          lastText = state.text;
        } catch (e) {
          // Ignore update errors (rate limits, etc)
          console.error("Update callback error:", e);
        }
      }

      // Check if done
      if (state.done) {
        if (state.error) {
          throw new Error(state.error);
        }
        return {
          response: state.text || "No response",
          sessionId: state.sessionId || existingSessionId || ""
        };
      }
    } catch (e) {
      // Log but keep polling
      console.error("Poll error:", e);
    }
  }

  throw new Error("Query timed out after 3 minutes");
}

export async function resetSandbox(chatId: string): Promise<void> {
  console.log(`Resetting sandbox for chat ${chatId}...`);

  const response = await fetch(`${SANDBOX_WORKER_URL}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: chatId.toString() })
  });

  if (!response.ok) {
    console.error(`Failed to reset sandbox: ${response.status}`);
  }
}
