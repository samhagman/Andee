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
