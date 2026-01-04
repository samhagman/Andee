# Claude Agent SDK Research Report

> **Purpose**: Condensed reference for building a Telegram bot with Claude Agent SDK
> **Package**: `@anthropic-ai/claude-agent-sdk`
> **Docs**: https://platform.claude.com/docs/en/agent-sdk/overview

---

## Quick Start

```bash
# Install Claude Code runtime (required)
npm install -g @anthropic-ai/claude-code

# Install SDK
npm install @anthropic-ai/claude-agent-sdk

# Set API key
export ANTHROPIC_API_KEY=your-api-key
```

---

## Core API Pattern

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// Basic query (streaming async generator)
for await (const message of query({
  prompt: "What files are in this directory?",
  options: { allowedTools: ["Bash", "Glob"] }
})) {
  if ("result" in message) console.log(message.result);
}
```

---

## Key Options Interface

```typescript
interface Options {
  // TOOLS
  allowedTools?: string[];        // ["Read", "Bash", "WebSearch", etc.]
  disallowedTools?: string[];     // Block specific tools

  // SESSION MANAGEMENT (CRITICAL FOR MULTI-TURN)
  resume?: string;                // Session ID to resume
  forkSession?: boolean;          // Fork instead of continue (default: false)

  // PERMISSIONS
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  allowDangerouslySkipPermissions?: boolean;  // Required with bypassPermissions

  // EXECUTION
  cwd?: string;                   // Working directory
  env?: Record<string, string>;   // Environment variables
  maxTurns?: number;              // Max conversation turns
  maxBudgetUsd?: number;          // Cost limit

  // MODEL
  model?: string;                 // "claude-sonnet-4-5", etc.

  // SYSTEM PROMPT
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };

  // MCP SERVERS
  mcpServers?: Record<string, McpServerConfig>;

  // SUBAGENTS
  agents?: Record<string, AgentDefinition>;

  // HOOKS
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;

  // STREAMING
  includePartialMessages?: boolean;  // Include partial streaming events

  // ABORT
  abortController?: AbortController;
}
```

---

## Built-in Tools

| Tool | Description | Use Case |
|------|-------------|----------|
| `Read` | Read any file | File contents, images, PDFs |
| `Write` | Create new files | File creation |
| `Edit` | Precise string replacement | Code modifications |
| `Bash` | Terminal commands | Scripts, git, npm |
| `Glob` | Find files by pattern | `**/*.ts`, `src/**/*.py` |
| `Grep` | Search file contents | Regex search |
| `WebSearch` | Search the web | Current information |
| `WebFetch` | Fetch and parse URLs | Web content |
| `Task` | Spawn subagents | Parallel/specialized work |

---

## Message Types

```typescript
type SDKMessage =
  | SDKSystemMessage      // type: 'system', subtype: 'init' (contains session_id!)
  | SDKAssistantMessage   // type: 'assistant' (Claude's responses)
  | SDKUserMessage        // type: 'user'
  | SDKResultMessage      // type: 'result' (final output with .result string)
  | SDKPartialMessage;    // type: 'stream_event' (if includePartialMessages: true)

// Getting session_id from init message
if (message.type === 'system' && message.subtype === 'init') {
  sessionId = message.session_id;  // SAVE THIS FOR RESUME!
}

// Getting final result
if (message.type === 'result' && message.subtype === 'success') {
  finalOutput = message.result;    // String response
  cost = message.total_cost_usd;
}
```

---

## Session Management (CRITICAL FOR TELEGRAM BOT)

### Capture Session ID
```typescript
let sessionId: string | undefined;

for await (const message of query({
  prompt: "Hello",
  options: { allowedTools: ["Read"] }
})) {
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id;  // Save to database/R2!
  }
}
```

### Resume Session
```typescript
for await (const message of query({
  prompt: "Continue our conversation",
  options: {
    resume: sessionId,           // Previously captured session ID
    allowedTools: ["Read", "Edit"]
  }
})) {
  // Full context from previous conversation is maintained
}
```

### Fork Session (for "new conversation" commands)
```typescript
for await (const message of query({
  prompt: "Start fresh approach",
  options: {
    resume: sessionId,
    forkSession: true  // Creates new session ID from this point
  }
})) {
  // New branch, original session unchanged
}
```

---

## Permission Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `default` | Prompts for dangerous operations | Interactive CLI |
| `acceptEdits` | Auto-approve file edits | Semi-automated |
| `bypassPermissions` | Skip all permission checks | **REQUIRED FOR AUTOMATED BOTS** |
| `plan` | Planning only, no execution | Design phase |

**For Telegram Bot**:
```typescript
options: {
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,  // Required!
  allowedTools: ["Read", "Bash", "WebSearch"]  // Whitelist safe tools
}
```

---

## Subagents

```typescript
const response = query({
  prompt: "Use the researcher agent to find information",
  options: {
    allowedTools: ["Read", "Task"],  // Task enables subagents
    agents: {
      "researcher": {
        description: "Research specialist for web queries",
        prompt: "You are a research specialist. Find accurate information.",
        tools: ["WebSearch", "WebFetch"]
      }
    }
  }
});
```

---

## Hooks (Lifecycle Events)

```typescript
const logHook: HookCallback = async (input) => {
  console.log(`Tool used: ${input.tool_name}`);
  return {};
};

options: {
  hooks: {
    PostToolUse: [{ matcher: ".*", hooks: [logHook] }]
  }
}
```

Available hooks: `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`

---

## Result Message Structure

```typescript
interface SDKResultMessage {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd';
  session_id: string;
  result: string;           // Final text output
  total_cost_usd: number;   // Cost tracking
  duration_ms: number;
  num_turns: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
  };
}
```

---

## Error Handling

```typescript
try {
  for await (const message of query({ prompt, options })) {
    if (message.type === 'result') {
      if (message.subtype === 'success') {
        return message.result;
      } else {
        // Handle error subtypes
        console.error(message.errors);
      }
    }
  }
} catch (error) {
  if (error instanceof AbortError) {
    // Query was aborted
  }
}
```

---

## Telegram Bot Integration Pattern

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

async function handleTelegramMessage(
  userMessage: string,
  chatId: string,
  storedSessionId: string | null
): Promise<{ response: string; newSessionId: string }> {

  let sessionId = storedSessionId;
  let response = "";

  for await (const message of query({
    prompt: userMessage,
    options: {
      resume: sessionId || undefined,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      allowedTools: ["Read", "Bash", "WebSearch", "Glob", "Grep"],
      maxTurns: 10,
      maxBudgetUsd: 0.50
    }
  })) {
    // Capture session ID on first message
    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id;
    }

    // Capture final result
    if (message.type === 'result' && message.subtype === 'success') {
      response = message.result;
    }
  }

  return { response, newSessionId: sessionId! };
}
```

---

## Key Considerations for Cloudflare Sandbox

1. **Agent SDK requires Claude Code CLI runtime** - must be installed in container
2. **Session transcripts stored locally** - need persistence strategy
3. **bypassPermissions mode required** - no interactive prompts in automated context
4. **Tool whitelist recommended** - security in multi-tenant environment

---

## Quick Reference Links

- Overview: https://platform.claude.com/docs/en/agent-sdk/overview
- TypeScript Reference: https://platform.claude.com/docs/en/agent-sdk/typescript
- Sessions: https://platform.claude.com/docs/en/agent-sdk/sessions
- Hooks: https://platform.claude.com/docs/en/agent-sdk/hooks
- Permissions: https://platform.claude.com/docs/en/agent-sdk/permissions
- GitHub Examples: https://github.com/anthropics/claude-agent-sdk-demos
