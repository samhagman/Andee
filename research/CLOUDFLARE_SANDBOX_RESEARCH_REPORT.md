# Cloudflare Sandbox SDK Research Report

> **Purpose**: Condensed reference for running Claude Code in isolated containers
> **Package**: `@cloudflare/sandbox`
> **Docs**: https://developers.cloudflare.com/sandbox/
> **GitHub**: https://github.com/cloudflare/sandbox-sdk

---

## Quick Start

```bash
# Create new project from Claude Code template
npm create cloudflare@latest -- my-sandbox \
  --template=cloudflare/sandbox-sdk/examples/claude-code

cd my-sandbox
npm run dev  # First run builds Docker container (2-3 min)
```

---

## Prerequisites

- Node.js 16.17.0+
- Docker running locally (for development)
- Cloudflare account (paid plan for production)
- Anthropic API key

---

## Core Concepts

### Sandbox = Isolated Container
- Full Linux environment
- Isolated filesystem, network, processes
- Edge-deployed globally
- Lazy initialization (starts on first operation)

### Lifecycle
```
getSandbox() → First operation triggers start →
Operations run → Sleep after inactivity →
Wakes on next operation → destroy() cleans up
```

---

## Project Structure

```
my-sandbox/
├── src/
│   └── index.ts        # Worker code
├── Dockerfile          # Container definition
├── wrangler.toml       # Cloudflare config
├── .dev.vars           # Local secrets (gitignored)
└── package.json
```

### Dockerfile
```dockerfile
FROM docker.io/cloudflare/sandbox:0.6.7

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install any additional tools
RUN apt-get update && apt-get install -y git python3
```

### wrangler.toml
```toml
name = "claude-sandbox"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# Enable containers
[containers]
dockerfile = "Dockerfile"

# R2 for persistence
[[r2_buckets]]
binding = "DATA_BUCKET"
bucket_name = "sandbox-data"
```

### .dev.vars
```
ANTHROPIC_API_KEY=sk-ant-...
AWS_ACCESS_KEY_ID=...      # For R2 mounting
AWS_SECRET_ACCESS_KEY=...
```

---

## Core API

### getSandbox()

```typescript
import { getSandbox, Sandbox } from "@cloudflare/sandbox";

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
}

export { Sandbox } from "@cloudflare/sandbox";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Get or create sandbox by ID
    const sandbox = getSandbox(
      env.Sandbox,
      "user-123",  // Same ID = same sandbox instance
      {
        sleepAfter: 10 * 60 * 1000,  // 10 min inactivity sleep
        keepAlive: false,             // Auto-sleep enabled
      }
    );

    // Sandbox starts LAZILY on first operation
    return new Response("Ready");
  }
};
```

### exec() - Command Execution

```typescript
// Simple execution
const result = await sandbox.exec("python3 -c 'print(2+2)'");
console.log(result.stdout);  // "4\n"
console.log(result.exitCode); // 0
console.log(result.success);  // true

// With timeout
const result = await sandbox.exec("long-running-task", {
  timeout: 30000  // 30 seconds
});

// Streaming output
const result = await sandbox.exec("npm install", {
  stream: true,
  onOutput: (data) => console.log(data)
});
```

### File Operations

```typescript
// Write file
await sandbox.writeFile("/workspace/script.py", "print('hello')");

// Read file
const file = await sandbox.readFile("/workspace/script.py");
console.log(file.content);

// File exists check (via exec)
const result = await sandbox.exec("test -f /workspace/file.txt && echo yes");
```

### destroy() - Cleanup

```typescript
// Always cleanup when done!
try {
  await sandbox.writeFile("/tmp/code.py", code);
  const result = await sandbox.exec("python /tmp/code.py");
  return result.stdout;
} finally {
  await sandbox.destroy();  // Removes files, kills processes
}
```

---

## R2 Bucket Mounting (CRITICAL FOR PERSISTENCE)

### Configuration
```typescript
// Mount R2 bucket to filesystem path
await sandbox.mountBucket("my-bucket", "/data", {
  endpoint: "https://ACCOUNT_ID.r2.cloudflarestorage.com"
  // Credentials auto-detected from AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY
});

// Now /data is backed by R2!
await sandbox.writeFile("/data/results.json", JSON.stringify(data));
// Data persists even after sandbox.destroy()!
```

### MountBucketOptions
```typescript
interface MountBucketOptions {
  endpoint: string;              // R2/S3/GCS endpoint URL
  provider?: 'r2' | 's3' | 'gcs';
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  readOnly?: boolean;
}
```

### R2 Endpoint Format
```
https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
```

### CRITICAL LIMITATION
> **R2 mounting does NOT work with `wrangler dev`!**
>
> This is due to FUSE support constraints. You must deploy to production
> to test R2 mounting. For local development, use local filesystem.

---

## Running Claude Code in Sandbox

### Basic Pattern
```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { task, sessionId } = await request.json();

    const sandbox = getSandbox(env.Sandbox, `claude-${sessionId}`);

    try {
      // Mount R2 for session persistence
      await sandbox.mountBucket("sessions", "/data", {
        endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`
      });

      // Set up environment
      await sandbox.exec(`export ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY}`);

      // Run Claude Code CLI
      const result = await sandbox.exec(
        `claude --print "${task}"`,
        { timeout: 120000 }  // 2 minute timeout
      );

      return Response.json({
        success: result.success,
        output: result.stdout,
        error: result.stderr
      });
    } finally {
      await sandbox.destroy();
    }
  }
};
```

### With Agent SDK (Inside Container)
```typescript
// First, ensure Agent SDK is in Dockerfile:
// RUN npm install @anthropic-ai/claude-agent-sdk

// Then run Node.js script in sandbox
await sandbox.writeFile("/workspace/agent.js", `
  import { query } from "@anthropic-ai/claude-agent-sdk";

  const response = [];
  for await (const msg of query({
    prompt: process.argv[2],
    options: {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      allowedTools: ["Read", "Bash", "WebSearch"]
    }
  })) {
    if (msg.type === 'result') response.push(msg.result);
  }
  console.log(JSON.stringify(response));
`);

const result = await sandbox.exec(`node /workspace/agent.js "${userMessage}"`);
```

---

## Sessions (Isolated Execution Contexts)

```typescript
// Create isolated session within sandbox
const session = await sandbox.createSession("session-1");

// Session has its own shell state, env vars, working directory
await session.exec("cd /workspace && export FOO=bar");
await session.exec("echo $FOO");  // "bar"

// Another session is isolated
const session2 = await sandbox.createSession("session-2");
await session2.exec("echo $FOO");  // "" (not set in this session)
```

---

## Background Processes

```typescript
// Start long-running process
const process = await sandbox.startProcess("python server.py", {
  cwd: "/workspace",
  env: { PORT: "8080" }
});

// Wait for it to be ready
await process.waitForPort(8080, {
  timeout: 30000,
  httpPath: "/health"
});

// Get logs
const logs = await process.getLogs();

// Kill when done
await process.kill();
```

---

## Port Exposure (Preview URLs)

```typescript
import { proxyToSandbox } from "@cloudflare/sandbox";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Check if request is for sandbox service
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    // Otherwise handle normally...
  }
};
```

---

## Complete Worker Template

```typescript
import { getSandbox, proxyToSandbox, Sandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  DATA_BUCKET: R2Bucket;
  ANTHROPIC_API_KEY: string;
  CF_ACCOUNT_ID: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle preview URL proxying
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    const url = new URL(request.url);

    if (url.pathname === "/ask" && request.method === "POST") {
      const { message, chatId } = await request.json();

      const sandbox = getSandbox(env.Sandbox, `chat-${chatId}`, {
        sleepAfter: 5 * 60 * 1000
      });

      try {
        // Mount persistence
        await sandbox.mountBucket("data", "/data", {
          endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`
        });

        // Run Claude
        const result = await sandbox.exec(
          `ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY} claude --print "${message}"`,
          { timeout: 120000 }
        );

        return Response.json({
          response: result.stdout,
          success: result.success
        });
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  }
};
```

---

## Deployment

```bash
# Deploy worker and container
npx wrangler deploy

# Set secrets
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY

# Wait 2-3 minutes for container provisioning
npx wrangler containers list  # Check status
```

---

## Key Considerations

1. **Container build time**: First `npm run dev` takes 2-3 min
2. **R2 mounting production-only**: Use local files for development
3. **Lazy start**: Sandbox only starts on first operation
4. **Cleanup**: Always call `destroy()` in finally blocks
5. **Timeouts**: Set appropriate timeouts for Claude operations
6. **Secrets**: Never hardcode API keys, use Worker secrets

---

## Error Types

```typescript
// Mount errors
MissingCredentialsError  // No AWS credentials
InvalidMountConfigError  // Bad endpoint/path
S3FSMountError           // Mount operation failed

// Process errors
ProcessReadyTimeoutError      // waitForPort/waitForLog timeout
ProcessExitedBeforeReadyError // Process died before ready
```

---

## Quick Reference Links

- Docs: https://developers.cloudflare.com/sandbox/
- API Reference: https://developers.cloudflare.com/sandbox/api/
- Claude Code Tutorial: https://developers.cloudflare.com/sandbox/tutorials/claude-code/
- Persistent Storage: https://developers.cloudflare.com/sandbox/tutorials/persistent-storage/
- npm: https://www.npmjs.com/package/@cloudflare/sandbox
- GitHub: https://github.com/cloudflare/sandbox-sdk
