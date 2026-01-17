/**
 * Agent scripts for execution inside sandboxed containers.
 *
 * These scripts are written to the container filesystem and executed via Node.js.
 * They are imported as raw text strings using Wrangler's [[rules]] type = "Text".
 *
 * Benefits of .script.js files over template literals:
 * - Full syntax highlighting in VS Code
 * - ESLint can lint the scripts
 * - JSDoc type hints work
 * - No template literal escape hell
 */

// Import scripts as raw text (Wrangler [[rules]] type = "Text" in wrangler.toml)
import PERSISTENT_SERVER_SCRIPT from "./persistent-server.script.js";
import AGENT_TELEGRAM_SCRIPT from "./agent-telegram.script.js";
import OPENCODE_PERSISTENT_SERVER_SCRIPT from "./opencode-persistent-server.script.js";

export { PERSISTENT_SERVER_SCRIPT, AGENT_TELEGRAM_SCRIPT, OPENCODE_PERSISTENT_SERVER_SCRIPT };
