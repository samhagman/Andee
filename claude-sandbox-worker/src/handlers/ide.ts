/**
 * IDE endpoint handlers for the Sandbox IDE web interface.
 *
 * Provides:
 * - GET /sandboxes - List all available sandboxes from R2
 * - GET /files - List directory contents
 * - GET /file - Read file content
 * - PUT /file - Write file content
 * - WS /terminal - WebSocket terminal via ttyd
 */

import { getSandbox } from "@cloudflare/sandbox";
import { CORS_HEADERS, HandlerContext } from "../types";

// Known user ID → friendly name mappings
// TODO: Move to environment variable or separate config
const USER_NAMES: Record<string, string> = {
  // Real users - add your Telegram user IDs here
  // "123456789": "Sam (Personal)",
  // Test users
  "999999999": "TEST_USER_1",
  "888888888": "TEST_USER_2",
  "-100999999999": "TEST_GROUP",
  groups: "Group Chat",
};

/**
 * GET /sandboxes - List all available sandboxes from R2 sessions bucket.
 */
export async function handleSandboxes(ctx: HandlerContext): Promise<Response> {
  try {
    const listResult = await ctx.env.SESSIONS.list({ prefix: "sessions/" });

    const sandboxes = listResult.objects.map((obj) => {
      // Parse key: sessions/{senderId}/{chatId}.json or sessions/groups/{chatId}.json
      const keyWithoutPrefix = obj.key
        .replace("sessions/", "")
        .replace(".json", "");
      const parts = keyWithoutPrefix.split("/");

      const isGroup = parts[0] === "groups";
      const senderId = isGroup ? "groups" : parts[0];
      const chatId = isGroup ? parts[1] : parts[1] || parts[0];

      // Generate sandbox ID (must match ask.ts which uses `chat-${chatId}`)
      const id = `chat-${chatId}`;

      // Generate display name
      let displayName: string;
      if (isGroup) {
        displayName = USER_NAMES[chatId] || `Group ${chatId}`;
      } else {
        displayName = USER_NAMES[senderId] || `User ${senderId}`;
      }

      return {
        id,
        senderId,
        chatId,
        isGroup,
        displayName,
        lastUpdated: obj.uploaded.toISOString(),
      };
    });

    // Sort: test users last, then by last updated
    sandboxes.sort((a, b) => {
      const aIsTest = a.senderId.startsWith("999") || a.senderId.startsWith("888");
      const bIsTest = b.senderId.startsWith("999") || b.senderId.startsWith("888");
      if (aIsTest !== bIsTest) return aIsTest ? 1 : -1;
      return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
    });

    return Response.json({ sandboxes }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[IDE] Failed to list sandboxes:", error);
    return Response.json(
      { error: "Failed to list sandboxes", detail: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /files?sandbox=X&path=/workspace - List directory contents.
 */
export async function handleFiles(ctx: HandlerContext): Promise<Response> {
  const sandboxId = ctx.url.searchParams.get("sandbox");
  const path = ctx.url.searchParams.get("path") || "/workspace";

  if (!sandboxId) {
    return Response.json(
      { error: "Missing sandbox parameter" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const sandbox = getSandbox(ctx.env.Sandbox, sandboxId, { sleepAfter: "1h" });

    // Use ls with specific format for parsing
    const result = await sandbox.exec(
      `ls -la --time-style=+%Y-%m-%dT%H:%M:%S ${path} 2>/dev/null || echo "ERROR: Directory not found"`
    );

    if (result.stdout.includes("ERROR:")) {
      return Response.json(
        { error: "Directory not found", path },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const entries = parseLsOutput(result.stdout);

    return Response.json({ path, entries }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[IDE] Failed to list files:", error);
    return Response.json(
      { error: "Failed to list files", detail: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /file?sandbox=X&path=/workspace/foo.txt - Read file content.
 */
export async function handleFileRead(ctx: HandlerContext): Promise<Response> {
  const sandboxId = ctx.url.searchParams.get("sandbox");
  const path = ctx.url.searchParams.get("path");

  if (!sandboxId || !path) {
    return Response.json(
      { error: "Missing sandbox or path parameter" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const sandbox = getSandbox(ctx.env.Sandbox, sandboxId, { sleepAfter: "1h" });

    // Check if file exists and get size
    const statResult = await sandbox.exec(`stat -c '%s' ${path} 2>/dev/null || echo "NOT_FOUND"`);
    if (statResult.stdout.trim() === "NOT_FOUND") {
      return Response.json(
        { error: "File not found", path },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const size = parseInt(statResult.stdout.trim(), 10);

    // Read file - use base64 for binary files
    const isBinary = isBinaryFile(path);
    let content: string;
    let encoding: "utf-8" | "base64";

    if (isBinary) {
      const result = await sandbox.exec(`base64 ${path}`);
      content = result.stdout;
      encoding = "base64";
    } else {
      const result = await sandbox.readFile(path);
      content = result.content || "";
      encoding = "utf-8";
    }

    return Response.json(
      { path, content, encoding, size },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[IDE] Failed to read file:", error);
    return Response.json(
      { error: "Failed to read file", detail: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * PUT /file - Write file content.
 */
export async function handleFileWrite(ctx: HandlerContext): Promise<Response> {
  try {
    const body = await ctx.request.json() as {
      sandbox: string;
      path: string;
      content: string;
      encoding?: "utf-8" | "base64";
    };

    if (!body.sandbox || !body.path || body.content === undefined) {
      return Response.json(
        { error: "Missing sandbox, path, or content" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const sandbox = getSandbox(ctx.env.Sandbox, body.sandbox, { sleepAfter: "1h" });

    // Decode base64 if needed
    const content = body.encoding === "base64"
      ? atob(body.content)
      : body.content;

    await sandbox.writeFile(body.path, content);

    return Response.json({ success: true }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[IDE] Failed to write file:", error);
    return Response.json(
      { error: "Failed to write file", detail: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * WS /terminal?sandbox=X&apiKey=Y - WebSocket terminal proxy to ws-terminal.js in container.
 *
 * Architecture:
 *   Browser (xterm.js) → WebSocket → Worker → sandbox.wsConnect() → ws-terminal.js:8081 → PTY → bash
 *
 * Process Management:
 *   This handler is intentionally simple - it just checks if port 8081 is listening
 *   and starts ws-terminal.js if not. The ws-terminal.js script handles its own:
 *     - PID file management (/tmp/ws-terminal.pid)
 *     - Health checking (requires BOTH process alive AND port accepting connections)
 *     - Stale state cleanup (kills hung processes, removes orphan PID files)
 *     - EADDRINUSE retry logic (up to 5 attempts with 1s delay)
 *
 * This separation of concerns means the Worker doesn't need complex process management -
 * ws-terminal.js is self-healing and handles reconnection scenarios robustly.
 *
 * Note: WebSocket connections can't use headers, so API key is passed as query param.
 */
export async function handleTerminal(ctx: HandlerContext): Promise<Response> {
  const sandboxId = ctx.url.searchParams.get("sandbox");
  const apiKey = ctx.url.searchParams.get("apiKey");

  if (!sandboxId) {
    return Response.json(
      { error: "Missing sandbox parameter" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Validate API key from query param (WebSockets can't send headers)
  const expectedKey = ctx.env.ANDEE_API_KEY;
  if (expectedKey && apiKey !== expectedKey) {
    return Response.json(
      {
        error: "Unauthorized",
        debug: {
          providedPrefix: apiKey?.slice(0, 15),
          expectedPrefix: expectedKey?.slice(0, 15),
          providedLen: apiKey?.length,
          expectedLen: expectedKey?.length,
          match: apiKey === expectedKey
        }
      },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  // Check for WebSocket upgrade header
  const upgradeHeader = ctx.request.headers.get("Upgrade");
  const isWebSocketRequest = upgradeHeader?.toLowerCase() === "websocket";
  console.log(`[IDE] Terminal request - WebSocket upgrade: ${isWebSocketRequest}, Upgrade header: ${upgradeHeader}`);

  try {
    const sandbox = getSandbox(ctx.env.Sandbox, sandboxId, { sleepAfter: "1h" });

    // Check if port 8081 is already listening (ws-terminal already running)
    const portCheck = await sandbox.exec(
      "nc -z localhost 8081 && echo 'LISTENING' || echo 'NOT_LISTENING'",
      { timeout: 5000 }
    );
    const isListening = portCheck.stdout.includes("LISTENING") && !portCheck.stdout.includes("NOT_LISTENING");
    console.log(`[IDE] Port 8081 status: ${isListening ? 'listening' : 'not listening'}`);

    if (!isListening) {
      console.log(`[IDE] Starting ws-terminal server for sandbox ${sandboxId}`);

      // Start our custom WebSocket terminal server with PTY support
      // ws-terminal.js handles its own process management (checks for existing instances, retries on EADDRINUSE)
      // NOTE: NODE_PATH is required so Node.js can find globally installed packages (ws, node-pty)
      // NOTE: ANTHROPIC_API_KEY is required so `claude` command works in the terminal
      const wsTerminal = await sandbox.startProcess(
        "node /home/claude/.claude/scripts/ws-terminal.js",
        {
          env: {
            HOME: "/home/claude",
            TERM: "xterm-256color",
            PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            NODE_PATH: "/usr/local/lib/node_modules",
            ANTHROPIC_API_KEY: ctx.env.ANTHROPIC_API_KEY || "",
          },
        }
      );

      // Wait for server to be ready (with longer timeout to allow retries)
      await wsTerminal.waitForPort(8081, { mode: "tcp", timeout: 15000 });
      console.log(`[IDE] ws-terminal started for sandbox ${sandboxId}`);
    }

    // Proxy WebSocket to our terminal server
    if (!isWebSocketRequest) {
      console.log(`[IDE] Not a WebSocket request - returning error`);
      return Response.json(
        { error: "Expected WebSocket upgrade request" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log(`[IDE] Proxying WebSocket to ws-terminal on port 8081`);
    const wsResponse = await sandbox.wsConnect(ctx.request, 8081);
    console.log(`[IDE] wsConnect response status: ${wsResponse.status}`);
    return wsResponse;
  } catch (error) {
    console.error("[IDE] Terminal connection failed:", error);
    return Response.json(
      { error: "Terminal connection failed", detail: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /terminal-url?sandbox=X - Get the exposed URL for terminal access via ttyd.
 * Uses exposePort to get a preview URL that the frontend can connect to directly.
 * This bypasses wsConnect which has issues in local dev mode.
 */
export async function handleTerminalUrl(ctx: HandlerContext): Promise<Response> {
  const sandboxId = ctx.url.searchParams.get("sandbox");

  if (!sandboxId) {
    return Response.json(
      { error: "Missing sandbox parameter" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const sandbox = getSandbox(ctx.env.Sandbox, sandboxId, { sleepAfter: "1h" });

    // Ensure ttyd is running
    const processes = await sandbox.listProcesses();
    console.log(`[IDE] Terminal URL: processes:`, processes.map(p => ({ pid: p.pid, cmd: p.command?.slice(0, 60) })));

    const ttydProcess = processes.find(
      (p) => p.command?.includes("ttyd") && p.command?.includes("--base-path")
    );

    // Kill any old ttyd without --base-path
    const badTtyds = processes.filter(
      (p) => p.command?.includes("ttyd") && !p.command?.includes("--base-path")
    );
    for (const bad of badTtyds) {
      console.log(`[IDE] Killing old ttyd (pid ${bad.pid})`);
      await sandbox.exec(`kill -9 ${bad.pid}`);
    }

    if (!ttydProcess) {
      console.log(`[IDE] Starting ttyd for terminal URL`);
      const ttyd = await sandbox.startProcess(
        "ttyd --base-path / -p 8081 /bin/bash",
        {
          env: {
            HOME: "/home/claude",
            TERM: "xterm-256color",
            PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          },
        }
      );
      await ttyd.waitForPort(8081, { mode: "tcp", timeout: 10000 });
      console.log(`[IDE] ttyd started`);
    }

    // Expose port 8081 to get a preview URL
    const { hostname } = new URL(ctx.request.url);
    let exposedAt: string;

    try {
      console.log(`[IDE] Exposing port 8081 with hostname: ${hostname}`);
      const exposed = await sandbox.exposePort(8081, { hostname });
      console.log(`[IDE] exposePort result:`, JSON.stringify(exposed));
      // The result has 'url' property in local dev, 'exposedAt' in production
      exposedAt = (exposed as { url?: string; exposedAt?: string }).url ||
                  (exposed as { url?: string; exposedAt?: string }).exposedAt ||
                  `http://localhost:8787/_sandbox/8081-${sandboxId}/`;
    } catch (exposeError: unknown) {
      // If port is already exposed, try to get the URL
      // Note: getExposedPorts has bugs in local dev mode, so we construct the URL manually
      const errorMsg = exposeError instanceof Error ? exposeError.message : String(exposeError);
      if (errorMsg.includes("already exposed")) {
        // In local dev, the exposed URL follows a pattern
        // For now, return a direct wsConnect URL as fallback
        console.log(`[IDE] Port 8081 already exposed, using fallback`);
        // Try constructing the local dev URL pattern
        exposedAt = `http://localhost:8787/_sandbox/${sandboxId}/8081`;
      } else {
        throw exposeError;
      }
    }

    return Response.json(
      {
        terminalUrl: exposedAt,
        sandboxId,
        wsUrl: exposedAt.replace(/^http/, "ws") + "/ws",
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[IDE] Failed to get terminal URL:", error);
    return Response.json(
      { error: "Failed to get terminal URL", detail: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * WS /ws-container-test?sandbox=X&apiKey=Y - Test wsConnect directly to ttyd (same as /terminal but with more logging).
 * Used to debug whether wsConnect works at all.
 */
export async function handleWsContainerTest(ctx: HandlerContext): Promise<Response> {
  const sandboxId = ctx.url.searchParams.get("sandbox");
  const apiKey = ctx.url.searchParams.get("apiKey");

  if (!sandboxId) {
    return Response.json(
      { error: "Missing sandbox parameter" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const expectedKey = ctx.env.ANDEE_API_KEY;
  if (expectedKey && apiKey !== expectedKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  try {
    const sandbox = getSandbox(ctx.env.Sandbox, sandboxId, { sleepAfter: "1h" });

    // Ensure ttyd is running
    const processes = await sandbox.listProcesses();
    console.log(`[WS-TEST] Container processes:`, processes.map(p => ({ pid: p.pid, cmd: p.command?.slice(0, 60) })));

    const ttydProcess = processes.find(p => p.command?.includes("ttyd") && p.command?.includes("--base-path"));

    if (!ttydProcess) {
      console.log(`[WS-TEST] Starting ttyd`);
      const ttyd = await sandbox.startProcess("ttyd --base-path / -p 8081 /bin/bash", {
        env: {
          HOME: "/home/claude",
          TERM: "xterm-256color",
          PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        },
      });
      await ttyd.waitForPort(8081, { mode: "tcp", timeout: 10000 });
      console.log(`[WS-TEST] ttyd started`);
    }

    // Test HTTP to ttyd first
    console.log(`[WS-TEST] Testing HTTP to ttyd on port 8081...`);
    const httpTest = await sandbox.exec("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/");
    console.log(`[WS-TEST] HTTP test result:`, httpTest.stdout);

    // Proxy WebSocket to ttyd
    console.log(`[WS-TEST] Proxying WebSocket to ttyd on port 8081`);
    console.log(`[WS-TEST] Original request URL:`, ctx.request.url);
    console.log(`[WS-TEST] Request headers:`, Object.fromEntries(ctx.request.headers.entries()));

    const response = await sandbox.wsConnect(ctx.request, 8081);
    console.log(`[WS-TEST] wsConnect returned status:`, response.status);
    console.log(`[WS-TEST] wsConnect headers:`, Object.fromEntries(response.headers.entries()));

    return response;
  } catch (error) {
    console.error("[WS-TEST] Test failed:", error);
    return Response.json(
      { error: "Test failed", detail: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// Helper: Parse ls -la output into structured entries
function parseLsOutput(output: string): Array<{
  name: string;
  type: "file" | "directory";
  size: number;
  modified: string;
  permissions: string;
}> {
  const lines = output.trim().split("\n");
  const entries: Array<{
    name: string;
    type: "file" | "directory";
    size: number;
    modified: string;
    permissions: string;
  }> = [];

  for (const line of lines) {
    // Skip total line and empty lines
    if (line.startsWith("total") || !line.trim()) continue;

    // Parse ls -la output:
    // drwxr-xr-x 2 claude claude 4096 2025-01-07T12:00:00 dirname
    // -rw-r--r-- 1 claude claude 1234 2025-01-07T12:00:00 filename
    const match = line.match(
      /^([drwx-]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\S+)\s+(.+)$/
    );

    if (match) {
      const [, permissions, sizeStr, modified, name] = match;

      // Skip . and ..
      if (name === "." || name === "..") continue;

      entries.push({
        name,
        type: permissions.startsWith("d") ? "directory" : "file",
        size: parseInt(sizeStr, 10),
        modified,
        permissions,
      });
    }
  }

  return entries;
}

// Helper: Check if file is likely binary based on extension
function isBinaryFile(path: string): boolean {
  const binaryExtensions = [
    ".tar",
    ".gz",
    ".zip",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".pdf",
    ".exe",
    ".bin",
    ".so",
    ".dylib",
    ".mv2",
  ];
  return binaryExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}
