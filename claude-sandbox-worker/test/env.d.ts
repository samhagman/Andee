import type { Env } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    ANDEE_API_KEY: string;
    ANTHROPIC_API_KEY: string;
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    workerPort: number;
    workerUrl: string;
  }
}
