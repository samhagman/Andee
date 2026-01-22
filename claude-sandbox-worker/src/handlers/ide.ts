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

import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import { CORS_HEADERS, HandlerContext, Env } from "../types";
import { debug } from "../lib/debug";
import { restoreFromSnapshot } from "../lib/container-startup";

// Auto-restore configuration
const IDE_INIT_MARKER = "/tmp/.ide-initialized";

/**
 * Check if container needs initialization and restore from R2 if so.
 * Uses the shared restoreFromSnapshot() function which supports any snapshot size
 * via presigned URL downloads (no Worker memory/RPC limits).
 *
 * Returns true if restore happened, false otherwise.
 */
async function maybeAutoRestore(
  sandbox: Sandbox,
  sandboxId: string,
  env: Env
): Promise<boolean> {
  // Parse chatId and isGroup from sandboxId (format: chat-{chatId} or chat--{groupId})
  const chatId = sandboxId.replace(/^chat-/, "");
  const isGroup = chatId.startsWith("-");
  // For groups: use "groups" as senderId (shared storage)
  // For private chats: chatId == userId in Telegram, so use chatId as senderId
  const senderId = isGroup ? "groups" : chatId;

  // Check if already initialized (avoid re-restoring on every IDE request)
  const markerCheck = await sandbox.exec(`test -f ${IDE_INIT_MARKER} && echo "EXISTS"`, { timeout: 5000 });
  if (markerCheck.stdout.includes("EXISTS")) {
    debug.ide("auto-restore-skipped", sandboxId, { reason: "already initialized" });
    return false;
  }

  // Delegate to the shared restore function (supports any size via presigned URLs)
  debug.ide("auto-restore-start", sandboxId, { chatId, isGroup });
  const restored = await restoreFromSnapshot(sandbox, chatId, senderId, isGroup, env);

  // Mark as initialized regardless of outcome (avoid retry loops)
  await sandbox.exec(`touch ${IDE_INIT_MARKER}`, { timeout: 5000 }).catch(() => {});

  if (restored) {
    debug.ide("auto-restore-success", sandboxId, { chatId });
    console.log(`[IDE] Auto-restored ${sandboxId} from snapshot`);
  } else {
    debug.ide("auto-restore-skipped", sandboxId, { reason: "no snapshot or restore failed" });
  }

  return restored;
}

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

// Cache for exposed terminal URLs to avoid re-exposing (which invalidates existing connections)
// Key: sandboxId, Value: { url: string, expiredAt: number }
// URLs are cached for 55 minutes (sandbox sleeps after 1 hour of inactivity)
const terminalUrlCache: Map<string, { url: string; expiresAt: number }> = new Map();

/**
 * Clear the terminal URL cache for a specific sandbox.
 * Call this when a sandbox is restarted/destroyed to invalidate stale URLs.
 */
export function clearTerminalUrlCache(sandboxId: string): void {
  if (terminalUrlCache.has(sandboxId)) {
    console.log(`[IDE] Cleared terminal URL cache for ${sandboxId}`);
    terminalUrlCache.delete(sandboxId);
  }
}

/**
 * Clear all terminal URL caches.
 * Useful for debugging or when multiple sandboxes might be affected.
 */
export function clearAllTerminalUrlCaches(): void {
  const count = terminalUrlCache.size;
  terminalUrlCache.clear();
  console.log(`[IDE] Cleared all terminal URL caches (${count} entries)`);
}

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
  const timer = debug.timer('IDE', 'listFiles', { sandboxId, path });

  if (!sandboxId) {
    return Response.json(
      { error: "Missing sandbox parameter" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    debug.ide('getSandbox', sandboxId, { path });
    const sandbox = getSandbox(ctx.env.Sandbox, sandboxId, { sleepAfter: "1h" });

    // Step 1: Wake the sandbox with listProcesses()
    debug.ide('listProcesses-start', sandboxId, { reason: 'wake sandbox' });
    let processes;
    try {
      processes = await sandbox.listProcesses();
      debug.ide('listProcesses-success', sandboxId, {
        processCount: processes.length,
        processes: processes.map(p => ({ pid: p.pid, cmd: p.command?.slice(0, 50) })),
      });
    } catch (wakeError) {
      debug.error('listProcesses-failed', {
        component: 'IDE',
        sandboxId,
        error: String(wakeError),
        errorType: (wakeError as Error).constructor?.name,
      });
      // Try to continue anyway - sometimes exec() works even if listProcesses() fails
    }

    // Step 1.5: Auto-restore from R2 if container is fresh
    try {
      await maybeAutoRestore(sandbox, sandboxId, ctx.env);
    } catch (restoreError) {
      debug.warn('auto-restore-error', {
        component: 'IDE',
        sandboxId,
        error: String(restoreError),
      });
      // Continue even if restore fails
    }

    // Step 2: Execute ls command
    debug.ide('exec-start', sandboxId, { command: 'ls -la', path });
    const result = await sandbox.exec(
      `ls -la --time-style=+%Y-%m-%dT%H:%M:%S ${path} 2>/dev/null || echo "ERROR: Directory not found"`,
      { timeout: 15000 }
    );
    debug.ide('exec-complete', sandboxId, {
      exitCode: result.exitCode,
      stdoutLen: result.stdout?.length || 0,
      stderrLen: result.stderr?.length || 0,
      stdoutPreview: result.stdout?.slice(0, 200),
    });

    if (result.stdout.includes("ERROR:")) {
      debug.warn('directory-not-found', { component: 'IDE', sandboxId, path });
      return Response.json(
        { error: "Directory not found", path },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const entries = parseLsOutput(result.stdout);
    timer({ entryCount: entries.length });
    return Response.json({ path, entries }, { headers: CORS_HEADERS });
  } catch (error) {
    const errorDetails = {
      message: String(error),
      type: (error as Error).constructor?.name,
      stack: (error as Error).stack?.split('\n').slice(0, 3).join(' | '),
    };
    debug.error('handleFiles-error', {
      component: 'IDE',
      sandboxId,
      path,
      ...errorDetails,
    });
    console.error("[IDE] Failed to list files:", error);

    // Provide more detailed error response for debugging
    return Response.json(
      {
        error: "Failed to list files",
        detail: String(error),
        sandboxId,
        path,
        errorType: errorDetails.type,
        suggestion: errorDetails.message.includes('Unknown Error')
          ? 'The sandbox may be in a corrupted state. Try using /restart endpoint to reset it.'
          : undefined,
      },
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

    // CRITICAL: Use listProcesses() to wake the sandbox first
    console.log(`[IDE] Waking sandbox ${sandboxId} with listProcesses()`);
    await sandbox.listProcesses();
    console.log(`[IDE] Sandbox ${sandboxId} awake, reading file ${path}`);
    
    // Check if file exists
    const statResult = await sandbox.exec(`stat -c '%s' ${path} 2>/dev/null || echo "NOT_FOUND"`, {
      timeout: 10000
    });

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
      const result = await sandbox.exec(`base64 ${path}`, { timeout: 15000 });
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

  // This endpoint now returns the exposed terminal URL
  // The frontend connects directly to the exposed port via custom domain
  // This bypasses wsConnect which has issues
  
  try {
    const sandbox = getSandbox(ctx.env.Sandbox, sandboxId, { sleepAfter: "1h" });
    
    // Get the custom domain hostname for port exposure
    // Uses the custom domain andee.samhagman.com
    const hostname = "andee.samhagman.com";

    // Ensure ws-terminal is running before exposing
    const portCheck = await sandbox.exec(
      "nc -z localhost 8081 && echo 'OK' || echo 'NO'",
      { timeout: 5000 }
    );
    const isListening = portCheck.stdout.includes("OK");
    console.log(`[IDE] Port 8081 listening: ${isListening}`);
    
    if (!isListening) {
      console.log(`[IDE] Starting ws-terminal server for sandbox ${sandboxId}`);

      // Use ws-terminal.js which is compatible with our frontend's ttyd protocol
      const wsTerminal = await sandbox.startProcess(
        "node /home/claude/.claude/scripts/ws-terminal.js",
        {
          env: {
            HOME: "/home/claude",
            TERM: "xterm-256color",
            PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            NODE_PATH: "/usr/local/lib/node_modules",
            // API keys for Claude Agent SDK and MCP servers (Perplexity for web search)
            ANTHROPIC_API_KEY: ctx.env.ANTHROPIC_API_KEY || "",
            PERPLEXITY_API_KEY: ctx.env.PERPLEXITY_API_KEY || "",
          },
        }
      );

      await wsTerminal.waitForPort(8081, { mode: "tcp", timeout: 15000 });
      console.log(`[IDE] ws-terminal ready on port 8081`);
    }

    // Check if port is already exposed
    let exposedUrl: string | undefined;
    
    const { ports } = await sandbox.getExposedPorts();
    const existingPort = ports.find(p => p.port === 8081);
    
    if (existingPort) {
      console.log(`[IDE] Port 8081 already exposed at: ${existingPort.exposedAt}`);
      exposedUrl = existingPort.exposedAt;
    } else {
      // Expose the port via custom domain
      console.log(`[IDE] Exposing port 8081 for sandbox ${sandboxId} on ${hostname}`);
      const exposed = await sandbox.exposePort(8081, { hostname, name: "terminal" });
      console.log(`[IDE] exposePort result:`, JSON.stringify(exposed));
      
      // The SDK returns { exposedAt: string } but may vary in local dev
      // Handle both cases
      exposedUrl = exposed.exposedAt || (exposed as { url?: string }).url;
    }
    
    if (!exposedUrl) {
      console.error(`[IDE] No URL available for port 8081`);
      return Response.json({
        error: "Failed to get exposed URL",
        detail: "No URL available for port 8081",
      }, { status: 500, headers: CORS_HEADERS });
    }
    
    console.log(`[IDE] Terminal exposed at: ${exposedUrl}`);
    
    // Return the WebSocket URL for the frontend to connect directly
    // The URL format is: https://8081-{sandboxId}.{hostname}
    // Frontend should connect via wss:// to this URL
    const wsUrl = exposedUrl.replace(/^https?:\/\//, "wss://");
    
    return Response.json({
      success: true,
      terminalUrl: wsUrl,
      httpUrl: exposedUrl,
      sandboxId,
    }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[IDE] Terminal connection failed:", error);
    return Response.json(
      { error: "Terminal connection failed", detail: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /terminal-url?sandbox=X - Get the exposed URL for terminal access via ws-terminal.
 * Uses exposePort to get a preview URL that the frontend can connect to directly.
 * This bypasses wsConnect which has issues with WebSocket proxying.
 * 
 * REQUIRES: Custom domain with wildcard DNS (e.g., *.andee.samhagman.com)
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

    // CRITICAL: Use listProcesses() to wake the sandbox first
    console.log(`[IDE] Waking sandbox ${sandboxId} with listProcesses()`);
    const processes = await sandbox.listProcesses();
    console.log(`[IDE] Sandbox ${sandboxId} awake, ${processes.length} processes running`);

    // Check if ws-terminal is running
    const wsTerminalProcess = processes.find(p => 
      p.command?.includes("ws-terminal.js") || p.command?.includes("node /home/claude/.claude/scripts/ws-terminal")
    );

    if (!wsTerminalProcess) {
      console.log(`[IDE] Starting ws-terminal for terminal URL`);
      const wsTerminal = await sandbox.startProcess(
        "node /home/claude/.claude/scripts/ws-terminal.js",
        {
          env: {
            HOME: "/home/claude",
            TERM: "xterm-256color",
            PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            NODE_PATH: "/usr/local/lib/node_modules",
            // API keys for Claude Agent SDK and MCP servers (Perplexity for web search)
            ANTHROPIC_API_KEY: ctx.env.ANTHROPIC_API_KEY || "",
            PERPLEXITY_API_KEY: ctx.env.PERPLEXITY_API_KEY || "",
          },
        }
      );
      await wsTerminal.waitForPort(8081, { mode: "tcp", timeout: 10000 });
      console.log(`[IDE] ws-terminal started`);
    } else {
      console.log(`[IDE] ws-terminal already running (pid ${wsTerminalProcess.pid})`);
    }

    // Use the apex domain for port exposure (single-level subdomain for Universal SSL)
    // URLs will be: 8081-{sandboxId}-{token}.samhagman.com (covered by *.samhagman.com cert)
    const customHostname = "samhagman.com";
    let exposedAt: string;

    // Check server-side cache first to avoid re-exposing (which invalidates existing connections)
    const cached = terminalUrlCache.get(sandboxId);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[IDE] Using cached terminal URL for ${sandboxId}: ${cached.url}`);
      exposedAt = cached.url;
    } else {
      // Cache miss or expired - need to expose the port
      // NOTE: getExposedPorts() has a bug where it fails when ports are exposed.
      // Workaround: Just try to expose the port. If it fails with "already exposed",
      // unexpose and re-expose to get a fresh URL.
      try {
        console.log(`[IDE] Exposing port 8081 with hostname: ${customHostname}`);
        const exposed = await sandbox.exposePort(8081, { hostname: customHostname });
        console.log(`[IDE] exposePort result:`, JSON.stringify(exposed));
        
        // Handle different response formats from the SDK
        const exposeResult = exposed as { exposedAt?: string; url?: string };
        exposedAt = exposeResult.exposedAt || exposeResult.url || "";
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`[IDE] exposePort failed:`, errorMsg);
        
        // If port is already exposed, unexpose and re-expose to get fresh URL
        // This works around the getExposedPorts() bug
        if (errorMsg.includes("already exposed") || errorMsg.includes("PortAlreadyExposedError")) {
          console.log(`[IDE] Port already exposed, unexposing and re-exposing`);
          try {
            await sandbox.unexposePort(8081);
            console.log(`[IDE] Unexposed port 8081, now re-exposing`);
            const exposed = await sandbox.exposePort(8081, { hostname: customHostname });
            const exposeResult = exposed as { exposedAt?: string; url?: string };
            exposedAt = exposeResult.exposedAt || exposeResult.url || "";
            console.log(`[IDE] Re-exposed port 8081 at: ${exposedAt}`);
          } catch (reexposeError) {
            console.log(`[IDE] Failed to re-expose:`, reexposeError);
            throw reexposeError;
          }
        } else {
          throw error;
        }
      }
      
      // Cache the URL for 55 minutes (sandbox sleeps after 1 hour of inactivity)
      const CACHE_TTL_MS = 55 * 60 * 1000; // 55 minutes
      terminalUrlCache.set(sandboxId, {
        url: exposedAt,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      console.log(`[IDE] Cached terminal URL for ${sandboxId}`);
    }
    
    if (!exposedAt) {
      throw new Error("Could not get exposed URL for port 8081");
    }

    // Build the WebSocket URL for the frontend
    // ws-terminal.js listens on the root path, not /ws
    const wsUrl = exposedAt.replace(/^https?:\/\//, "wss://");

    console.log(`[IDE] Terminal exposed at: ${exposedAt}, wsUrl: ${wsUrl}`);

    return Response.json(
      {
        success: true,
        terminalUrl: exposedAt,
        wsUrl: wsUrl,
        sandboxId,
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
