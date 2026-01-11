import type { GlobalSetupContext } from "vitest/node";

export default async function setup({ provide }: GlobalSetupContext) {
  // For pool-workers, tests run inside workerd so we don't need external ports
  // This setup is primarily for E2E tests that use actual wrangler dev

  // Provide default ports (E2E tests will use get-port to find available ones)
  provide("workerPort", 8787);
  provide("workerUrl", "http://localhost:8787");

  console.log("[TEST SETUP] Initialized");

  // Return teardown function
  return async () => {
    console.log("[TEST TEARDOWN] Complete");
  };
}

// Type augmentation for provide/inject
declare module "vitest" {
  export interface ProvidedContext {
    workerPort: number;
    workerUrl: string;
  }
}
