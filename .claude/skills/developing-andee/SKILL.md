---
name: developing-andee
description: Develops and debugs Andee bot features. Covers creating Andee bot skills, building Mini Apps, Direct Link Mini Apps, container tools, log analysis, and troubleshooting. Use when adding features, creating skills, implementing Mini Apps, debugging issues, or analyzing logs. For deployment, use deploying-andee instead.
---

# Andee Development

This skill provides guides for building and debugging Andee features.

## Guides

### Building Features

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for:
- Creating skills (SKILL.md format, naming rules, rebuild container)
- Direct Link Mini Apps (format, data passing, shell architecture)
- Mini Apps (architecture, creating, deploying)
- Available container tools (Read, Write, Bash, WebFetch, etc.)
- File locations inside container
- Customizing personality (PERSONALITY.md, system prompt composition)
- Development workflow (terminals, local dev)
- Skill pattern examples

### Troubleshooting & Debugging

See [DEBUGGING.md](DEBUGGING.md) for:
- Real-time log tailing (wrangler tail)
- Agent logs (/logs endpoint, log event reference)
- Diagnostics (/diag endpoint)
- Resetting sandboxes (/reset)
- R2 session management
- Testing endpoints directly
- Common issues & solutions
- Performance timing analysis

### Voice Messages

Andee supports voice message input via Telegram. Voice notes are:
1. Downloaded and base64-encoded by Grammy bot (`message:voice` handler)
2. Transcribed using Workers AI Whisper (~900ms latency)
3. Processed by Claude like normal text

See `handlers/ask.ts:transcribeAudio()` for implementation. Log events are prefixed with `[VOICE]`.

### Testing Timezone

Timezone preferences persist across container restarts via snapshots:

1. **Set timezone**: Send "My timezone is America/New_York" to test user
2. **Verify file**: Check `/home/claude/private/{senderId}/preferences.yaml` exists
3. **Reset container**: `curl -X POST .../reset` to force cold start
4. **Check logs**: Look for `[Worker] User {id} timezone: America/New_York` in wrangler tail

**Mid-session changes**: TZ env var only applies on cold start. Changing timezone mid-session updates preferences.yaml but won't affect the running container until restart.

### Test Users

Use dedicated test user IDs for development/testing to avoid polluting real user data:

| ID | Constant | Description |
|----|----------|-------------|
| `999999999` | TEST_USER_1 | Primary testing (nine 9s) |
| `888888888` | TEST_USER_2 | Multi-user isolation (nine 8s) |

These are already in ALLOWED_USER_IDS in production. They're treated exactly like real users - same code paths, same storage patterns.

> **Note:** telegram-bot skips Telegram API calls for test users. See [DEBUGGING.md](DEBUGGING.md) for expected log patterns.

### Production Testing: Always Test the Full Flow

When testing features in production, **always test through the actual user path** (Telegram), not just direct API calls.

**Why?** Service bindings between workers use internal URLs that differ from public URLs:

| Test Method | Request URL | Catches Service Binding Bugs? |
|-------------|-------------|-------------------------------|
| Direct curl to sandbox worker | `https://claude-sandbox-worker.../ask` | No |
| Webhook to bot worker | `https://claude-telegram-bot.../` | Maybe |
| **Actual Telegram message** | Full flow: Telegram → Grammy → Service Binding → Sandbox | Yes |

**Test checklist for production:**
1. Test via **real Telegram message** (not just curl)
2. If feature involves callbacks to worker (like reminder scheduling), verify the full round-trip
3. Check container logs for URL-related errors (exit code 6 = DNS failure)

**Example bug this catches:** If code derives `workerUrl` from `ctx.request.url`, it works when curling directly but fails via service binding (which uses `https://internal/...`).

### Development Workflow

See [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) for the `/implement-s` command workflow:
- Milestone-based implementation
- TodoWrite tracking
- Self-testing (you test, not user)
- Documentation updates

### Mini Apps Development

See [guides/mini-apps.md](guides/mini-apps.md) for the complete Mini Apps development guide:
- Vite + TypeScript architecture
- Direct Link format and shell router
- Shared library (telegram.ts, base64url, data extraction)
- Step-by-step component creation
- Testing and deployment commands

### Deployment

Use the `deploying-andee` skill for:
- Deploying to Cloudflare (wrangler deploy)
- Setting secrets (ANTHROPIC_API_KEY, BOT_TOKEN)
- Configuring webhooks
- Container instance types
- R2 bucket configuration
