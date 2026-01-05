# Sandbox SDK How-to Guides

Practical guides for common tasks with the Sandbox SDK.

---

## Execute Commands

Run commands with output handling, error management, and shell access.

### Choose the Right Method

| Method | Use For |
|--------|---------|
| `exec()` | One-time commands (builds, installs, scripts) |
| `execStream()` | Long-running commands needing real-time output |
| `startProcess()` | Background services (web servers, databases) |

### Basic Command Execution

```typescript
const result = await sandbox.exec('python --version');

console.log(result.stdout);   // "Python 3.11.0"
console.log(result.exitCode); // 0
console.log(result.success);  // true
```

### Handle Errors

```typescript
try {
  const result = await sandbox.exec('python analyze.py');

  if (!result.success) {
    console.error('Analysis failed:', result.stderr);
    console.log('Exit code:', result.exitCode);
  }

  return JSON.parse(result.stdout);
} catch (error) {
  console.error('Execution failed:', error.message);
  throw error;
}
```

### Pass Arguments Safely

```typescript
// Unsafe - vulnerable to injection
await sandbox.exec(`cat ${userInput}`);

// Safe - validate input
const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '');
await sandbox.exec(`cat ${safeFilename}`);

// Better - write to file
await sandbox.writeFile('/tmp/input.txt', userInput);
await sandbox.exec('python process.py /tmp/input.txt');
```

### Shell Commands

```typescript
// Pipes and filters
await sandbox.exec('ls -la | grep ".py" | wc -l');

// Output redirection
await sandbox.exec('python generate.py > output.txt 2> errors.txt');

// Multiple commands
await sandbox.exec('cd /workspace && npm install && npm test');
```

---

## Manage Files

Read, write, and organize files in the sandbox filesystem.

### Write Files

```typescript
// Text files
await sandbox.writeFile('/workspace/app.js', `console.log('Hello!');`);

// Binary files (base64)
await sandbox.writeFile('/tmp/image.png', base64Data, { encoding: 'base64' });

// JSON data
await sandbox.writeFile('/workspace/config.json', JSON.stringify(config, null, 2));
```

### Read Files

```typescript
const file = await sandbox.readFile('/workspace/package.json');
const pkg = JSON.parse(file.content);

// Binary files
const image = await sandbox.readFile('/tmp/image.png', { encoding: 'base64' });
```

### Check File Existence

```typescript
const result = await sandbox.exists('/workspace/package.json');
if (result.exists) {
  const file = await sandbox.readFile('/workspace/package.json');
}
```

### Create Directories

```typescript
await sandbox.mkdir('/workspace/src');
await sandbox.mkdir('/workspace/src/components/ui', { recursive: true });
```

### Git Operations

```typescript
await sandbox.gitCheckout('https://github.com/user/repo');

await sandbox.gitCheckout('https://github.com/user/repo', {
  branch: 'develop',
  targetDir: 'my-project',
  depth: 1 // Shallow clone
});
```

---

## Expose Services

Create preview URLs for web services running in your sandbox.

> **Production requires custom domain** with wildcard DNS routing.

### Basic Port Exposure

```typescript
import { getSandbox, proxyToSandbox } from '@cloudflare/sandbox';

export { Sandbox } from '@cloudflare/sandbox';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Proxy requests to exposed ports first
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    const { hostname } = new URL(request.url);
    const sandbox = getSandbox(env.Sandbox, 'my-sandbox');

    // Start a web server
    await sandbox.startProcess('python -m http.server 8000');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Expose the port
    const exposed = await sandbox.exposePort(8000, { hostname });
    console.log('Available at:', exposed.exposedAt);

    return Response.json({ url: exposed.exposedAt });
  }
};
```

> **Warning:** Preview URLs are public by default.

### Local Development

Add `EXPOSE` directives to your Dockerfile:

```dockerfile
FROM docker.io/cloudflare/sandbox:0.3.3

# Required for local development
EXPOSE 3000
EXPOSE 8080
```

Without `EXPOSE`, you'll see: "Connection refused: container port not found"

### Named Ports

```typescript
const { hostname } = new URL(request.url);

const api = await sandbox.exposePort(8080, { hostname, name: 'api' });
const frontend = await sandbox.exposePort(5173, { hostname, name: 'frontend' });
```

### Uppercase ID Warning

Preview URLs lowercase the sandbox ID. Use `normalizeId: true`:

```typescript
const sandbox = getSandbox(env.Sandbox, 'MyProject-123', { normalizeId: true });
```

---

## Background Processes

Start and manage long-running services.

### Start a Process

```typescript
const server = await sandbox.startProcess('node server.js');
console.log('Started with PID:', server.pid);

// With custom environment
const app = await sandbox.startProcess('node app.js', {
  cwd: '/workspace/my-app',
  env: { NODE_ENV: 'production', PORT: '3000' }
});
```

### Wait for Readiness

```typescript
const server = await sandbox.startProcess('node server.js');

// HTTP mode (default)
await server.waitForPort(3000);

// With health check
await server.waitForPort(8080, {
  path: '/health',
  status: { min: 200, max: 299 },
  timeout: 30000
});

// TCP mode for databases
const db = await sandbox.startProcess('redis-server');
await db.waitForPort(6379, { mode: 'tcp' });
```

### Wait for Log Pattern

```typescript
const server = await sandbox.startProcess('node server.js');

const result = await server.waitForLog(/Server listening on port (\d+)/);
console.log('Port:', result.matches[1]);
```

### Stream Logs

```typescript
import { parseSSEStream, type LogEvent } from '@cloudflare/sandbox';

const server = await sandbox.startProcess('node server.js');
const logStream = await sandbox.streamProcessLogs(server.id);

for await (const log of parseSSEStream<LogEvent>(logStream)) {
  console.log(log.data);
}
```

### Stop Processes

```typescript
await sandbox.killProcess(server.id);
await sandbox.killProcess(server.id, 'SIGKILL'); // Force kill
await sandbox.killAllProcesses();
```

### Keep Alive for Long-Running Processes

```typescript
const sandbox = getSandbox(env.Sandbox, 'build-job-123', {
  keepAlive: true
});

try {
  const build = await sandbox.startProcess('npm run build:production');
  // Process can run indefinitely
} finally {
  await sandbox.destroy(); // Must explicitly destroy
}
```

---

## Code Execution

Execute Python and JavaScript with rich outputs using the Code Interpreter.

### When to Use Code Interpreter

Use Code Interpreter for:
- Quick code execution without setup
- Rich outputs (charts, tables, images)
- AI-generated code execution
- Persistent state between executions

Use `exec()` for:
- System operations (install packages, manage files)
- Custom environments
- Shell commands
- Long-running processes

### Create Context and Run Code

```typescript
const ctx = await sandbox.createCodeContext({ language: 'python' });

// Variables persist between executions
await sandbox.runCode('import math; radius = 5', { context: ctx });
const result = await sandbox.runCode('math.pi * radius ** 2', { context: ctx });

console.log(result.results[0].text); // "78.53981633974483"
```

### Rich Outputs

```typescript
// Charts (matplotlib)
const result = await sandbox.runCode(`
import matplotlib.pyplot as plt
plt.plot([1, 2, 3], [1, 4, 9])
plt.show()
`, { language: 'python' });

if (result.results[0]?.png) {
  return new Response(atob(result.results[0].png), {
    headers: { 'Content-Type': 'image/png' }
  });
}

// Tables (pandas)
const result = await sandbox.runCode(`
import pandas as pd
df = pd.DataFrame({'Name': ['Alice', 'Bob'], 'Age': [25, 30]})
df
`, { language: 'python' });

if (result.results[0]?.html) {
  return new Response(result.results[0].html, {
    headers: { 'Content-Type': 'text/html' }
  });
}
```

### Stream Long Operations

```typescript
const result = await sandbox.runCode(longCode, {
  context: ctx,
  stream: true,
  onOutput: (data) => console.log('Output:', data),
  onResult: (result) => console.log('Result:', result),
  onError: (error) => console.error('Error:', error)
});
```

---

## Streaming Output

Handle real-time output from commands and processes.

### Stream Command Output

```typescript
import { parseSSEStream, type ExecEvent } from '@cloudflare/sandbox';

const stream = await sandbox.execStream('npm run build');

for await (const event of parseSSEStream<ExecEvent>(stream)) {
  switch (event.type) {
    case 'stdout':
      console.log(event.data);
      break;
    case 'stderr':
      console.error(event.data);
      break;
    case 'complete':
      console.log('Exit code:', event.exitCode);
      break;
    case 'error':
      console.error('Failed:', event.error);
      break;
  }
}
```

### Callback-Based Streaming

```typescript
await sandbox.exec('npm install', {
  stream: true,
  onOutput: (stream, data) => {
    console.log(`[${stream}] ${data}`);
  }
});
```

---

## WebSocket Connections

Connect to WebSocket servers running in sandboxes.

### Direct WebSocket Connection

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const sandbox = getSandbox(env.Sandbox, 'my-sandbox');
      return await sandbox.wsConnect(request, 8080);
    }
    return new Response('WebSocket endpoint', { status: 200 });
  }
};
```

### Via Preview URLs

```typescript
const { hostname } = new URL(request.url);

await sandbox.startProcess('bun run ws-server.ts 8080');
const { exposedAt } = await sandbox.exposePort(8080, { hostname });

// Clients connect: new WebSocket('wss://8080-abc123.yourdomain.com')
```

---

## Git Workflows

Clone repositories and manage Git operations.

### Clone a Repository

```typescript
await sandbox.gitCheckout('https://github.com/user/repo');

// With options
await sandbox.gitCheckout('https://github.com/user/repo', {
  branch: 'develop',
  targetDir: 'my-project',
  depth: 1 // Shallow clone
});
```

### Git Operations via exec

```typescript
await sandbox.exec('git clone https://github.com/user/repo.git');
await sandbox.exec('cd repo && git checkout -b feature/new');
await sandbox.exec('cd repo && git status');
```

---

## Mount Buckets

Mount S3-compatible object storage as local filesystems.

> **Note:** Bucket mounting requires production deployment. Does not work with `wrangler dev`.

### Mount R2 Bucket

```typescript
// Credentials from environment variables
await sandbox.mountBucket('my-r2-bucket', '/data', {
  endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com'
});

// Access mounted bucket
await sandbox.exec('ls /data');
await sandbox.writeFile('/data/results.json', JSON.stringify(data));
```

### Explicit Credentials

```typescript
await sandbox.mountBucket('my-bucket', '/storage', {
  endpoint: 'https://s3.amazonaws.com',
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY
  }
});
```

### Read-Only Mount

```typescript
await sandbox.mountBucket('datasets', '/datasets', {
  endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com',
  readOnly: true
});
```

### Unmount

```typescript
await sandbox.unmountBucket('/data');
```

---

## Production Deployment

Set up custom domains for preview URLs in production.

### Why Custom Domain Required

Preview URLs use wildcard subdomains (`https://8000-sandbox-id.yourdomain.com`). The `.workers.dev` domain doesn't support this pattern.

### Setup Steps

1. **Add custom domain** to your Cloudflare zone

2. **Configure wildcard DNS**:
   ```
   *.yourdomain.com → Your Worker
   ```

3. **Update Worker routes** in wrangler.toml:
   ```toml
   routes = [
     { pattern = "yourdomain.com/*", zone_name = "yourdomain.com" },
     { pattern = "*.yourdomain.com/*", zone_name = "yourdomain.com" }
   ]
   ```

4. **Use hostname in exposePort**:
   ```typescript
   const { hostname } = new URL(request.url);
   await sandbox.exposePort(8080, { hostname });
   ```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| 522 Connection Timeout | Ensure wildcard DNS routing configured |
| 404 Not Found | Check `proxyToSandbox()` called first in fetch handler |
| Service unreachable | Verify service binds to `0.0.0.0`, not `127.0.0.1` |
