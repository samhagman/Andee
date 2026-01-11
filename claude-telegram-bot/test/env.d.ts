/**
 * Type declarations for vitest-pool-workers test environment.
 */

interface Env {
  BOT_TOKEN: string;
  SESSIONS: R2Bucket;
  SANDBOX_WORKER: Fetcher;
  ALLOWED_USER_IDS?: string;
  ANDEE_API_KEY?: string;
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    BOT_TOKEN: string;
    ALLOWED_USER_IDS: string;
    ANDEE_API_KEY: string;
  }
}
