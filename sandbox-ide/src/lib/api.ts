// API client for Sandbox Worker

import type {
  SandboxListResponse,
  FileListResponse,
  FileReadResponse,
  FileWriteRequest,
  FileWriteResponse,
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

// Get API key from localStorage or prompt user
function getApiKey(): string {
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
