# Andee Testing Plan

## Narrative & Goals

Andee currently has **zero test coverage** across all packages. This plan establishes a comprehensive testing strategy that enables:

1. **Confidence in deployments** - Catch regressions before they reach production
2. **Parallel development** - Multiple AI agents working in git worktrees simultaneously
3. **Fast iteration** - Quick feedback loops with unit tests, slower but thorough integration tests
4. **Production parity** - Tests run in actual Workers runtime (workerd), not Node.js simulation

### Why This Matters

The codebase has grown to 17+ HTTP endpoints, a Durable Object with SQLite, voice transcription, persistent container servers, and complex session isolation logic. Without tests:
- Authentication bypass bugs could expose the bot to unauthorized users
- Session isolation bugs could leak data between users
- Reminder delivery bugs could silently fail
- Snapshot/restore bugs could cause data loss

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  TESTING ARCHITECTURE                                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  LAYER 1: UNIT TESTS (Fast, No Workers Runtime)                         │   │
│  │  ────────────────────────────────────────────────────────────────────   │   │
│  │  • Pure functions in shared/lib/                                        │   │
│  │  • Session key generation, markdown escaping, chunking                  │   │
│  │  • Validation logic, data transformations                               │   │
│  │  • Run with: vitest run test/unit                                       │   │
│  │  • ~50ms per file                                                       │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  LAYER 2: INTEGRATION TESTS (Workers Runtime via pool-workers)          │   │
│  │  ────────────────────────────────────────────────────────────────────   │   │
│  │  • Handler tests with mocked external services                          │   │
│  │  • R2 operations (auto-mocked by Miniflare)                             │   │
│  │  • Durable Object tests with cloudflare:test APIs                       │   │
│  │  • Run with: vitest run test/integration                                │   │
│  │  • ~500ms per file                                                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  LAYER 3: E2E TESTS (Full Stack, Real Services)                         │   │
│  │  ────────────────────────────────────────────────────────────────────   │   │
│  │  • Bot → Worker → Container → Telegram (mocked)                         │   │
│  │  • Uses test user IDs (999999999) to skip real Telegram calls           │   │
│  │  • Run with: vitest run test/e2e                                        │   │
│  │  • ~5-10s per test                                                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Reasoning: Why This Approach

### Why Vitest + @cloudflare/vitest-pool-workers?

| Alternative | Problem |
|-------------|---------|
| Jest | No official Cloudflare support, runs in Node.js (behavior mismatches) |
| Miniflare 2 API | Deprecated, no DO SQLite support |
| Manual mocking | Tedious, doesn't test real Worker behavior |

**Vitest pool-workers** runs tests in the actual `workerd` runtime that powers production Workers. This eliminates the "works in tests, fails in prod" problem.

### Why Interface-Based Dependency Injection?

The current code directly calls external services:
```typescript
// Current: Hard to test
const result = await sandbox.exec("echo hello");
await env.SESSIONS.put(key, data);
await fetch("https://api.telegram.org/...");
```

With interfaces, we can swap implementations:
```typescript
// Testable: Can inject mocks
interface ISandboxService {
  exec(cmd: string): Promise<ExecResult>;
}

class MockSandboxService implements ISandboxService {
  async exec(cmd: string) {
    this.commands.push(cmd);
    return { stdout: "mocked", stderr: "" };
  }
}
```

### Why Dynamic Port Allocation?

Current state: Hardcoded ports cause conflicts:
- `wrangler.toml`: port 8787
- Multiple worktrees: all try to use 8787 → `EADDRINUSE`
- Parallel tests: race for ports

Solution: Use `get-port` + environment variables to assign ports dynamically per worktree/test run.

---

## Project Structure Changes

```
claude-sandbox-worker/
├── src/
│   ├── index.ts                    # Worker entry (thin layer)
│   ├── handlers/                   # Request handlers (existing)
│   │   ├── ask.ts
│   │   ├── reminder.ts
│   │   └── ...
│   ├── services/                   # NEW: Interface implementations
│   │   ├── interfaces/             # Abstract contracts
│   │   │   ├── storage.ts          # IStorageService
│   │   │   ├── telegram.ts         # ITelegramService
│   │   │   ├── sandbox.ts          # ISandboxService
│   │   │   └── index.ts
│   │   ├── storage.ts              # R2StorageService
│   │   ├── telegram.ts             # TelegramService
│   │   ├── sandbox.ts              # CloudflareSandboxService
│   │   └── index.ts                # Service factory
│   ├── lib/                        # NEW: Pure business logic
│   │   ├── session-keys.ts         # Key generation (moved from shared)
│   │   ├── validators.ts           # Request validation
│   │   └── transformers.ts         # Data transformations
│   └── scheduler/
│       └── SchedulerDO.ts
├── test/                           # NEW: Test directory
│   ├── unit/                       # Pure function tests
│   │   ├── session-keys.test.ts
│   │   ├── validators.test.ts
│   │   └── transformers.test.ts
│   ├── integration/                # Worker integration tests
│   │   ├── handlers/
│   │   │   ├── ask.test.ts
│   │   │   ├── reminder.test.ts
│   │   │   └── snapshot.test.ts
│   │   └── durable-objects/
│   │       └── scheduler.test.ts
│   ├── e2e/                        # Full stack tests
│   │   ├── message-flow.test.ts
│   │   └── reminder-delivery.test.ts
│   ├── mocks/                      # Test doubles
│   │   ├── sandbox.ts
│   │   ├── telegram.ts
│   │   └── fixtures.ts
│   ├── global-setup.ts             # Port allocation, server startup
│   ├── env.d.ts                    # Test environment types
│   └── tsconfig.json               # Test-specific TS config
├── vitest.config.ts                # Vitest configuration
├── vitest.workspace.ts             # Workspace for parallel runs
└── package.json
```

---

## Test Infrastructure Setup

### 1. Install Dependencies

```bash
cd claude-sandbox-worker
npm install -D vitest@~3.2.0 @cloudflare/vitest-pool-workers get-port vitest-mock-extended
```

### 2. Vitest Configuration

```typescript
// vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    globalSetup: "./test/global-setup.ts",

    // Test organization
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**"],  // E2E runs separately

    // Parallelism
    pool: "forks",
    fileParallelism: true,
    maxWorkers: process.env.CI ? 2 : 4,

    // Workers pool configuration
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            ANDEE_API_KEY: "test-api-key",
          },
        },
        // Isolated storage per test
        isolatedStorage: true,
      },
    },

    // Coverage
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/scripts/**", "src/**/*.d.ts"],
    },
  },
});
```

### 3. TypeScript Configuration for Tests

```json
// test/tsconfig.json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "types": ["@cloudflare/vitest-pool-workers", "vitest/globals"],
    "noEmit": true
  },
  "include": ["./**/*.ts", "../src/env.d.ts"]
}
```

### 4. Environment Type Declarations

```typescript
// test/env.d.ts
import type { Env } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    ANDEE_API_KEY: string;
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    workerPort: number;
    workerUrl: string;
  }
}
```

### 5. Global Setup (Port Allocation)

```typescript
// test/global-setup.ts
import type { TestProject } from "vitest/node";
import getPort from "get-port";

export default async function setup(project: TestProject) {
  // Find available port for this test run
  const workerPort = await getPort({ port: [8787, 8788, 8789, 8790] });

  // Provide to all tests via inject()
  project.provide("workerPort", workerPort);
  project.provide("workerUrl", `http://localhost:${workerPort}`);

  console.log(`[TEST SETUP] Allocated port ${workerPort}`);

  // No teardown needed - Vitest pool handles cleanup
  return async () => {
    console.log("[TEST TEARDOWN] Complete");
  };
}
```

---

## Mock Factory Patterns

### 1. Sandbox Service Mock

```typescript
// test/mocks/sandbox.ts
import type { ISandboxService, ExecResult, Container } from "../../src/services/interfaces/sandbox";

export class MockSandboxService implements ISandboxService {
  public commands: string[] = [];
  public files: Map<string, string> = new Map();
  public processes: Map<string, boolean> = new Map();

  // Configurable responses
  public execResponses: Map<string, ExecResult> = new Map();
  public shouldFailExec = false;

  async exec(cmd: string, options?: { timeout?: number }): Promise<ExecResult> {
    this.commands.push(cmd);

    if (this.shouldFailExec) {
      throw new Error("Sandbox exec failed");
    }

    // Return configured response or default
    return this.execResponses.get(cmd) ?? { stdout: "", stderr: "", exitCode: 0 };
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (!content) throw new Error(`File not found: ${path}`);
    return content;
  }

  async startProcess(cmd: string, options?: { env?: Record<string, string> }): Promise<void> {
    this.processes.set(cmd, true);
  }

  async listProcesses(): Promise<{ cmd: string }[]> {
    return Array.from(this.processes.keys()).map(cmd => ({ cmd }));
  }

  async waitForPort(port: number, timeout?: number): Promise<void> {
    // Instant success in tests
  }

  async destroy(): Promise<void> {
    this.processes.clear();
    this.files.clear();
  }

  // Test helpers
  reset() {
    this.commands = [];
    this.files.clear();
    this.processes.clear();
    this.execResponses.clear();
    this.shouldFailExec = false;
  }

  assertCommandExecuted(pattern: string | RegExp) {
    const found = this.commands.some(cmd =>
      typeof pattern === "string" ? cmd.includes(pattern) : pattern.test(cmd)
    );
    if (!found) {
      throw new Error(`Expected command matching ${pattern}, got: ${this.commands.join(", ")}`);
    }
  }
}
```

### 2. Telegram Service Mock

```typescript
// test/mocks/telegram.ts
import type { ITelegramService, SendMessageResult } from "../../src/services/interfaces/telegram";

export class MockTelegramService implements ITelegramService {
  public sentMessages: Array<{ chatId: string; text: string; parseMode?: string }> = [];
  public reactions: Array<{ chatId: string; messageId: number; emoji: string }> = [];
  public typingIndicators: string[] = [];

  public shouldFail = false;
  public failureMessage = "Telegram API error";

  async sendMessage(
    botToken: string,
    chatId: string,
    text: string,
    options?: { parseMode?: string; replyToMessageId?: number }
  ): Promise<SendMessageResult> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    this.sentMessages.push({ chatId, text, parseMode: options?.parseMode });
    return { ok: true, result: { message_id: Date.now() } };
  }

  async setReaction(
    botToken: string,
    chatId: string,
    messageId: number,
    emoji: string
  ): Promise<boolean> {
    if (this.shouldFail) return false;
    this.reactions.push({ chatId, messageId, emoji });
    return true;
  }

  async sendTypingIndicator(botToken: string, chatId: string): Promise<void> {
    this.typingIndicators.push(chatId);
  }

  // Test helpers
  reset() {
    this.sentMessages = [];
    this.reactions = [];
    this.typingIndicators = [];
    this.shouldFail = false;
  }

  getLastMessage(): { chatId: string; text: string } | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  assertMessageSentTo(chatId: string, textPattern?: string | RegExp) {
    const msg = this.sentMessages.find(m => m.chatId === chatId);
    if (!msg) {
      throw new Error(`No message sent to ${chatId}`);
    }
    if (textPattern) {
      const matches = typeof textPattern === "string"
        ? msg.text.includes(textPattern)
        : textPattern.test(msg.text);
      if (!matches) {
        throw new Error(`Message to ${chatId} didn't match ${textPattern}: ${msg.text}`);
      }
    }
  }
}
```

### 3. Test Fixtures

```typescript
// test/mocks/fixtures.ts
import { TEST_USER_1, TEST_USER_2, TEST_GROUP_CHAT } from "@andee/shared/constants";

export const fixtures = {
  // Valid requests
  askRequest: {
    chatId: TEST_USER_1,
    senderId: TEST_USER_1,
    isGroup: false,
    message: "Hello, Andee!",
    claudeSessionId: null,
    botToken: "test-bot-token",
    userMessageId: 123,
  },

  askVoiceRequest: {
    chatId: TEST_USER_1,
    senderId: TEST_USER_1,
    isGroup: false,
    audioBase64: "T2dnUw...", // Valid OGG header prefix
    audioDurationSeconds: 5,
    claudeSessionId: null,
    botToken: "test-bot-token",
    userMessageId: 124,
  },

  groupAskRequest: {
    chatId: TEST_GROUP_CHAT,
    senderId: TEST_USER_1,
    isGroup: true,
    message: "Hello from group!",
    claudeSessionId: null,
    botToken: "test-bot-token",
    userMessageId: 125,
  },

  reminderRequest: {
    senderId: TEST_USER_1,
    chatId: TEST_USER_1,
    isGroup: false,
    reminderId: "rem-test-123",
    triggerAt: Date.now() + 60000,
    message: "Test reminder",
    botToken: "test-bot-token",
  },

  resetRequest: {
    chatId: TEST_USER_1,
    senderId: TEST_USER_1,
    isGroup: false,
  },

  // Sessions
  existingSession: {
    claudeSessionId: "session-abc-123",
    messageCount: 5,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-09T12:00:00Z",
  },

  // Invalid requests (for negative tests)
  invalidRequests: {
    missingChatId: { message: "Hello" },
    missingSenderId: { chatId: "123", message: "Hello" },
    emptyMessage: { chatId: "123", senderId: "123", isGroup: false, message: "" },
  },
};
```

---

## Port Isolation Strategy

### Problem Statement

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  PORT CONFLICT SCENARIOS                                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  SCENARIO 1: Multiple Worktrees                                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                    │
│  │ ~/andee        │  │ ~/andee-feat-1 │  │ ~/andee-feat-2 │                    │
│  │ npm run dev    │  │ npm run dev    │  │ npm run dev    │                    │
│  │ PORT=8787 ✓    │  │ PORT=8787 ✗    │  │ PORT=8787 ✗    │                    │
│  │                │  │ EADDRINUSE!    │  │ EADDRINUSE!    │                    │
│  └────────────────┘  └────────────────┘  └────────────────┘                    │
│                                                                                 │
│  SCENARIO 2: Parallel Test Files                                                │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                    │
│  │ ask.test.ts    │  │ reset.test.ts  │  │ snap.test.ts   │                    │
│  │ port 3000?     │  │ port 3000?     │  │ port 3000?     │                    │
│  │ RACE!          │  │ RACE!          │  │ RACE!          │                    │
│  └────────────────┘  └────────────────┘  └────────────────┘                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Solution: Layered Port Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  PORT ALLOCATION STRATEGY                                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  LAYER 1: Development Servers (wrangler dev)                                    │
│  ────────────────────────────────────────────────────────────────────────────   │
│  Strategy: Environment variable with hash-based default                         │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  # scripts/dev.sh                                                       │   │
│  │  HASH=$(echo "$PWD" | md5 | cut -c1-4)                                  │   │
│  │  OFFSET=$((16#$HASH % 100))                                             │   │
│  │  PORT=${PORT:-$((8787 + OFFSET))}                                       │   │
│  │  wrangler dev --port $PORT                                              │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  LAYER 2: Test Servers (Vitest pool-workers)                                    │
│  ────────────────────────────────────────────────────────────────────────────   │
│  Strategy: Automatic isolation via Miniflare (no external ports needed)         │
│                                                                                 │
│  - Pool-workers runs inside workerd, not external HTTP                          │
│  - Each test file gets isolated storage automatically                           │
│  - No port conflicts between test files                                         │
│                                                                                 │
│  LAYER 3: E2E Tests (Full wrangler dev)                                         │
│  ────────────────────────────────────────────────────────────────────────────   │
│  Strategy: get-port in globalSetup, passed via provide/inject                   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  // test/global-setup.ts                                                │   │
│  │  const port = await getPort({ port: 8787 });                            │   │
│  │  project.provide("workerPort", port);                                   │   │
│  │  // Start wrangler dev on that port                                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  LAYER 4: Container Internal Ports                                              │
│  ────────────────────────────────────────────────────────────────────────────   │
│  Fixed ports OK: 8080 (server), 8081 (ttyd) - container is isolated            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Worktree Setup Script

```bash
#!/bin/bash
# scripts/setup-worktree.sh
# Usage: ./scripts/setup-worktree.sh feature/my-feature

BRANCH=$1
WORKTREE_NAME=$(echo "$BRANCH" | sed 's/\//-/g')
WORKTREE_PATH="../andee-$WORKTREE_NAME"

# Create worktree
git worktree add -b "$BRANCH" "$WORKTREE_PATH" main

# Generate unique port based on path hash
HASH=$(echo "$WORKTREE_PATH" | md5 | cut -c1-4)
OFFSET=$((16#$HASH % 100))
PORT=$((8787 + OFFSET))

# Create .dev.vars with unique port
cat > "$WORKTREE_PATH/claude-sandbox-worker/.dev.vars" << EOF
PORT=$PORT
ANDEE_API_KEY=adk_dev_$(openssl rand -hex 8)
EOF

echo "Created worktree at $WORKTREE_PATH"
echo "Development port: $PORT"
echo "Run: cd $WORKTREE_PATH/claude-sandbox-worker && npm run dev"
```

---

## Test Coverage Plan

### Unit Tests (shared/ and src/lib/)

| Module | Functions to Test | Priority |
|--------|-------------------|----------|
| `session-keys.ts` | `getSessionKey()`, `getSnapshotKey()`, `getSnapshotPrefix()` | HIGH |
| `validators.ts` | Request validation for all endpoints | HIGH |
| `markdown.ts` | `escapeMarkdownV2()` | MEDIUM |
| `chunker.ts` | `chunkTextForTelegram()`, `willNeedChunking()` | MEDIUM |
| `transformers.ts` | Data shape transformations | LOW |

**Example Unit Test:**

```typescript
// test/unit/session-keys.test.ts
import { describe, it, expect } from "vitest";
import { getSessionKey, getSnapshotKey } from "../../src/lib/session-keys";

describe("getSessionKey", () => {
  it("generates correct key for private chat", () => {
    const key = getSessionKey("123456", "123456", false);
    expect(key).toBe("sessions/123456/123456.json");
  });

  it("generates correct key for group chat", () => {
    const key = getSessionKey("-100555666", "123456", true);
    expect(key).toBe("sessions/groups/-100555666.json");
  });

  it("throws if senderId is undefined", () => {
    expect(() => getSessionKey("123", undefined, false))
      .toThrow("getSessionKey requires senderId and isGroup");
  });

  it("throws if isGroup is undefined", () => {
    expect(() => getSessionKey("123", "456", undefined))
      .toThrow("getSessionKey requires senderId and isGroup");
  });
});

describe("getSnapshotKey", () => {
  it("includes timestamp in key", () => {
    const key = getSnapshotKey("123", "123", false, "2025-01-09T12-00-00-000Z");
    expect(key).toBe("snapshots/123/123/2025-01-09T12-00-00-000Z.tar.gz");
  });

  it("generates timestamp if not provided", () => {
    const key = getSnapshotKey("123", "123", false);
    expect(key).toMatch(/^snapshots\/123\/123\/\d{4}-\d{2}-\d{2}T.*\.tar\.gz$/);
  });
});
```

### Integration Tests (Handlers)

| Handler | Test Cases | Priority |
|---------|------------|----------|
| `handleAsk` | Valid text message, voice message, missing fields, auth failure | HIGH |
| `handleReset` | Creates snapshot before reset, deletes session, destroys sandbox | HIGH |
| `handleScheduleReminder` | Creates reminder in DO, sets alarm | HIGH |
| `handleSnapshotCreate` | Creates tarball, uploads to R2 | MEDIUM |
| `handleSnapshotsList` | Lists from R2, sorts by date | MEDIUM |
| `handleSessionUpdate` | Updates R2 correctly | MEDIUM |

**Example Integration Test:**

```typescript
// test/integration/handlers/ask.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env, fetchMock, SELF } from "cloudflare:test";
import { fixtures } from "../../mocks/fixtures";

describe("POST /ask", () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.assertNoPendingInterceptors();
  });

  it("returns 401 without API key", async () => {
    const response = await SELF.fetch("http://example.com/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fixtures.askRequest),
    });

    expect(response.status).toBe(401);
  });

  it("returns 200 and starts processing for valid request", async () => {
    // Mock Telegram typing indicator
    fetchMock
      .get("https://api.telegram.org")
      .intercept({ path: /sendChatAction/, method: "POST" })
      .reply(200, { ok: true });

    const response = await SELF.fetch("http://example.com/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "test-api-key",
      },
      body: JSON.stringify(fixtures.askRequest),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.started).toBe(true);
  });

  it("transcribes audio for voice messages", async () => {
    // Mock Whisper API (Workers AI)
    // Note: Workers AI is accessed via env.AI.run(), may need different mock approach

    const response = await SELF.fetch("http://example.com/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "test-api-key",
      },
      body: JSON.stringify(fixtures.askVoiceRequest),
    });

    expect(response.status).toBe(200);
    // Verify transcription was called (via mock assertions)
  });
});
```

### Durable Object Tests (SchedulerDO)

```typescript
// test/integration/durable-objects/scheduler.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { fixtures } from "../../mocks/fixtures";

describe("SchedulerDO", () => {
  it("stores reminder in SQLite", async () => {
    const id = env.Scheduler.idFromName("user-999999999");
    const stub = env.Scheduler.get(id);

    // Schedule reminder via RPC
    await stub.schedule(fixtures.reminderRequest);

    // Verify SQLite storage
    await runInDurableObject(stub, async (instance, state) => {
      const rows = state.storage.sql
        .exec("SELECT * FROM reminders WHERE id = ?", fixtures.reminderRequest.reminderId)
        .toArray();

      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe("Test reminder");
      expect(rows[0].status).toBe("pending");
    });
  });

  it("sets alarm for trigger time", async () => {
    const id = env.Scheduler.idFromName("alarm-test");
    const stub = env.Scheduler.get(id);

    const triggerAt = Date.now() + 60000;
    await stub.schedule({ ...fixtures.reminderRequest, triggerAt });

    await runInDurableObject(stub, async (instance, state) => {
      const alarm = await state.storage.getAlarm();
      expect(alarm).toBeDefined();
      expect(alarm).toBeCloseTo(triggerAt, -2); // Within 100ms
    });
  });

  it("delivers reminder when alarm fires", async () => {
    const id = env.Scheduler.idFromName("delivery-test");
    const stub = env.Scheduler.get(id);

    // Schedule reminder for "now"
    await stub.schedule({
      ...fixtures.reminderRequest,
      triggerAt: Date.now() - 1000, // In the past
    });

    // Trigger alarm immediately
    const alarmRan = await runDurableObjectAlarm(stub);
    expect(alarmRan).toBe(true);

    // Verify status changed
    await runInDurableObject(stub, async (instance, state) => {
      const rows = state.storage.sql
        .exec("SELECT status FROM reminders WHERE id = ?", fixtures.reminderRequest.reminderId)
        .toArray();

      expect(rows[0].status).toBe("completed");
    });
  });

  it("cancels reminder", async () => {
    const id = env.Scheduler.idFromName("cancel-test");
    const stub = env.Scheduler.get(id);

    await stub.schedule(fixtures.reminderRequest);
    await stub.cancel(fixtures.reminderRequest.reminderId);

    await runInDurableObject(stub, async (instance, state) => {
      const rows = state.storage.sql
        .exec("SELECT status FROM reminders WHERE id = ?", fixtures.reminderRequest.reminderId)
        .toArray();

      expect(rows[0].status).toBe("cancelled");
    });
  });

  it("lists reminders by status", async () => {
    const id = env.Scheduler.idFromName("list-test");
    const stub = env.Scheduler.get(id);

    // Create multiple reminders
    await stub.schedule({ ...fixtures.reminderRequest, reminderId: "rem-1" });
    await stub.schedule({ ...fixtures.reminderRequest, reminderId: "rem-2" });
    await stub.cancel("rem-1");

    const pending = await stub.list("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("rem-2");

    const cancelled = await stub.list("cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].id).toBe("rem-1");
  });
});
```

### E2E Tests (Full Flow)

Only 2 critical flows to test end-to-end:

```typescript
// test/e2e/message-flow.test.ts
import { describe, it, expect, inject, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";

describe("E2E: Message Flow", () => {
  let wranglerProcess: ChildProcess;
  let workerUrl: string;

  beforeAll(async () => {
    const port = inject("workerPort");
    workerUrl = `http://localhost:${port}`;

    // Start actual wrangler dev
    wranglerProcess = spawn("wrangler", ["dev", "--port", String(port)], {
      cwd: process.cwd(),
      stdio: "pipe",
    });

    // Wait for ready
    await new Promise<void>((resolve) => {
      wranglerProcess.stdout?.on("data", (data) => {
        if (data.toString().includes("Ready")) resolve();
      });
    });
  }, 60000);

  afterAll(() => {
    wranglerProcess?.kill();
  });

  it("processes text message and returns success", async () => {
    const response = await fetch(`${workerUrl}/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.ANDEE_API_KEY || "test-key",
      },
      body: JSON.stringify({
        chatId: "999999999",
        senderId: "999999999",
        isGroup: false,
        message: "Hello from E2E test!",
        claudeSessionId: null,
        botToken: "test-token",
        userMessageId: Date.now(),
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.started).toBe(true);
    expect(data.chatId).toBe("999999999");
  });
});
```

```typescript
// test/e2e/reminder-delivery.test.ts
import { describe, it, expect, inject, beforeAll, afterAll } from "vitest";

describe("E2E: Reminder Delivery", () => {
  // Similar setup...

  it("schedules and delivers reminder", async () => {
    const workerUrl = inject("workerUrl");
    const reminderId = `e2e-${Date.now()}`;

    // Schedule reminder for 2 seconds from now
    const scheduleResponse = await fetch(`${workerUrl}/schedule-reminder`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.ANDEE_API_KEY || "test-key",
      },
      body: JSON.stringify({
        senderId: "999999999",
        chatId: "999999999",
        isGroup: false,
        reminderId,
        triggerAt: Date.now() + 2000,
        message: "E2E test reminder",
        botToken: "test-token",
      }),
    });

    expect(scheduleResponse.status).toBe(200);

    // Wait for delivery (alarm should fire)
    await new Promise((r) => setTimeout(r, 3000));

    // Check reminder status
    const listResponse = await fetch(
      `${workerUrl}/reminders?senderId=999999999&status=completed`,
      {
        headers: { "X-API-Key": process.env.ANDEE_API_KEY || "test-key" },
      }
    );

    const reminders = await listResponse.json();
    const delivered = reminders.find((r: any) => r.id === reminderId);
    expect(delivered).toBeDefined();
    expect(delivered.status).toBe("completed");
  }, 10000);
});
```

---

## CI Configuration

```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci
        working-directory: claude-sandbox-worker

      - name: Run unit tests
        run: npm run test:unit
        working-directory: claude-sandbox-worker

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-unit
          path: claude-sandbox-worker/coverage/

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci
        working-directory: claude-sandbox-worker

      - name: Run integration tests
        run: npm run test:integration
        working-directory: claude-sandbox-worker
        env:
          ANDEE_API_KEY: test-api-key

  e2e-tests:
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci
        working-directory: claude-sandbox-worker

      - name: Build Docker image
        run: docker build -t andee-sandbox .
        working-directory: claude-sandbox-worker

      - name: Run E2E tests
        run: npm run test:e2e
        working-directory: claude-sandbox-worker
        env:
          ANDEE_API_KEY: ${{ secrets.ANDEE_API_KEY }}
          BOT_TOKEN: ${{ secrets.BOT_TOKEN }}
```

---

## Package.json Scripts

```json
{
  "scripts": {
    "dev": "node scripts/dev.js",
    "test": "vitest",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "test:e2e": "vitest run test/e2e --config vitest.e2e.config.ts",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest run --coverage",
    "test:ci": "vitest run --reporter=junit --outputFile=test-results.xml"
  }
}
```

---

## Implementation Phases

### Phase 1: Test Infrastructure (Day 1)
- [ ] Install Vitest + pool-workers + get-port
- [ ] Create vitest.config.ts
- [ ] Create test/tsconfig.json and test/env.d.ts
- [ ] Create test/global-setup.ts with port allocation
- [ ] Add npm scripts for test commands

### Phase 2: Mock Factories (Day 1-2)
- [ ] Create ISandboxService interface
- [ ] Create ITelegramService interface
- [ ] Create MockSandboxService
- [ ] Create MockTelegramService
- [ ] Create test fixtures

### Phase 3: Unit Tests (Day 2)
- [ ] Extract pure functions to src/lib/
- [ ] Test session key generation
- [ ] Test markdown escaping
- [ ] Test text chunking
- [ ] Test request validation

### Phase 4: Integration Tests (Day 3-4)
- [ ] Test handleAsk with mocked sandbox/telegram
- [ ] Test handleReset flow
- [ ] Test SchedulerDO with SQLite
- [ ] Test snapshot operations with R2

### Phase 5: E2E Tests (Day 5)
- [ ] Create E2E vitest config
- [ ] Test full message flow
- [ ] Test reminder delivery flow

### Phase 6: CI Pipeline (Day 5)
- [ ] Create GitHub Actions workflow
- [ ] Configure test sharding
- [ ] Set up coverage reporting

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Sandbox SDK has no test mocks | Use interface abstraction + mock implementation |
| R2 doesn't work locally | Miniflare auto-simulates R2 in pool-workers |
| Container scripts hard to test | Focus on handler tests; container scripts are integration-tested via E2E |
| DO alarms timing | Use `runDurableObjectAlarm()` to trigger immediately |
| Port conflicts in CI | `get-port` finds available ports; CI has isolated network |

---

## Success Criteria

- [ ] Unit test coverage > 80% for shared/ and src/lib/
- [ ] All handlers have at least happy-path integration tests
- [ ] SchedulerDO has full test coverage for CRUD + alarm
- [ ] E2E tests pass in CI without flakiness
- [ ] Tests complete in < 2 minutes in CI
- [ ] No port conflicts when running multiple worktrees

---

Plan link: /Users/sam/projects/Andee/claude-sandbox-worker/TESTING_PLAN.md
