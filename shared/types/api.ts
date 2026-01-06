/**
 * Request types for sandbox-worker API endpoints.
 */

export interface AskRequest {
  chatId: string;
  message: string;
  claudeSessionId: string | null;
}

export interface AskTelegramRequest {
  chatId: string;
  message: string;
  claudeSessionId: string | null;
  botToken: string;
  userMessageId: number;
}

export interface ResetRequest {
  chatId: string;
}

export interface SessionUpdateRequest {
  chatId: string;
  claudeSessionId: string;
}

/**
 * Response types for sandbox-worker API endpoints.
 */

export interface AgentOutput {
  success: boolean;
  response: string;
  claudeSessionId: string | null;
}

export interface StreamingProgress {
  text: string;
  done: boolean;
  sessionId: string | null;
  error: string | null;
}

export interface HealthCheckResponse {
  status: "ok";
  service: string;
}

export interface PersistentServerStatus {
  status?: "ok";
  ready?: boolean;
  sessionId: string | null;
  isProcessing: boolean;
  queueLength: number;
}
