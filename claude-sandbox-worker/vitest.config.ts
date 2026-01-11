import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  // Vite optimizeDeps to prebundle problematic modules
  optimizeDeps: {
    include: ["@cloudflare/sandbox", "@cloudflare/containers"],
  },
  // SSR config for module resolution
  ssr: {
    // Externalize these so they don't need to be resolved in workerd
    external: ["@cloudflare/sandbox", "@cloudflare/containers"],
  },
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
            ANDEE_API_KEY: "test-api-key",
            ANTHROPIC_API_KEY: "test-anthropic-key",
          },
        },
        // Isolated storage per test
        isolatedStorage: true,
      },
    },

    // Coverage
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/scripts/**", "src/**/*.d.ts"],
    },
  },
});
