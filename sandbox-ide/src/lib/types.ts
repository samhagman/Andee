// API types for Sandbox IDE

export interface Sandbox {
  id: string; // e.g., "chat-123456789"
  senderId: string;
  chatId: string;
  isGroup: boolean;
  displayName: string; // Friendly name or "User {id}"
  lastUpdated: string;
  hasSnapshot?: boolean;
}

export interface SandboxListResponse {
  sandboxes: Sandbox[];
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: string;
  permissions?: string;
}

export interface FileListResponse {
  path: string;
  entries: FileEntry[];
}

export interface FileReadResponse {
  path: string;
  content: string;
  encoding: "utf-8" | "base64";
  size: number;
}

export interface FileWriteRequest {
  sandbox: string;
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}

export interface FileWriteResponse {
  success: boolean;
  error?: string;
}

export interface ExecRequest {
  sandbox: string;
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface ExecResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Terminal message types for WebSocket
export type TerminalMessage =
  | { type: "input"; data: string }
  | { type: "output"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "error"; message: string }
  | { type: "status"; status: "connected" | "disconnected" };

// Connection status
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";
