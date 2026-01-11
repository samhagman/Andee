/**
 * E2E test helpers for making requests to the worker.
 *
 * These helpers make real HTTP requests to a running worker instance.
 */

/**
 * Get the worker URL from environment or use default.
 */
export function getWorkerUrl(): string {
  return process.env.WORKER_URL || "http://localhost:8787";
}

/**
 * Get the API key from environment.
 */
export function getApiKey(): string {
  const key = process.env.ANDEE_API_KEY;
  if (!key) {
    throw new Error(
      "ANDEE_API_KEY environment variable must be set for E2E tests"
    );
  }
  return key;
}

/**
 * Make an authenticated request to the worker.
 */
export async function workerFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${getWorkerUrl()}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": getApiKey(),
    ...options.headers,
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Make an unauthenticated request to the worker.
 */
export async function workerFetchNoAuth(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${getWorkerUrl()}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Wait for worker to be ready (health check passes).
 */
export async function waitForWorker(
  maxWaitMs: number = 30000
): Promise<boolean> {
  const startTime = Date.now();
  const interval = 500;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await workerFetchNoAuth("/");
      if (response.ok) {
        const data = await response.json();
        if (data.status === "ok") {
          return true;
        }
      }
    } catch {
      // Worker not ready yet, continue waiting
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}

/**
 * Generate a unique test ID to avoid collisions.
 */
export function uniqueTestId(): string {
  return `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * E2E test user ID (recognizable pattern for cleanup).
 */
export const E2E_TEST_USER = "777777777";
