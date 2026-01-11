/**
 * Request types for sandbox-worker API endpoints.
 */

export interface AskRequest {
  chatId: string;
  message: string;
  claudeSessionId: string | null;
}

/**
 * Image data for photo messages.
 */
export interface ImageData {
  base64: string; // Base64-encoded image data
  mediaType: string; // MIME type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
  fileId: string; // Telegram file_id for reference
  width?: number; // Original image width in pixels
  height?: number; // Original image height in pixels
}

export interface AskTelegramRequest {
  chatId: string;
  message?: string; // Text message or caption (optional if audio/images provided)
  claudeSessionId: string | null;
  botToken: string;
  userMessageId: number;
  senderId: string;
  isGroup: boolean;
  // Voice message support
  audioBase64?: string; // Base64-encoded OGG/OPUS audio
  audioDurationSeconds?: number; // Duration for logging/metrics
  // Image message support
  images?: ImageData[]; // Array of images (single photo or album)
  mediaGroupId?: string; // Telegram media group ID for albums
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
