import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

/**
 * Vitest configuration for claude-telegram-bot tests.
 *
 * Uses @cloudflare/vitest-pool-workers to run tests in actual workerd runtime.
 * This matches the pattern used in claude-sandbox-worker for consistency.
 *
 * Key features:
 * - isolatedStorage: true = fresh DO/R2 storage per test
 * - R2 auto-mocked by miniflare
 * - Service bindings mocked via fetchMock in tests
 * - Test secrets provided via miniflare.bindings
 */
export default defineWorkersConfig({
  test: {
    globals: true,

    // Test organization
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**", "node_modules/**"],

    // Workers pool configuration
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.test.toml" },
        miniflare: {
          bindings: {
            BOT_TOKEN: "test-bot-token-12345",
            ALLOWED_USER_IDS: "", // Empty = allow all users in tests
            ANDEE_API_KEY: "test-api-key",
          },
          // Mock the SANDBOX_WORKER service binding
          serviceBindings: {
            SANDBOX_WORKER: async (request: Request) => {
              // Return mock response for all sandbox worker calls
              const url = new URL(request.url);
              if (url.pathname === "/factory-reset") {
                return new Response(JSON.stringify({ success: true, sessionPreserved: false }));
              }
              if (url.pathname === "/restart") {
                return new Response(JSON.stringify({ success: true, sessionPreserved: true }));
              }
              if (url.pathname === "/ask") {
                return new Response(JSON.stringify({ ok: true }));
              }
              if (url.pathname === "/snapshot") {
                return new Response(JSON.stringify({ success: true, key: "test" }));
              }
              if (url.pathname === "/snapshots") {
                return new Response(JSON.stringify({ count: 0, snapshots: [] }));
              }
              if (url.pathname === "/restore") {
                return new Response(JSON.stringify({ success: true, restoredFrom: "test-snapshot" }));
              }
              return new Response(JSON.stringify({ ok: true }));
            },
          },
        },
        // Fresh storage per test for isolation
        isolatedStorage: true,
      },
    },

    // Coverage
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
