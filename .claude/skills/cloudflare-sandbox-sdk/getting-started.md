# Getting Started with Sandbox SDK

Build your first application with Sandbox SDK - a secure code execution environment. In this guide, you'll create a Worker that can execute Python code and work with files in isolated containers.

## Prerequisites

1. Sign up for a [Cloudflare account](https://dash.cloudflare.com/sign-up/workers-and-pages)
2. Install [Node.js](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) (version 16.17.0 or later)
3. Have [Docker](https://www.docker.com/) running locally

**Check Docker is running:**
```bash
docker info
```

If Docker is not running, install [Docker Desktop](https://docs.docker.com/desktop/).

## 1. Create a New Project

```bash
# npm
npm create cloudflare@latest -- my-sandbox --template=cloudflare/sandbox-sdk/examples/minimal

# yarn
yarn create cloudflare my-sandbox --template=cloudflare/sandbox-sdk/examples/minimal

# pnpm
pnpm create cloudflare@latest my-sandbox --template=cloudflare/sandbox-sdk/examples/minimal
```

This creates a `my-sandbox` directory with:
- `src/index.ts` - Worker with sandbox integration
- `wrangler.jsonc` - Configuration for Workers and Containers
- `Dockerfile` - Container environment definition

```bash
cd my-sandbox
```

## 2. Explore the Template

```typescript
import { getSandbox, proxyToSandbox, type Sandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

type Env = {
  Sandbox: DurableObjectNamespace<Sandbox>;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Get or create a sandbox instance
    const sandbox = getSandbox(env.Sandbox, "my-sandbox");

    // Execute Python code
    if (url.pathname === "/run") {
      const result = await sandbox.exec('python3 -c "print(2 + 2)"');
      return Response.json({
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        success: result.success,
      });
    }

    // Work with files
    if (url.pathname === "/file") {
      await sandbox.writeFile("/workspace/hello.txt", "Hello, Sandbox!");
      const file = await sandbox.readFile("/workspace/hello.txt");
      return Response.json({
        content: file.content,
      });
    }

    return new Response("Try /run or /file");
  },
};
```

**Key concepts:**
- `getSandbox()` - Gets or creates a sandbox instance by ID. Same ID = same sandbox.
- `sandbox.exec()` - Execute shell commands, capture stdout/stderr/exit codes.
- `sandbox.writeFile()` / `readFile()` - File operations in sandbox filesystem.

## 3. Test Locally

Start the development server:

```bash
npm run dev
```

> **Note:** First run builds the Docker container (2-3 minutes). Subsequent runs are faster due to caching.

Test the endpoints:

```bash
# Execute Python code
curl http://localhost:8787/run

# File operations
curl http://localhost:8787/file
```

## 4. Deploy to Production

```bash
npx wrangler deploy
```

This will:
1. Build your container image using Docker
2. Push it to Cloudflare's Container Registry
3. Deploy your Worker globally

> **Wait for provisioning:** After first deployment, wait 2-3 minutes before making requests.

Check deployment status:

```bash
npx wrangler containers list
```

## 5. Test Your Deployment

```bash
# Replace with your actual URL
curl https://my-sandbox.YOUR_SUBDOMAIN.workers.dev/run
```

## Understanding the Configuration

Your `wrangler.jsonc` connects three pieces together:

```jsonc
{
  "containers": [
    {
      "class_name": "Sandbox",
      "image": "./Dockerfile",
      "instance_type": "lite",
      "max_instances": 1,
    },
  ],
  "durable_objects": {
    "bindings": [
      {
        "class_name": "Sandbox",
        "name": "Sandbox",
      },
    ],
  },
  "migrations": [
    {
      "new_sqlite_classes": ["Sandbox"],
      "tag": "v1",
    },
  ],
}
```

Or in `wrangler.toml`:

```toml
[[containers]]
class_name = "Sandbox"
image = "./Dockerfile"
instance_type = "lite"
max_instances = 1

[[durable_objects.bindings]]
class_name = "Sandbox"
name = "Sandbox"

[[migrations]]
new_sqlite_classes = [ "Sandbox" ]
tag = "v1"
```

- **containers** - Defines container image, instance type, and resource limits
- **durable_objects** - Creates a binding making `Sandbox` accessible in Worker code
- **migrations** - Registers the `Sandbox` class with SQLite storage backend

## Preview URLs Require Custom Domain

If you plan to expose ports from sandboxes (using `exposePort()` for preview URLs), you need a custom domain with wildcard DNS routing. The `.workers.dev` domain doesn't support wildcard subdomains. See [Production Deployment](guides.md#production-deployment) for setup.

## Next Steps

- [Execute commands](guides.md#execute-commands) - Run shell commands and stream output
- [Manage files](guides.md#manage-files) - Work with files and directories
- [Expose services](guides.md#expose-services) - Get public URLs for services
- [API reference](api.md) - Complete API documentation
