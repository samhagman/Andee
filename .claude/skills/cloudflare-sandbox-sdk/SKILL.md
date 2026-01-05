---
name: cloudflare-sandbox-sdk
description: Reference documentation for Cloudflare Sandbox SDK. Use when working with sandbox containers, executing code in isolation, managing files/processes, exposing services, or configuring the worker deployment.
---

# Cloudflare Sandbox SDK Reference

The Sandbox SDK enables you to run untrusted code securely in isolated environments. Built on Cloudflare Containers, it provides a simple API for executing commands, managing files, running background processes, and exposing services from Workers applications.

## Quick Reference

| Operation | Method | Example |
|-----------|--------|---------|
| Get sandbox | `getSandbox()` | `const sandbox = getSandbox(env.Sandbox, 'user-123')` |
| Execute command | `exec()` | `await sandbox.exec('python script.py')` |
| Stream command | `execStream()` | `await sandbox.execStream('npm run build')` |
| Start background process | `startProcess()` | `await sandbox.startProcess('node server.js')` |
| Write file | `writeFile()` | `await sandbox.writeFile('/workspace/app.js', code)` |
| Read file | `readFile()` | `await sandbox.readFile('/workspace/data.json')` |
| Create directory | `mkdir()` | `await sandbox.mkdir('/workspace/src', { recursive: true })` |
| Expose port | `exposePort()` | `await sandbox.exposePort(8080, { hostname })` |
| Run Python/JS code | `runCode()` | `await sandbox.runCode('print(2+2)', { language: 'python' })` |
| Mount R2 bucket | `mountBucket()` | `await sandbox.mountBucket('my-bucket', '/data', opts)` |
| Create session | `createSession()` | `await sandbox.createSession({ env: { NODE_ENV: 'prod' } })` |
| Destroy sandbox | `destroy()` | `await sandbox.destroy()` |

## Basic Usage

```typescript
import { getSandbox } from '@cloudflare/sandbox';

export { Sandbox } from '@cloudflare/sandbox';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sandbox = getSandbox(env.Sandbox, 'user-123');

    // Execute command
    const result = await sandbox.exec('python3 -c "print(2 + 2)"');

    return Response.json({
      output: result.stdout,
      exitCode: result.exitCode,
      success: result.success
    });
  }
};
```

## Documentation Files

This skill contains detailed documentation split by topic:

| File | Description |
|------|-------------|
| [getting-started.md](getting-started.md) | Prerequisites, project setup, local dev, deployment |
| [concepts.md](concepts.md) | Architecture, lifecycle, security, sessions, preview URLs |
| [api.md](api.md) | Complete API reference for all methods |
| [guides.md](guides.md) | How-to guides for common tasks |
| [configuration.md](configuration.md) | Wrangler config, Dockerfile, environment variables |
| [tutorials.md](tutorials.md) | Full tutorials for building applications |
| [platform.md](platform.md) | Pricing, limits, beta information |

## Use Cases

- **AI Code Execution**: Execute LLM-generated code safely in sandboxes
- **Data Analysis**: Run pandas, NumPy, matplotlib with rich outputs
- **Interactive Development Environments**: Build cloud IDEs with preview URLs
- **CI/CD & Build Systems**: Run tests and builds in isolated containers

## Andee-Specific Patterns

Andee uses the Sandbox SDK with a **persistent server pattern** for optimal performance:

```typescript
// 1. Get sandbox with 1 hour sleep timeout
const sandbox = getSandbox(env.Sandbox, `chat-${chatId}`, {
  sleepAfter: "1h",  // Container stays alive between messages
});

// 2. Check if persistent server is running
const processes = await sandbox.listProcesses();
const serverProcess = processes.find(p => p.command?.includes("persistent_server.mjs"));

// 3. Start server if not running (uses startProcess, NOT exec)
if (!serverProcess) {
  await sandbox.writeFile("/workspace/persistent_server.mjs", SCRIPT);

  const server = await sandbox.startProcess("node /workspace/persistent_server.mjs", {
    env: {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      HOME: "/home/claude"  // Required for Claude CLI
    }
  });

  // Wait for server to be ready on port 8080 (NOT 3000!)
  await server.waitForPort(8080, {
    path: "/health",
    timeout: 60000,
    status: { min: 200, max: 299 }
  });
}

// 4. Send message via internal HTTP (using exec + curl)
const result = await sandbox.exec(
  `curl -s -X POST http://localhost:8080/message -H 'Content-Type: application/json' -d '${payload}'`,
  { timeout: 10000 }
);
```

**Key insights:**
- **Port 3000 is reserved** by Sandbox infrastructure - use 8080
- **Use `startProcess()`** for long-running servers, `exec()` for one-off commands
- **Pass env vars via `{ env: {...} }`** option, not inline in command
- **`sleepAfter: "1h"`** balances performance with resource usage

## Key Concepts

- **Sandbox**: Isolated execution environment backed by a container
- **Session**: Shell execution context within a sandbox (like terminal tabs)
- **Preview URL**: Public HTTPS URL to access services in sandbox
- **Code Context**: Persistent Python/JS interpreter state for runCode()

## Related Resources

- [GitHub Repository](https://github.com/cloudflare/sandbox-sdk)
- [Cloudflare Containers docs](https://developers.cloudflare.com/containers/)
- [Workers AI docs](https://developers.cloudflare.com/workers-ai/)
