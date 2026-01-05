# Sandbox SDK Configuration

Configure your Worker, Dockerfile, environment variables, and sandbox options.

---

## Wrangler Configuration

The `wrangler.jsonc` (or `wrangler.toml`) file connects Workers, Durable Objects, and Containers.

### JSONC Format

```jsonc
{
  "name": "my-sandbox-app",
  "main": "src/index.ts",
  "compatibility_date": "2024-11-01",

  "containers": [
    {
      "class_name": "Sandbox",
      "image": "./Dockerfile",
      "instance_type": "lite",
      "max_instances": 1
    }
  ],

  "durable_objects": {
    "bindings": [
      {
        "class_name": "Sandbox",
        "name": "Sandbox"
      }
    ]
  },

  "migrations": [
    {
      "new_sqlite_classes": ["Sandbox"],
      "tag": "v1"
    }
  ]
}
```

### TOML Format

```toml
name = "my-sandbox-app"
main = "src/index.ts"
compatibility_date = "2024-11-01"

[[containers]]
class_name = "Sandbox"
image = "./Dockerfile"
instance_type = "lite"
max_instances = 1

[[durable_objects.bindings]]
class_name = "Sandbox"
name = "Sandbox"

[[migrations]]
new_sqlite_classes = ["Sandbox"]
tag = "v1"
```

### Container Configuration

| Field | Description |
|-------|-------------|
| `class_name` | Durable Object class name (must match export) |
| `image` | Path to Dockerfile or remote image |
| `instance_type` | `"lite"`, `"standard"`, or `"large"` |
| `max_instances` | Maximum concurrent containers |

### Instance Types

| Type | vCPU | Memory | Disk | Best For |
|------|------|--------|------|----------|
| `lite` | 0.25 | 512 MB | 2 GB | Light scripts, simple tasks |
| `standard` | 1 | 2 GB | 10 GB | Most workloads |
| `large` | 4 | 8 GB | 20 GB | ML, large builds |

---

## Dockerfile Reference

Customize the sandbox container image by extending the base image.

### Base Image

```dockerfile
FROM docker.io/cloudflare/sandbox:0.3.3
```

> **Important:** Match Docker image version to npm package version.

**What's included:**
- Ubuntu 22.04 LTS
- Python 3.11 with pip and venv
- Node.js 20 LTS with npm
- Bun 1.x
- Pre-installed: matplotlib, numpy, pandas, ipython
- Utilities: curl, wget, git, jq, zip, unzip

### Install Additional Packages

```dockerfile
FROM docker.io/cloudflare/sandbox:0.3.3

# Python packages
RUN pip install --no-cache-dir \
    scikit-learn==1.3.0 \
    tensorflow==2.13.0 \
    transformers==4.30.0

# Node.js packages globally
RUN npm install -g typescript ts-node prettier

# System packages
RUN apt-get update && apt-get install -y \
    postgresql-client \
    redis-tools \
    && rm -rf /var/lib/apt/lists/*
```

### Expose Ports for Local Dev

Required for `wrangler dev` to route to container ports:

```dockerfile
FROM docker.io/cloudflare/sandbox:0.3.3

# Required for local development
EXPOSE 3000
EXPOSE 8080
EXPOSE 5173
```

### Custom Startup Script

```dockerfile
FROM docker.io/cloudflare/sandbox:0.3.3

COPY my-app.js /workspace/my-app.js
COPY startup.sh /workspace/startup.sh
RUN chmod +x /workspace/startup.sh
CMD ["/workspace/startup.sh"]
```

**startup.sh:**
```bash
#!/bin/bash

# Start your services in the background
node /workspace/my-app.js &

# Must end with this command
exec bun /container-server/dist/index.js
```

> **Critical:** Your startup script must end with `exec bun /container-server/dist/index.js`.

### Multiple Services

```bash
#!/bin/bash

redis-server --daemonize yes
until redis-cli ping; do sleep 1; done

node /workspace/api-server.js &

exec bun /container-server/dist/index.js
```

---

## Environment Variables

Pass configuration, secrets, and runtime settings to sandboxes.

### Three Ways to Set Environment Variables

#### 1. Sandbox-level (setEnvVars)

```typescript
const sandbox = getSandbox(env.Sandbox, 'my-sandbox');

// Set once, available for all subsequent commands
await sandbox.setEnvVars({
  DATABASE_URL: env.DATABASE_URL,
  API_KEY: env.API_KEY
});

await sandbox.exec('python migrate.py'); // Has both vars
await sandbox.exec('python seed.py');    // Has both vars
```

#### 2. Per-command (exec options)

```typescript
await sandbox.exec('node app.js', {
  env: {
    NODE_ENV: 'production',
    PORT: '3000'
  }
});

await sandbox.startProcess('python server.py', {
  env: { DATABASE_URL: env.DATABASE_URL }
});
```

#### 3. Session-level (createSession)

```typescript
const session = await sandbox.createSession({
  env: {
    DATABASE_URL: env.DATABASE_URL,
    SECRET_KEY: env.SECRET_KEY
  }
});

await session.exec('python migrate.py');
await session.exec('python seed.py');
```

### Pass Worker Secrets

First, set secrets using Wrangler:

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put DATABASE_URL
```

Then pass to sandbox:

```typescript
interface Env {
  Sandbox: DurableObjectNamespace;
  OPENAI_API_KEY: string;
  DATABASE_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sandbox = getSandbox(env.Sandbox, 'user-sandbox');

    await sandbox.setEnvVars({
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      DATABASE_URL: env.DATABASE_URL
    });

    await sandbox.exec('python analyze.py');
    return Response.json({ success: true });
  }
};
```

### Bucket Mounting Credentials

For R2/S3 bucket mounting, use AWS-style credential names:

```bash
wrangler secret put AWS_ACCESS_KEY_ID
wrangler secret put AWS_SECRET_ACCESS_KEY
```

The SDK automatically detects these when calling `mountBucket()`.

### Precedence

When the same variable is set at multiple levels:

1. **Command-level** (highest) - `exec()` or `startProcess()` options
2. **Sandbox/session-level** - `setEnvVars()`
3. **Container default** - Built into Dockerfile with `ENV`
4. **System default** (lowest) - OS defaults

---

## Sandbox Options

Configure sandbox behavior when calling `getSandbox()`.

```typescript
import { getSandbox } from '@cloudflare/sandbox';

const sandbox = getSandbox(env.Sandbox, 'my-sandbox', {
  keepAlive: true,
  sleepAfter: '30s',
  normalizeId: false,
  containerTimeouts: {
    portReadyTimeoutMS: 120000,
    instanceGetTimeoutMS: 60000
  }
});
```

### keepAlive

**Type:** `boolean` **Default:** `false`

Prevent automatic shutdown. Container stays alive until explicitly destroyed.

```typescript
const sandbox = getSandbox(env.Sandbox, 'user-123', {
  keepAlive: true
});

try {
  await sandbox.startProcess('python long_running_script.py');
  // Work here
} finally {
  await sandbox.destroy(); // Required!
}
```

> **Warning:** When `keepAlive: true`, you **must** call `destroy()`.

### sleepAfter

**Type:** `string | number` **Default:** `"10m"`

Duration of inactivity before auto-sleep.

```typescript
// Sleep after 30 seconds
const sandbox = getSandbox(env.Sandbox, 'user-123', {
  sleepAfter: '30s'
});

// Sleep after 5 minutes (300 seconds)
const sandbox2 = getSandbox(env.Sandbox, 'user-456', {
  sleepAfter: 300
});
```

Supported formats: `"30s"`, `"5m"`, `"1h"`, or number (seconds).

> **Note:** Ignored when `keepAlive: true`.

### normalizeId

**Type:** `boolean` **Default:** `false`

Lowercase sandbox IDs for preview URL compatibility.

```typescript
const sandbox = getSandbox(env.Sandbox, 'MyProject-123', {
  normalizeId: true
});
// Durable Object ID becomes: "myproject-123"
```

Use when:
- Exposing ports with `exposePort()`
- Your sandbox IDs contain uppercase letters

### containerTimeouts

Configure container startup timeouts.

```typescript
const sandbox = getSandbox(env.Sandbox, 'data-processor', {
  containerTimeouts: {
    // Time for container to boot and SDK to become ready
    portReadyTimeoutMS: 180_000, // 3 minutes

    // Time to acquire container instance during traffic spikes
    instanceGetTimeoutMS: 60_000 // 1 minute
  }
});
```

| Field | Default | Description |
|-------|---------|-------------|
| `portReadyTimeoutMS` | 120000 | Wait for SDK control plane to start |
| `instanceGetTimeoutMS` | 30000 | Wait for container provisioning |

Increase `portReadyTimeoutMS` if your Dockerfile does heavy work (installing packages, starting services).

---

## Common Configuration Patterns

### Development Setup

```dockerfile
FROM docker.io/cloudflare/sandbox:0.3.3

# Expose ports for local dev
EXPOSE 3000
EXPOSE 8080

# Install dev dependencies
RUN pip install pytest black flake8
RUN npm install -g nodemon
```

### Production Setup

```jsonc
{
  "containers": [
    {
      "class_name": "Sandbox",
      "image": "./Dockerfile",
      "instance_type": "standard",
      "max_instances": 10
    }
  ]
}
```

### AI Workload Setup

```dockerfile
FROM docker.io/cloudflare/sandbox:0.3.3

# ML libraries
RUN pip install --no-cache-dir \
    torch \
    transformers \
    scikit-learn \
    openai
```

```jsonc
{
  "containers": [
    {
      "class_name": "Sandbox",
      "image": "./Dockerfile",
      "instance_type": "large",
      "max_instances": 5
    }
  ]
}
```
