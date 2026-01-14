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

// Snapshot types
export interface SnapshotInfo {
  key: string;
  size: number;
  uploaded: string; // ISO timestamp
}

export interface SnapshotListResponse {
  chatId: string;
  count: number;
  snapshots: SnapshotInfo[];
}

export interface SnapshotFilesResponse {
  path: string;
  entries: Array<{
    name: string;
    type: "file" | "directory";
    path: string;
  }>;
  snapshotKey: string;
}

export interface SnapshotFileResponse {
  path: string;
  content: string;
  encoding: "utf-8" | "base64";
  snapshotKey: string;
}

export interface RestoreRequest {
  chatId: string;
  senderId: string;
  isGroup: boolean;
  snapshotKey: string;
  markAsLatest?: boolean;
}

export interface RestoreResponse {
  success: boolean;
  restoredFrom: string;
  newSnapshotKey?: string;
  error?: string;
}

// Preview mode state
export interface PreviewState {
  active: boolean;
  snapshotKey: string | null;
  snapshotDate: string | null;
}

// Schedule types
export interface ScheduleConfig {
  version: string;
  timezone: string;
  schedules: Record<string, ScheduleEntry>;
}

export interface ScheduleEntry {
  description: string;
  cron: string;
  enabled: boolean;
  prompt: string;
}

export interface ScheduleWithNextRun {
  id: string;
  description: string;
  cron: string;
  timezone: string;
  prompt: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
}

export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  executedAt: number;
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
  durationMs?: number;
}

export interface GetScheduleConfigResponse {
  success: boolean;
  config?: ScheduleConfig;
  schedules?: ScheduleWithNextRun[];
  error?: string;
}

export interface SaveScheduleConfigResponse {
  success: boolean;
  message?: string;
  schedules?: ScheduleWithNextRun[];
  error?: string;
}

export interface ListScheduleRunsResponse {
  success: boolean;
  executions: ScheduleExecution[];
  error?: string;
}

export interface RunScheduleNowResponse {
  success: boolean;
  message?: string;
  error?: string;
}
