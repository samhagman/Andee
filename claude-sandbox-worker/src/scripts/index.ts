/**
 * Agent scripts for execution inside sandboxed containers.
 *
 * These scripts are written to the container filesystem and executed via Node.js.
 * They are exported as string constants because:
 * 1. They run inside Docker containers, not in the Worker runtime
 * 2. They need to be written to the filesystem before execution
 * 3. Keeping them as separate files allows syntax highlighting and linting
 */

export { AGENT_SYNC_SCRIPT } from "./agent-sync";
export { AGENT_STREAM_SCRIPT } from "./agent-stream";
export { AGENT_TELEGRAM_SCRIPT } from "./agent-telegram";
export { PERSISTENT_SERVER_SCRIPT } from "./persistent-server";
