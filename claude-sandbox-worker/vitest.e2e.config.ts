import { defineConfig } from "vitest/config";

/**
 * E2E test configuration.
 *
 * Unlike integration tests which run in miniflare (workerd runtime),
 * E2E tests run in Node.js and make real HTTP requests to a running
 * worker instance. This allows testing the full stack including:
 * - Sandbox containers (when deployed)
 * - Real R2 storage
 * - Actual Cloudflare infrastructure
 *
 * Requirements:
 * - Worker must be running (locally or deployed)
 * - Set WORKER_URL environment variable (default: http://localhost:8787)
 * - Set ANDEE_API_KEY environment variable for authentication
 *
 * Run: npm run test:e2e
 */
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 30000, // E2E tests can be slow
    hookTimeout: 10000,
    globals: true,

    // E2E tests run in Node.js, not workerd
    environment: "node",

    // Run tests sequentially to avoid race conditions
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Retry flaky E2E tests
    retry: 1,
  },
});
