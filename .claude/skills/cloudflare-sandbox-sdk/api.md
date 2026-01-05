# Sandbox SDK API Reference

Complete API documentation for all Sandbox SDK methods.

---

## Lifecycle API

### `getSandbox()`

Get or create a sandbox instance by ID.

```typescript
const sandbox = getSandbox(
  binding: DurableObjectNamespace<Sandbox>,
  sandboxId: string,
  options?: SandboxOptions
): Sandbox
```

**Parameters:**
- `binding` - The Durable Object namespace binding from your Worker environment
- `sandboxId` - Unique identifier for this sandbox (same ID = same sandbox)
- `options` (optional):
  - `sleepAfter` - Duration before auto-sleep (default: `"10m"`)
  - `keepAlive` - Prevent automatic sleep (default: `false`)
  - `containerTimeouts` - Configure startup timeouts
  - `normalizeId` - Lowercase IDs for preview URL compatibility (default: `false`)

```typescript
import { getSandbox } from '@cloudflare/sandbox';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sandbox = getSandbox(env.Sandbox, 'user-123');
    const result = await sandbox.exec('python script.py');
    return Response.json(result);
  }
};
```

> **Note:** Container starts lazily on first operation.

### `destroy()`

Destroy the sandbox and free resources.

```typescript
await sandbox.destroy(): Promise<void>
```

Terminates container and permanently deletes all state (files, processes, sessions).

```typescript
async function executeCode(code: string): Promise<string> {
  const sandbox = getSandbox(env.Sandbox, `temp-${Date.now()}`);
  try {
    await sandbox.writeFile('/tmp/code.py', code);
    const result = await sandbox.exec('python /tmp/code.py');
    return result.stdout;
  } finally {
    await sandbox.destroy();
  }
}
```

---

## Commands API

### `exec()`

Execute a command and return the complete result.

```typescript
const result = await sandbox.exec(
  command: string,
  options?: ExecOptions
): Promise<ExecuteResponse>
```

**Parameters:**
- `command` - Command to execute (can include arguments)
- `options` (optional):
  - `stream` - Enable streaming callbacks (default: `false`)
  - `onOutput` - Callback: `(stream: 'stdout' | 'stderr', data: string) => void`
  - `timeout` - Maximum execution time in milliseconds

**Returns:** `{ success, stdout, stderr, exitCode }`

```typescript
const result = await sandbox.exec('npm run build');

if (result.success) {
  console.log('Build output:', result.stdout);
} else {
  console.error('Build failed:', result.stderr);
}

// With streaming
await sandbox.exec('npm install', {
  stream: true,
  onOutput: (stream, data) => console.log(`[${stream}] ${data}`)
});
```

### `execStream()`

Execute a command and return a Server-Sent Events stream.

```typescript
const stream = await sandbox.execStream(
  command: string,
  options?: ExecOptions
): Promise<ReadableStream>
```

**Returns:** Stream emitting `ExecEvent` objects (`start`, `stdout`, `stderr`, `complete`, `error`)

```typescript
import { parseSSEStream, type ExecEvent } from '@cloudflare/sandbox';

const stream = await sandbox.execStream('npm run build');

for await (const event of parseSSEStream<ExecEvent>(stream)) {
  switch (event.type) {
    case 'stdout':
      console.log('Output:', event.data);
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

### `startProcess()`

Start a long-running background process.

```typescript
const process = await sandbox.startProcess(
  command: string,
  options?: ProcessOptions
): Promise<Process>
```

**Parameters:**
- `command` - Command to start
- `options` (optional):
  - `cwd` - Working directory
  - `env` - Environment variables

**Returns:** `Process` object with:
- `id`, `pid`, `command`, `status`
- `kill()`, `getStatus()`, `getLogs()`
- `waitForPort()`, `waitForLog()`

```typescript
const server = await sandbox.startProcess('python -m http.server 8000');
console.log('Started with PID:', server.pid);

// With custom environment
const app = await sandbox.startProcess('node app.js', {
  cwd: '/workspace/my-app',
  env: { NODE_ENV: 'production', PORT: '3000' }
});
```

### `listProcesses()`

List all running processes.

```typescript
const processes = await sandbox.listProcesses(): Promise<ProcessInfo[]>
```

```typescript
const processes = await sandbox.listProcesses();
for (const proc of processes) {
  console.log(`${proc.id}: ${proc.command} (PID ${proc.pid})`);
}
```

### `killProcess()`

Terminate a specific process.

```typescript
await sandbox.killProcess(processId: string, signal?: string): Promise<void>
```

**Parameters:**
- `processId` - Process ID from `startProcess()` or `listProcesses()`
- `signal` - Signal to send (default: `"SIGTERM"`)

### `killAllProcesses()`

Terminate all running processes.

```typescript
await sandbox.killAllProcesses(): Promise<void>
```

### `getProcessLogs()`

Get accumulated logs from a process.

```typescript
const logs = await sandbox.getProcessLogs(processId: string): Promise<string>
```

### `streamProcessLogs()`

Stream logs from a running process in real-time.

```typescript
const stream = await sandbox.streamProcessLogs(processId: string): Promise<ReadableStream>
```

```typescript
import { parseSSEStream, type LogEvent } from '@cloudflare/sandbox';

const server = await sandbox.startProcess('node server.js');
const logStream = await sandbox.streamProcessLogs(server.id);

for await (const log of parseSSEStream<LogEvent>(logStream)) {
  console.log(`[${log.timestamp}] ${log.data}`);
  if (log.data.includes('Server started')) break;
}
```

### `process.waitForPort()`

Wait for a process to listen on a port.

```typescript
await process.waitForPort(port: number, options?: WaitForPortOptions): Promise<void>
```

**Options:**
- `mode` - `'http'` (default) or `'tcp'`
- `timeout` - Maximum wait time in ms
- `interval` - Check interval in ms (default: 100)
- `path` - HTTP path to check (default: `'/'`)
- `status` - Expected HTTP status range (default: `{ min: 200, max: 399 }`)

```typescript
const server = await sandbox.startProcess('node server.js');

// HTTP mode (default)
await server.waitForPort(3000);

// TCP mode for databases
const db = await sandbox.startProcess('redis-server');
await db.waitForPort(6379, { mode: 'tcp', timeout: 10000 });
```

### `process.waitForLog()`

Wait for a pattern to appear in process output.

```typescript
const result = await process.waitForLog(
  pattern: string | RegExp,
  timeout?: number
): Promise<WaitForLogResult>
```

**Returns:** `{ line, matches }` (matches = capture groups for RegExp)

```typescript
const server = await sandbox.startProcess('node server.js');

// String pattern
const result = await server.waitForLog('Server listening');

// RegExp with capture groups
const result = await server.waitForLog(/Server listening on port (\d+)/);
console.log('Port:', result.matches[1]);
```

---

## Files API

### `writeFile()`

Write content to a file.

```typescript
await sandbox.writeFile(
  path: string,
  content: string,
  options?: WriteFileOptions
): Promise<void>
```

**Parameters:**
- `path` - Absolute path to file
- `content` - Content to write
- `options`:
  - `encoding` - `"utf-8"` (default) or `"base64"`

```typescript
await sandbox.writeFile('/workspace/app.js', `console.log('Hello!');`);

// Binary data
await sandbox.writeFile('/tmp/image.png', base64Data, { encoding: 'base64' });
```

### `readFile()`

Read a file from the sandbox.

```typescript
const file = await sandbox.readFile(
  path: string,
  options?: ReadFileOptions
): Promise<FileInfo>
```

**Returns:** `{ content, encoding }`

```typescript
const file = await sandbox.readFile('/workspace/package.json');
const pkg = JSON.parse(file.content);

// Binary data
const image = await sandbox.readFile('/tmp/image.png', { encoding: 'base64' });
```

### `exists()`

Check if a file or directory exists.

```typescript
const result = await sandbox.exists(path: string): Promise<FileExistsResult>
```

**Returns:** `{ exists: boolean }`

```typescript
const result = await sandbox.exists('/workspace/package.json');
if (result.exists) {
  const file = await sandbox.readFile('/workspace/package.json');
}
```

### `mkdir()`

Create a directory.

```typescript
await sandbox.mkdir(path: string, options?: MkdirOptions): Promise<void>
```

**Options:**
- `recursive` - Create parent directories (default: `false`)

```typescript
await sandbox.mkdir('/workspace/src');
await sandbox.mkdir('/workspace/src/components/ui', { recursive: true });
```

### `deleteFile()`

Delete a file.

```typescript
await sandbox.deleteFile(path: string): Promise<void>
```

### `renameFile()`

Rename a file.

```typescript
await sandbox.renameFile(oldPath: string, newPath: string): Promise<void>
```

### `moveFile()`

Move a file to a different directory.

```typescript
await sandbox.moveFile(sourcePath: string, destinationPath: string): Promise<void>
```

### `gitCheckout()`

Clone a git repository.

```typescript
await sandbox.gitCheckout(repoUrl: string, options?: GitCheckoutOptions): Promise<void>
```

**Options:**
- `branch` - Branch to checkout (default: main)
- `targetDir` - Directory to clone into (default: repo name)
- `depth` - Clone depth for shallow clone

```typescript
await sandbox.gitCheckout('https://github.com/user/repo');

await sandbox.gitCheckout('https://github.com/user/repo', {
  branch: 'develop',
  targetDir: 'my-project'
});
```

---

## Code Interpreter API

### `createCodeContext()`

Create a persistent execution context for running code.

```typescript
const context = await sandbox.createCodeContext(
  options?: CreateContextOptions
): Promise<CodeContext>
```

**Options:**
- `language` - `"python"` | `"javascript"` | `"typescript"` (default: `"python"`)
- `cwd` - Working directory (default: `"/workspace"`)
- `envVars` - Environment variables
- `timeout` - Request timeout in ms (default: 30000)

**Returns:** `{ id, language, cwd, createdAt, lastUsed }`

```typescript
const ctx = await sandbox.createCodeContext({
  language: 'python',
  envVars: { API_KEY: env.API_KEY }
});
```

### `runCode()`

Execute code in a context and return the result.

```typescript
const result = await sandbox.runCode(
  code: string,
  options?: RunCodeOptions
): Promise<ExecutionResult>
```

**Options:**
- `context` - Context to run in (recommended)
- `language` - `"python"` | `"javascript"` | `"typescript"` (default: `"python"`)
- `timeout` - Execution timeout in ms (default: 60000)
- `onStdout`, `onStderr`, `onResult`, `onError` - Streaming callbacks

**Returns:**
- `code` - The executed code
- `logs` - `{ stdout, stderr }` arrays
- `results` - Array of rich outputs
- `error` - Execution error if any
- `executionCount` - Execution counter

```typescript
const ctx = await sandbox.createCodeContext({ language: 'python' });

await sandbox.runCode('import math; radius = 5', { context: ctx });
const result = await sandbox.runCode('math.pi * radius ** 2', { context: ctx });

console.log(result.results[0].text); // "78.53981633974483"
```

**Error handling:**
```typescript
const result = await sandbox.runCode('x = 1 / 0', { language: 'python' });

if (result.error) {
  console.error(result.error.name);      // "ZeroDivisionError"
  console.error(result.error.value);     // "division by zero"
  console.error(result.error.traceback); // Stack trace array
}
```

### Rich Output Formats

Results include: `text`, `html`, `png`, `jpeg`, `svg`, `latex`, `markdown`, `json`, `chart`, `data`

**Charts (matplotlib):**
```typescript
const result = await sandbox.runCode(`
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 100)
plt.plot(x, np.sin(x))
plt.show()
`, { language: 'python' });

if (result.results[0]?.png) {
  const imageBuffer = Buffer.from(result.results[0].png, 'base64');
  return new Response(imageBuffer, {
    headers: { 'Content-Type': 'image/png' }
  });
}
```

**Tables (pandas):**
```typescript
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

### `listCodeContexts()`

List all active code execution contexts.

```typescript
const contexts = await sandbox.listCodeContexts(): Promise<CodeContext[]>
```

### `deleteCodeContext()`

Delete a code execution context and free its resources.

```typescript
await sandbox.deleteCodeContext(contextId: string): Promise<void>
```

---

## Ports API

### `exposePort()`

Expose a port and get a preview URL.

```typescript
const response = await sandbox.exposePort(
  port: number,
  options: ExposePortOptions
): Promise<ExposePortResponse>
```

**Parameters:**
- `port` - Port number (1024-65535)
- `options`:
  - `hostname` - Your Worker's domain (required, cannot be `.workers.dev`)
  - `name` - Friendly name for the port (optional)

**Returns:** `{ port, url, name }`

```typescript
const { hostname } = new URL(request.url);

await sandbox.startProcess('python -m http.server 8000');
const exposed = await sandbox.exposePort(8000, { hostname });

console.log('Available at:', exposed.exposedAt);
// https://8000-abc123.yourdomain.com
```

> **Local development:** Add `EXPOSE` directives to Dockerfile for each port.

### `unexposePort()`

Remove an exposed port.

```typescript
await sandbox.unexposePort(port: number): Promise<void>
```

### `getExposedPorts()`

Get information about all exposed ports.

```typescript
const response = await sandbox.getExposedPorts(): Promise<GetExposedPortsResponse>
```

**Returns:** `{ ports: [{ port, exposedAt, name }] }`

### `wsConnect()`

Connect to WebSocket servers in the sandbox.

```typescript
const response = await sandbox.wsConnect(
  request: Request,
  port: number
): Promise<Response>
```

**Parameters:**
- `request` - Incoming WebSocket upgrade request
- `port` - Port number (1024-65535, excluding 3000)

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

---

## Storage API

> **Note:** Bucket mounting requires production deployment. Does not work with `wrangler dev`.

### `mountBucket()`

Mount an S3-compatible bucket as a local directory.

```typescript
await sandbox.mountBucket(
  bucket: string,
  mountPath: string,
  options: MountBucketOptions
): Promise<void>
```

**Parameters:**
- `bucket` - Bucket name (e.g., `"my-r2-bucket"`)
- `mountPath` - Local path to mount at (e.g., `"/data"`)
- `options`:
  - `endpoint` (required) - S3-compatible endpoint URL
  - `provider` (optional) - `'r2'` | `'s3'` | `'gcs'`
  - `credentials` (optional) - `{ accessKeyId, secretAccessKey }`
  - `readOnly` (optional) - Mount read-only (default: `false`)
  - `s3fsOptions` (optional) - Advanced s3fs flags

```typescript
// Mount R2 bucket (credentials from env vars)
await sandbox.mountBucket('my-r2-bucket', '/data', {
  endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com'
});

// Access mounted bucket
await sandbox.exec('ls /data');
await sandbox.writeFile('/data/results.json', JSON.stringify(data));

// With explicit credentials
await sandbox.mountBucket('my-bucket', '/storage', {
  endpoint: 'https://s3.amazonaws.com',
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY
  }
});

// Read-only mount
await sandbox.mountBucket('datasets', '/datasets', {
  endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com',
  readOnly: true
});
```

### `unmountBucket()`

Unmount a previously mounted bucket.

```typescript
await sandbox.unmountBucket(mountPath: string): Promise<void>
```

> Mounted buckets are automatically unmounted on `sandbox.destroy()`.

---

## Sessions API

### `createSession()`

Create a new isolated execution session.

```typescript
const session = await sandbox.createSession(
  options?: SessionOptions
): Promise<ExecutionSession>
```

**Options:**
- `id` - Custom session ID (auto-generated if not provided)
- `env` - Environment variables for this session
- `cwd` - Working directory (default: `"/workspace"`)

**Returns:** `ExecutionSession` with all sandbox methods bound to this session

```typescript
const prodSession = await sandbox.createSession({
  id: 'prod',
  env: { NODE_ENV: 'production' },
  cwd: '/workspace/prod'
});

const testSession = await sandbox.createSession({
  id: 'test',
  env: { NODE_ENV: 'test' },
  cwd: '/workspace/test'
});

// Run in parallel
const [prodResult, testResult] = await Promise.all([
  prodSession.exec('npm run build'),
  testSession.exec('npm run build')
]);
```

### `getSession()`

Retrieve an existing session by ID.

```typescript
const session = await sandbox.getSession(sessionId: string): Promise<ExecutionSession>
```

```typescript
// First request - create session
const session = await sandbox.createSession({ id: 'user-123' });
await session.exec('git clone https://github.com/user/repo.git');

// Later request - resume session
const session = await sandbox.getSession('user-123');
await session.exec('cd repo && npm run build');
```

### `deleteSession()`

Delete a session and clean up resources.

```typescript
const result = await sandbox.deleteSession(
  sessionId: string
): Promise<SessionDeleteResult>
```

**Returns:** `{ success, sessionId, timestamp }`

> **Note:** The default session cannot be deleted.

```typescript
const tempSession = await sandbox.createSession({ id: 'temp-task' });
try {
  await tempSession.exec('npm run heavy-task');
} finally {
  await sandbox.deleteSession('temp-task');
}
```

### `setEnvVars()`

Set environment variables in the sandbox.

```typescript
await sandbox.setEnvVars(envVars: Record<string, string>): Promise<void>
```

> Call `setEnvVars()` before any other sandbox operations.

```typescript
const sandbox = getSandbox(env.Sandbox, 'user-123');

await sandbox.setEnvVars({
  API_KEY: env.OPENAI_API_KEY,
  DATABASE_URL: env.DATABASE_URL,
  NODE_ENV: 'production'
});

await sandbox.exec('python script.py');
```

### ExecutionSession Methods

The `ExecutionSession` object has all sandbox methods bound to the session:

| Category | Methods |
|----------|---------|
| **Commands** | `exec()`, `execStream()` |
| **Processes** | `startProcess()`, `listProcesses()`, `killProcess()`, `killAllProcesses()`, `getProcessLogs()`, `streamProcessLogs()` |
| **Files** | `writeFile()`, `readFile()`, `mkdir()`, `deleteFile()`, `renameFile()`, `moveFile()`, `gitCheckout()` |
| **Environment** | `setEnvVars()` |
| **Code Interpreter** | `createCodeContext()`, `runCode()`, `listCodeContexts()`, `deleteCodeContext()` |
