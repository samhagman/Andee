// API client for Sandbox Worker

import type {
  SandboxListResponse,
  FileListResponse,
  FileReadResponse,
  FileWriteRequest,
  FileWriteResponse,
  Sandbox,
  SnapshotListResponse,
  SnapshotFilesResponse,
  SnapshotFileResponse,
  RestoreRequest,
  RestoreResponse,
} from "./types";

const DEV_WORKER_URL = "http://localhost:8787";
const PROD_WORKER_URL = "https://claude-sandbox-worker.samuel-hagman.workers.dev";
const API_KEY_STORAGE_KEY = "andee-ide-api-key";

function getWorkerUrl(): string {
  return import.meta.env.DEV ? DEV_WORKER_URL : PROD_WORKER_URL;
}

function getWebSocketUrl(): string {
  const base = getWorkerUrl();
  return base.replace(/^http/, "ws");
}

// Get API key - hardcoded for local dev, localStorage for production
export function getApiKey(): string {
  // Local development: use hardcoded key (matches claude-sandbox-worker/.dev.vars)
  if (import.meta.env.DEV) {
    return "adk_8dfeed669475a5661b976ff13249c20c";
  }

  // Production: prompt user and store in localStorage
  let apiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (!apiKey) {
    apiKey = prompt("Enter your Andee API key (adk_...):");
    if (apiKey) {
      localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    }
  }
  return apiKey || "";
}

// Clear stored API key (call on 401 errors)
export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${getWorkerUrl()}${path}`;
  const apiKey = getApiKey();

  const response = await fetch(url, {
    ...options,
    // Note: credentials: "include" removed because it conflicts with Access-Control-Allow-Origin: *
    // For production with Cloudflare Access, the server will need to return the specific origin
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      ...options?.headers,
    },
  });

  if (response.status === 401) {
    clearApiKey();
    throw new Error("Unauthorized - invalid API key");
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} ${error}`);
  }

  return response.json();
}

// List all available sandboxes
export async function listSandboxes(): Promise<SandboxListResponse> {
  return fetchApi<SandboxListResponse>("/sandboxes");
}

// List files in a directory
export async function listFiles(
  sandbox: string,
  path: string
): Promise<FileListResponse> {
  const params = new URLSearchParams({ sandbox, path });
  return fetchApi<FileListResponse>(`/files?${params}`);
}

// Read a file
export async function readFile(
  sandbox: string,
  path: string
): Promise<FileReadResponse> {
  const params = new URLSearchParams({ sandbox, path });
  return fetchApi<FileReadResponse>(`/file?${params}`);
}

// Write a file
export async function writeFile(
  request: FileWriteRequest
): Promise<FileWriteResponse> {
  return fetchApi<FileWriteResponse>("/file", {
    method: "PUT",
    body: JSON.stringify(request),
  });
}

// Get the WebSocket URL for the terminal
// The server exposes ttyd and returns the direct URL
export async function getTerminalUrl(sandbox: string): Promise<string> {
  const apiKey = getApiKey();
  const params = new URLSearchParams({ sandbox, apiKey });
  const response = await fetch(`${getWorkerUrl()}/terminal?${params}`, {
    headers: { "X-API-Key": apiKey },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get terminal URL: ${error}`);
  }

  const data = await response.json() as { type: string; wsUrl: string };
  if (data.type === "redirect" && data.wsUrl) {
    return data.wsUrl;
  }
  throw new Error("Invalid terminal response");
}

// Export URLs for debugging
export const workerUrl = getWorkerUrl;
export const wsUrl = getWebSocketUrl;

// List snapshots for a sandbox
export async function listSnapshots(
  sandbox: Sandbox
): Promise<SnapshotListResponse> {
  const params = new URLSearchParams({
    chatId: sandbox.chatId,
    senderId: sandbox.senderId,
    isGroup: String(sandbox.isGroup),
  });
  return fetchApi<SnapshotListResponse>(`/snapshots?${params}`);
}

// List files in a snapshot (for preview mode)
export async function listSnapshotFiles(
  sandbox: Sandbox,
  snapshotKey: string,
  path: string
): Promise<SnapshotFilesResponse> {
  const params = new URLSearchParams({
    sandbox: sandbox.id,
    snapshotKey,
    path,
    chatId: sandbox.chatId,
    senderId: sandbox.senderId,
    isGroup: String(sandbox.isGroup),
  });
  return fetchApi<SnapshotFilesResponse>(`/snapshot-files?${params}`);
}

// Read a single file from a snapshot (for preview mode)
export async function readSnapshotFile(
  sandbox: Sandbox,
  snapshotKey: string,
  path: string
): Promise<SnapshotFileResponse> {
  const params = new URLSearchParams({
    sandbox: sandbox.id,
    snapshotKey,
    path,
    chatId: sandbox.chatId,
    senderId: sandbox.senderId,
    isGroup: String(sandbox.isGroup),
  });
  return fetchApi<SnapshotFileResponse>(`/snapshot-file?${params}`);
}

// Restore a snapshot
export async function restoreSnapshot(
  request: RestoreRequest
): Promise<RestoreResponse> {
  return fetchApi<RestoreResponse>("/restore", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
