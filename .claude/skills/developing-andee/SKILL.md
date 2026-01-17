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
- Customizing personality (CLAUDE.md, system prompt composition)
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

### Video & Photo Messages

Andee supports photo and video attachments via Telegram:

**Photos:**
1. Downloaded and base64-encoded by Grammy bot (`message:photo` handler)
2. Multi-photo albums buffered with 3-second delay (Telegram sends separately)
3. Analyzed by Gemini 3 Flash via OpenRouter (with high thinking mode)
4. Description injected as `<attached_media_context>` block for Claude

**Videos:**
1. Downloaded with 50MB limit by Grammy bot (`message:video` handler)
2. Analyzed by Gemini 3 Flash via OpenRouter (with high thinking mode)
3. Description injected as `<attached_media_context>` block for Claude

**Key implementation details:**
- `handlers/ask.ts:analyzeMediaWithGemini()` - Unified media analysis via OpenRouter
- Album buffering: `claude-telegram-bot/src/index.ts:flushChatPhotoBuffer()`
- Context format: `<attached_media_context>` with file path and detailed description
- Requires `OPENROUTER_API_KEY` secret in sandbox worker

**Log events:** Prefixed with `[MEDIA]` for media handling, `[IMAGE]` for photo processing.

### Testing Recurring Schedules

Recurring schedules enable Andee to send proactive, prompt-based messages at specified times.

**Key concepts:**
- Schedules are per-chat, stored as YAML in R2 (`schedules/{chatId}/recurring.yaml`)
- Managed via IDE (⏰ button) or API, not by Andee in chat
- Use cron expressions for timing, prompts for content generation
- `senderId: "system"` is used for automated messages (first-class sender type)

**Testing locally:**
```bash
# Create a test schedule
curl -X PUT "http://localhost:8787/schedule-config-yaml?chatId=999999999&botToken=$BOT_TOKEN" \
  -H "Content-Type: text/yaml" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d 'version: "1.0"
timezone: "America/New_York"
schedules:
  test:
    description: "Test schedule"
    cron: "0 6 * * *"
    enabled: true
    prompt: "Say hello!"'

# Run immediately to test
curl -X POST "http://localhost:8787/run-schedule-now" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"999999999","scheduleId":"test","botToken":"'$BOT_TOKEN'"}'
```

**Verifying execution:**
- Check logs for `[SCHEDULED] Executing schedule: {id}`
- Verify snapshot restore: `Restoring from snapshot: snapshots/{chatId}/{chatId}/...`
- Container receives prompt as `[SCHEDULED: {id}]\n{prompt}`

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
