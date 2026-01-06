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
  senderId: string;
  isGroup: boolean;
}

export interface ResetRequest {
  chatId: string;
  senderId: string;
  isGroup: boolean;
}

export interface SessionUpdateRequest {
  chatId: string;
  claudeSessionId: string;
  senderId: string;
  isGroup: boolean;
}

export interface SnapshotRequest {
  chatId: string;
  senderId: string;
  isGroup: boolean;
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
