# Sandbox SDK Concepts

Understanding the architecture, lifecycle, and security model of the Sandbox SDK.

---

## Architecture

Sandbox SDK combines three Cloudflare technologies for secure, stateful, isolated execution:

- **Workers** - Your application logic that calls the Sandbox SDK
- **Durable Objects** - Persistent sandbox instances with unique identities
- **Containers** - Isolated Linux environments where code actually runs

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Your Worker                                                    │
│  (Application code using Sandbox SDK methods)                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                │ RPC call via Durable Object stub
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Sandbox Durable Object                                         │
│  (Routes requests & maintains state)                            │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                │ HTTP API
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Isolated Ubuntu Container                                      │
│  (Executes untrusted code safely)                               │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 1: Client SDK

The developer-facing API:

```typescript
import { getSandbox } from "@cloudflare/sandbox";

const sandbox = getSandbox(env.Sandbox, "my-sandbox");
const result = await sandbox.exec("python script.py");
```

### Layer 2: Durable Object

Manages sandbox lifecycle and routing. Provides:
- **Persistent identity** - Same sandbox ID always routes to same instance
- **Container management** - Durable Object owns the container lifecycle
- **Geographic distribution** - Sandboxes run close to users

### Layer 3: Container Runtime

Executes code in isolation with full Linux capabilities. Provides:
- **VM-based isolation** - Each sandbox runs in its own VM
- **Full environment** - Ubuntu Linux with Python, Node.js, Git, etc.

### Request Flow

```typescript
await sandbox.exec("python script.py");
```

1. **Client SDK** validates parameters, sends HTTP request to Durable Object
2. **Durable Object** authenticates and routes to container runtime
3. **Container Runtime** validates inputs, executes command, captures output
4. **Response flows back** through all layers

---

## Container Runtime

Each sandbox runs in an isolated Linux container with Python, Node.js, and common development tools pre-installed.

### Runtime Software Installation

```bash
# Python packages
pip install scikit-learn tensorflow

# Node.js packages
npm install express

# System packages
apt-get update && apt-get install -y redis-server
```

### Filesystem

Standard Linux filesystem with these key directories:

| Path | Purpose |
|------|---------|
| `/workspace` | Default working directory for user code |
| `/tmp` | Temporary files |
| `/home` | User home directory |
| `/usr/bin`, `/usr/local/bin` | Executable binaries |

```typescript
await sandbox.writeFile('/workspace/app.py', 'print("Hello")');
await sandbox.writeFile('/tmp/cache.json', '{}');
await sandbox.exec('ls -la /workspace');
```

### Process Management

**Foreground processes** (`exec()`):
```typescript
const result = await sandbox.exec('npm test');
// Waits for completion, returns output
```

**Background processes** (`startProcess()`):
```typescript
const process = await sandbox.startProcess('node server.js');
// Returns immediately, process runs in background
```

### Network Capabilities

**Outbound connections** work:
```bash
curl https://api.example.com/data
pip install requests
npm install express
```

**Inbound connections** require port exposure:
```typescript
const { hostname } = new URL(request.url);
await sandbox.startProcess('python -m http.server 8000');
const exposed = await sandbox.exposePort(8000, { hostname });
console.log(exposed.exposedAt); // Public URL
```

> **Local development:** Add `EXPOSE` directives to Dockerfile for each port.

**Localhost** works within sandbox:
```bash
redis-server &      # Start server
redis-cli ping      # Connect locally
```

### Limitations

- Cannot load kernel modules or access host hardware
- Cannot run nested containers (no Docker-in-Docker)

---

## Sandbox Lifecycle

A sandbox is an isolated execution environment with:
- A unique identifier (sandbox ID)
- An isolated filesystem
- A dedicated Linux container
- State maintained while the container is active
- Existence as a Cloudflare Durable Object

### Lifecycle States

#### Creation
```typescript
const sandbox = getSandbox(env.Sandbox, "user-123");
await sandbox.exec('echo "Hello"'); // First request creates sandbox
```

#### Active
Container is running and processing requests. All state remains available: files, running processes, shell sessions, environment variables.

#### Idle
After 10 minutes of inactivity (configurable via `sleepAfter`), the container stops. When the next request arrives, a fresh container starts. **All previous state is lost.**

#### Destruction
```typescript
await sandbox.destroy();
// All files, processes, and state deleted permanently
```

### Naming Strategies

**Per-user sandboxes:**
```typescript
const sandbox = getSandbox(env.Sandbox, `user-${userId}`);
```
Good for interactive environments, playgrounds, notebooks.

**Per-session sandboxes:**
```typescript
const sessionId = `session-${Date.now()}-${Math.random()}`;
const sandbox = getSandbox(env.Sandbox, sessionId);
// Later:
await sandbox.destroy();
```
Good for one-time execution, CI/CD, isolated tests.

**Per-task sandboxes:**
```typescript
const sandbox = getSandbox(env.Sandbox, `build-${repoName}-${commit}`);
```
Good for builds, pipelines, background jobs.

### Handling Container Restarts

Design for ephemeral state:

```typescript
const files = await sandbox.listFiles("/workspace");
if (!files.includes("data.json")) {
  // Reinitialize: container restarted
  await sandbox.writeFile("/workspace/data.json", initialData);
}
await sandbox.exec("python process.py");
```

### Version Compatibility

The SDK checks that npm package version matches Docker image version. Mismatches can cause features to break. Update your Dockerfile when updating the npm package:

```dockerfile
FROM docker.io/cloudflare/sandbox:0.3.3  # Match your npm version
```

---

## Preview URLs

Preview URLs provide public HTTPS access to services running inside sandboxes.

```typescript
const { hostname } = new URL(request.url);
await sandbox.startProcess("python -m http.server 8000");
const exposed = await sandbox.exposePort(8000, { hostname });

console.log(exposed.exposedAt);
// Production: https://8000-abc123.yourdomain.com
// Local dev: http://localhost:8787/...
```

### URL Format

- **Production**: `https://{port}-{sandbox-id}.yourdomain.com`
- **Local development**: `http://localhost:8787/...`

URLs remain stable while a port is exposed. Re-exposing generates a new token.

### ID Case Sensitivity

Hostnames are lowercased (per RFC 3986). If sandbox ID has uppercase letters, use `normalizeId: true`:

```typescript
const sandbox = getSandbox(env.Sandbox, 'MyProject-123', {
  normalizeId: true
});
// Durable Object ID: "myproject-123" (lowercased)
// Preview URL routes correctly
```

### Request Routing

Call `proxyToSandbox()` first in your Worker's fetch handler:

```typescript
import { proxyToSandbox, getSandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

export default {
  async fetch(request, env) {
    // Handle preview URL routing first
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    // Your application routes
    // ...
  },
};
```

### What Works

- HTTP/HTTPS requests
- WebSocket connections
- Server-Sent Events
- All HTTP methods

### What Does Not Work

- Raw TCP/UDP connections
- Custom protocols (must wrap in HTTP)
- Ports outside range 1024-65535
- Port 3000 (used internally by SDK)

---

## Security Model

The Sandbox SDK is built on Containers, which run each sandbox in its own VM.

### Container Isolation

Each sandbox runs in a separate VM:
- **Filesystem isolation** - Cannot access other sandboxes' files
- **Process isolation** - Cannot see or affect other sandboxes' processes
- **Network isolation** - Separate network stacks
- **Resource limits** - CPU, memory, disk quotas enforced

### Within a Sandbox

All code within a single sandbox shares resources:
- **Filesystem** - All processes see the same files
- **Processes** - All sessions can see all processes
- **Network** - Processes can communicate via localhost

For complete isolation, use separate sandboxes per user:
```typescript
// Good - Each user in separate sandbox
const userSandbox = getSandbox(env.Sandbox, `user-${userId}`);

// Bad - Users sharing one sandbox
const shared = getSandbox(env.Sandbox, 'shared');
// Users can read each other's files!
```

### Command Injection Prevention

Always validate user input:
```typescript
// Dangerous
const filename = userInput;
await sandbox.exec(`cat ${filename}`);
// User could input: "file.txt; rm -rf /"

// Safe - validate input
const filename = userInput.replace(/[^a-zA-Z0-9._-]/g, '');
await sandbox.exec(`cat ${filename}`);

// Better - use file API
await sandbox.writeFile('/tmp/input', userInput);
await sandbox.exec('cat /tmp/input');
```

### Secrets Management

Use environment variables, not hardcoded secrets:
```typescript
// Bad - hardcoded
await sandbox.writeFile('/workspace/config.js', `
  const API_KEY = 'sk_live_abc123';
`);

// Good - environment variables
await sandbox.startProcess('node app.js', {
  env: { API_KEY: env.API_KEY }
});
```

Clean up temporary sensitive data:
```typescript
try {
  await sandbox.writeFile('/tmp/sensitive.txt', secretData);
  await sandbox.exec('python process.py /tmp/sensitive.txt');
} finally {
  await sandbox.deleteFile('/tmp/sensitive.txt');
}
```

### What SDK Protects Against

- Sandbox-to-sandbox access (VM isolation)
- Resource exhaustion (enforced quotas)
- Container escapes (VM-based isolation)

### What You Must Implement

- Authentication and authorization
- Input validation and sanitization
- Rate limiting
- Application-level security (SQL injection, XSS, etc.)

---

## Session Management

Sessions are bash shell execution contexts within a sandbox. Think of them like terminal tabs in the same container.

- **Sandbox** = A computer (container)
- **Session** = A terminal shell session in that computer

### Default Session

Every sandbox has a default session that maintains shell state:

```typescript
const sandbox = getSandbox(env.Sandbox, 'my-sandbox');

await sandbox.exec("cd /app");
await sandbox.exec("pwd");  // Output: /app

await sandbox.exec("export MY_VAR=hello");
await sandbox.exec("echo $MY_VAR");  // Output: hello
```

### Creating Sessions

Create additional sessions for isolated shell contexts:

```typescript
const buildSession = await sandbox.createSession({
  id: "build",
  env: { NODE_ENV: "production" },
  cwd: "/build"
});

const testSession = await sandbox.createSession({
  id: "test",
  env: { NODE_ENV: "test" },
  cwd: "/test"
});

// Different shell contexts
await buildSession.exec("npm run build");
await testSession.exec("npm test");
```

### What's Isolated Per Session

Each session has its own:
- **Shell environment** (exported variables)
- **Working directory**
- **Environment variables** (set via createSession options)

### What's Shared

All sessions in a sandbox share:
- **Filesystem** - File operations affect all sessions
- **Processes** - All sessions can see all processes

### When to Use Sessions

**Use sessions when:**
- You need isolated shell state for different tasks
- Running parallel operations with different environments
- Keeping AI agent credentials separate from app runtime

**Use separate sandboxes when:**
- You need complete isolation (untrusted code)
- Different users require fully separated environments

### Session Cleanup

```typescript
try {
  const session = await sandbox.createSession({ id: 'temp' });
  await session.exec('command');
} finally {
  await sandbox.deleteSession('temp');
}
```

> **Note:** The default session cannot be deleted. Use `sandbox.destroy()` instead.
