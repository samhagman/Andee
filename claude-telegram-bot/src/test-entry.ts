/**
 * Test entry point for vitest-pool-workers.
 *
 * Re-exports the main worker. The SANDBOX_WORKER service binding
 * is not available in miniflare tests, so tests must use fetchMock
 * to intercept calls to the sandbox worker.
 *
 * Usage in tests:
 * - fetchMock intercepts "https://fake-internal" for sandbox worker calls
 * - R2 (SESSIONS) is auto-mocked by miniflare
 * - Telegram API calls are mocked via fetchMock on "https://api.telegram.org"
 */
export { default } from "./index";
