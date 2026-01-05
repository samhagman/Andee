# Sandbox SDK Tutorials

Complete tutorials for building applications with the Sandbox SDK.

---

## AI Code Executor

Build an AI-powered code execution system using Claude. Turn natural language questions into Python code, execute it securely, and return results.

**Time:** 20 minutes

### What You'll Build

An API that accepts questions like "What's the 100th Fibonacci number?", uses Claude to generate Python code, executes it in a sandbox, and returns results.

### Prerequisites

- Cloudflare account
- Node.js 16.17+
- Docker running locally
- Anthropic API key

### 1. Create Project

```bash
npm create cloudflare@latest -- ai-code-executor --template=cloudflare/sandbox-sdk/examples/minimal
cd ai-code-executor
npm i @anthropic-ai/sdk
```

### 2. Build the Executor

Replace `src/index.ts`:

```typescript
import { getSandbox, type Sandbox } from '@cloudflare/sandbox';
import Anthropic from '@anthropic-ai/sdk';

export { Sandbox } from '@cloudflare/sandbox';

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ANTHROPIC_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/execute') {
      return new Response('POST /execute with { "question": "your question" }');
    }

    try {
      const { question } = await request.json();

      if (!question) {
        return Response.json({ error: 'Question is required' }, { status: 400 });
      }

      // Generate code with Claude
      const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const codeGeneration = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Generate Python code to answer: "${question}"

Requirements:
- Use only Python standard library
- Print the result using print()
- Keep code simple and safe

Return ONLY the code, no explanations.`
        }],
      });

      const generatedCode = codeGeneration.content[0]?.type === 'text'
        ? codeGeneration.content[0].text
        : '';

      // Strip markdown fences
      const cleanCode = generatedCode
        .replace(/^```python?\n?/, '')
        .replace(/\n?```\s*$/, '')
        .trim();

      // Execute in sandbox
      const sandbox = getSandbox(env.Sandbox, 'demo-user');
      await sandbox.writeFile('/tmp/code.py', cleanCode);
      const result = await sandbox.exec('python /tmp/code.py');

      return Response.json({
        success: result.success,
        question,
        code: generatedCode,
        output: result.stdout,
        error: result.stderr
      });

    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  },
};
```

### 3. Test & Deploy

```bash
# Set API key for local dev
echo "ANTHROPIC_API_KEY=your_key" > .dev.vars

# Test locally
npm run dev
curl -X POST http://localhost:8787/execute \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the 10th Fibonacci number?"}'

# Deploy
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY
```

---

## Analyze Data with AI

Build an AI-powered data analysis system that accepts CSV uploads, generates analysis code with Claude, and returns visualizations.

**Time:** 25 minutes

### What You'll Build

An API that accepts CSV files and questions, uses Claude to generate pandas/matplotlib analysis code, and returns insights with charts.

### Key Implementation

```typescript
import { getSandbox, proxyToSandbox, type Sandbox } from "@cloudflare/sandbox";
import Anthropic from "@anthropic-ai/sdk";

export { Sandbox } from "@cloudflare/sandbox";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    if (request.method !== "POST") {
      return Response.json({ error: "POST CSV file and question" }, { status: 405 });
    }

    const formData = await request.formData();
    const csvFile = formData.get("file") as File;
    const question = formData.get("question") as string;

    // Upload CSV to sandbox
    const sandbox = getSandbox(env.Sandbox, `analysis-${Date.now()}`);
    const csvPath = "/workspace/data.csv";
    await sandbox.writeFile(csvPath, await csvFile.text());

    // Analyze structure
    const structure = await sandbox.exec(
      `python3 -c "import pandas as pd; df = pd.read_csv('${csvPath}'); print(f'Rows: {len(df)}'); print(f'Columns: {list(df.columns)[:5]}')"`,
    );

    // Generate analysis code with Claude (using tool calling)
    const code = await generateAnalysisCode(env.ANTHROPIC_API_KEY, csvPath, question, structure.stdout);

    // Execute analysis
    await sandbox.writeFile("/workspace/analyze.py", code);
    const result = await sandbox.exec("python /workspace/analyze.py");

    // Check for generated chart
    let chart = null;
    try {
      const chartFile = await sandbox.readFile("/workspace/chart.png");
      chart = `data:image/png;base64,...`;
    } catch {}

    await sandbox.destroy();

    return Response.json({
      success: true,
      output: result.stdout,
      chart,
      code,
    });
  },
};
```

### Test

```bash
# Create test CSV
echo "year,rating,title
2020,8.5,Movie A
2021,7.2,Movie B
2022,9.1,Movie C" > test.csv

# Test
curl -X POST http://localhost:8787 \
  -F "file=@test.csv" \
  -F "question=What is the average rating by year?"
```

---

## Automated Testing Pipeline

Build a testing pipeline that clones Git repositories, installs dependencies, runs tests, and reports results.

**Time:** 25 minutes

### What You'll Build

A CI-like system that auto-detects project types (Node.js, Python, Go), installs dependencies, and runs tests.

### Key Implementation

```typescript
import { getSandbox, proxyToSandbox, parseSSEStream, type Sandbox, type ExecEvent } from '@cloudflare/sandbox';

export { Sandbox } from '@cloudflare/sandbox';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    const { repoUrl, branch } = await request.json();
    const sandbox = getSandbox(env.Sandbox, `test-${Date.now()}`);

    try {
      // Clone repository
      let cloneUrl = repoUrl;
      if (env.GITHUB_TOKEN && cloneUrl.includes('github.com')) {
        cloneUrl = cloneUrl.replace('https://', `https://${env.GITHUB_TOKEN}@`);
      }

      await sandbox.gitCheckout(cloneUrl, {
        ...(branch && { branch }),
        depth: 1,
        targetDir: 'repo'
      });

      // Detect project type
      const projectType = await detectProjectType(sandbox);

      // Install dependencies
      const installCmd = getInstallCommand(projectType);
      if (installCmd) {
        const installStream = await sandbox.execStream(`cd /workspace/repo && ${installCmd}`);
        for await (const event of parseSSEStream<ExecEvent>(installStream)) {
          if (event.type === 'complete' && event.exitCode !== 0) {
            return Response.json({ success: false, error: 'Install failed' });
          }
        }
      }

      // Run tests
      const testCmd = getTestCommand(projectType);
      const testStream = await sandbox.execStream(`cd /workspace/repo && ${testCmd}`);

      let testExitCode = 0;
      for await (const event of parseSSEStream<ExecEvent>(testStream)) {
        if (event.type === 'complete') {
          testExitCode = event.exitCode;
        }
      }

      return Response.json({
        success: testExitCode === 0,
        exitCode: testExitCode,
        projectType,
        message: testExitCode === 0 ? 'All tests passed' : 'Tests failed'
      });

    } finally {
      await sandbox.destroy();
    }
  },
};

async function detectProjectType(sandbox: any): Promise<string> {
  try {
    await sandbox.readFile('/workspace/repo/package.json');
    return 'nodejs';
  } catch {}
  try {
    await sandbox.readFile('/workspace/repo/requirements.txt');
    return 'python';
  } catch {}
  try {
    await sandbox.readFile('/workspace/repo/go.mod');
    return 'go';
  } catch {}
  return 'unknown';
}

function getInstallCommand(type: string): string {
  switch (type) {
    case 'nodejs': return 'npm install';
    case 'python': return 'pip install -r requirements.txt || pip install -e .';
    case 'go': return 'go mod download';
    default: return '';
  }
}

function getTestCommand(type: string): string {
  switch (type) {
    case 'nodejs': return 'npm test';
    case 'python': return 'python -m pytest || python -m unittest discover';
    case 'go': return 'go test ./...';
    default: return 'echo "Unknown project type"';
  }
}
```

### Test

```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/cloudflare/sandbox-sdk"}'
```

---

## Run Claude Code on Sandbox

Build a Worker that takes a repository URL and task description, then uses Claude Code to implement the task.

**Time:** 5 minutes

### Create from Template

```bash
npm create cloudflare@latest -- claude-code-sandbox --template=cloudflare/sandbox-sdk/examples/claude-code
cd claude-code-sandbox
```

### Configure

```bash
echo "ANTHROPIC_API_KEY=your_key" > .dev.vars
npm run dev
```

### Test

```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/owner/repo",
    "task": "Add unit tests for the utility functions"
  }'
```

---

## Data Persistence with R2

Build applications that persist data across sandbox lifecycles using R2 bucket mounting.

**Time:** 15 minutes

> **Note:** Bucket mounting requires production deployment. Does not work with `wrangler dev`.

### Prerequisites

- R2 bucket created in Cloudflare dashboard
- R2 API token with read/write permissions

### Setup R2 Credentials

```bash
# Get credentials from R2 dashboard
wrangler secret put AWS_ACCESS_KEY_ID
wrangler secret put AWS_SECRET_ACCESS_KEY
```

### Implementation

```typescript
import { getSandbox, type Sandbox } from '@cloudflare/sandbox';

export { Sandbox } from '@cloudflare/sandbox';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sandbox = getSandbox(env.Sandbox, 'data-processor');

    // Mount R2 bucket
    await sandbox.mountBucket('my-r2-bucket', '/data', {
      endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com'
    });

    // Read existing data
    try {
      const existing = await sandbox.readFile('/data/state.json');
      console.log('Existing state:', existing.content);
    } catch {
      console.log('No existing state');
    }

    // Process and save
    await sandbox.exec('python process.py');
    await sandbox.writeFile('/data/state.json', JSON.stringify({ updated: Date.now() }));

    return Response.json({ success: true });
  }
};
```

### Best Practices

- Mount at sandbox initialization
- Use read-only mounts when possible
- Copy frequently accessed files locally for performance
- Never hardcode credentials

---

## Code Review Bot

Build a bot that reviews code changes and provides AI-generated feedback.

**Time:** 20 minutes

### Implementation Pattern

```typescript
import { getSandbox, type Sandbox } from '@cloudflare/sandbox';
import Anthropic from '@anthropic-ai/sdk';

export { Sandbox } from '@cloudflare/sandbox';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { repoUrl, branch, baseBranch } = await request.json();

    const sandbox = getSandbox(env.Sandbox, `review-${Date.now()}`);

    try {
      // Clone and get diff
      await sandbox.gitCheckout(repoUrl, { branch, depth: 50, targetDir: 'repo' });
      const diff = await sandbox.exec(`cd /workspace/repo && git diff ${baseBranch}...${branch}`);

      // Get Claude to review
      const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const review = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `Review this code diff and provide constructive feedback:

${diff.stdout}

Focus on:
1. Code quality and best practices
2. Potential bugs or issues
3. Performance considerations
4. Security concerns`
        }]
      });

      return Response.json({
        success: true,
        feedback: review.content[0]?.text || ''
      });

    } finally {
      await sandbox.destroy();
    }
  }
};
```

### Test

```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/owner/repo",
    "branch": "feature-branch",
    "baseBranch": "main"
  }'
```
