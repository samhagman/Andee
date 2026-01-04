# Andee

Telegram bot powered by Claude Code Agent SDK. Message Claude from your phone with full conversation persistence and tool access.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PHASE 2 ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Phone ──► Telegram ──► Grammy Bot ──► Sandbox Worker ──► Docker        │
│                         (localhost)    (localhost:8787)   Container     │
│                              │                               │          │
│                              │         HTTP POST /ask        │          │
│                              └───────────────────────────────┘          │
│                                                                         │
│  Inside Docker Container:                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  User: claude (non-root)                                        │   │
│  │  /workspace/agent.mjs ──► Agent SDK ──► Claude CLI ──► Claude   │   │
│  │  /workspace/files/    (isolated workspace)                      │   │
│  │  ~/.claude/           (session transcripts)                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Done | Local bot with direct Agent SDK (TAD_1.md) |
| 2 | ✅ Done | Sandbox isolation via Docker (TAD_2.md) |
| 3 | Planned | Production deployment to Cloudflare |

## Project Structure

```
Andee/
├── claude-telegram-bot/    # Grammy bot + Claude handler
├── claude-sandbox-worker/  # Sandbox orchestration worker
├── TAD_*.md                # Technical Architecture Documents
└── *_RESEARCH_REPORT.md    # Component research
```

## Running Phase 2

```bash
# Terminal 1: Sandbox worker (first run builds Docker ~2-3 min)
cd claude-sandbox-worker && npm run dev

# Terminal 2: Bot
cd claude-telegram-bot && npm run start
```

---

## Development Workflow & Debugging

### Testing Without Telegram

Test the sandbox worker directly with curl (faster iteration):

```bash
# Health check
curl http://localhost:8787/

# Test ask endpoint
curl -X POST http://localhost:8787/ask \
  -H "Content-Type: application/json" \
  -d '{"chatId":"test123","message":"Say hello","claudeSessionId":null}'

# Reset sandbox
curl -X POST http://localhost:8787/reset \
  -H "Content-Type: application/json" \
  -d '{"chatId":"test123"}'
```

### Diagnostic Endpoint

The worker has a `/diag` endpoint for debugging container issues:

```bash
curl http://localhost:8787/diag | jq .
```

---

## Critical Learnings (Gotchas)

### 1. Claude Code Refuses Root User

**Problem**: Claude Code CLI refuses `--dangerously-skip-permissions` when running as root for security.

**Error**: `--dangerously-skip-permissions cannot be used with root/sudo privileges`

**Solution**: Create a non-root user in the Dockerfile:
```dockerfile
RUN useradd -m -s /bin/bash claude
RUN mkdir -p /home/claude/.claude && chown -R claude:claude /home/claude/.claude
USER claude
```

### 2. Global NPM Modules Not Found in ESM

**Problem**: Globally installed npm packages (`npm install -g`) aren't found by Node.js ESM imports.

**Error**: `Cannot find package '@anthropic-ai/claude-agent-sdk'`

**Solution**: Symlink global node_modules to the script's directory:
```dockerfile
RUN ln -s /usr/local/lib/node_modules /workspace/node_modules
```

### 3. Wrangler 4.x Containers Config

**Problem**: Wrangler 4.x has different config format for containers.

**Solution**: Use array format with `image` field:
```toml
[[containers]]
class_name = "Sandbox"
image = "./Dockerfile"
```

### 4. Sandbox Requires SQLite Migrations

**Problem**: Cloudflare Sandbox SDK uses SQLite-backed Durable Objects.

**Error**: `SQL is not enabled for this Durable Object class`

**Solution**: Use `new_sqlite_classes` in migrations:
```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["Sandbox"]
```

### 5. HOME Environment Variable

**Problem**: Claude needs HOME set correctly to find its config directory.

**Solution**: Set HOME when executing in container:
```typescript
await sandbox.exec(
  `HOME=/home/claude ANTHROPIC_API_KEY=${key} node /workspace/agent.mjs`
);
```

---

## Dockerfile Reference

```dockerfile
FROM docker.io/cloudflare/sandbox:0.6.7

# Install Claude Code and Agent SDK
RUN npm install -g @anthropic-ai/claude-code
RUN npm install -g @anthropic-ai/claude-agent-sdk

# CRITICAL: Non-root user (Claude refuses root)
RUN useradd -m -s /bin/bash claude
RUN mkdir -p /workspace/files && chown -R claude:claude /workspace

# CRITICAL: Symlink for ESM imports
RUN ln -s /usr/local/lib/node_modules /workspace/node_modules

# Setup .claude directory
RUN mkdir -p /home/claude/.claude && chown -R claude:claude /home/claude/.claude

USER claude
WORKDIR /workspace/files
```

## wrangler.toml Reference

```toml
name = "claude-sandbox-worker"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[durable_objects]
bindings = [
  { name = "Sandbox", class_name = "Sandbox" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Sandbox"]

[[containers]]
class_name = "Sandbox"
image = "./Dockerfile"
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `Claude Code process exited with code 1` | Running as root | Add non-root user to Dockerfile |
| `Cannot find package '@anthropic-ai/...'` | Missing symlink | Add `ln -s` for node_modules |
| `SQL is not enabled` | Wrong migrations | Use `new_sqlite_classes` |
| `containers field should be array` | Old wrangler config | Use `[[containers]]` format |
| Container not starting | Docker not running | Start Docker Desktop |
