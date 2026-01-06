---
name: deploying-andee
description: Deploys and configures Andee on Cloudflare Workers. Covers wrangler commands, secrets, webhooks, container instance types, and R2 setup. Use when deploying to production, setting secrets, configuring webhooks, or changing container sizes. For building features or debugging runtime issues, use developing-andee instead.
---

# Andee Deployment Guide

> For building features or debugging issues, see the `developing-andee` skill.

## Contents

- [Deploy Workers](#deploy-workers)
- [Deploy Mini Apps](#deploy-mini-apps)
- [Set Secrets](#set-secrets)
- [Configure Telegram Webhook](#configure-telegram-webhook)
- [Container Instance Types](#container-instance-types)
- [R2 Bucket Configuration](#r2-bucket-configuration)
- [Service Bindings](#service-bindings)
- [Deployment Troubleshooting](#deployment-troubleshooting)
- [Key Code Locations](#key-code-locations)

---

## Deploy Workers

### Deploy Both Workers

```bash
# Deploy sandbox worker (processes messages, runs Claude)
cd /Users/sam/projects/Andee/claude-sandbox-worker
npx wrangler deploy

# Deploy telegram bot (includes secrets from .prod.env)
cd /Users/sam/projects/Andee/claude-telegram-bot
npm run deploy           # Secrets + code
# OR
npm run deploy-code      # Code only (skip secrets)
npm run deploy-secrets   # Secrets only (no code deploy)
```

### Verify Deployment

```bash
# Check sandbox worker health
curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/"

# Check telegram bot health
curl -s "https://claude-telegram-bot.samuel-hagman.workers.dev/"
```

---

## Deploy Mini Apps

Mini Apps are deployed to Cloudflare Pages (separate from Workers).

### Deploy

```bash
cd /Users/sam/projects/Andee/apps
npm run deploy       # Build + deploy to Cloudflare Pages
```

This runs `vite build` then `wrangler pages deploy dist --project-name=andee`.

### Other Commands

```bash
npm run dev          # Local dev server (port 8788)
npm run build        # Build only (no deploy)
npm run typecheck    # TypeScript validation
npm run preview      # Preview built files locally
```

### Verify Deployment

```bash
# Check shell loads
curl -s "https://andee-7rd.pages.dev/app/" | head -5

# Check weather component loads
curl -s "https://andee-7rd.pages.dev/weather/" | head -5

# Check JS assets load (should return 200)
curl -sI "https://andee-7rd.pages.dev/assets/" | head -1
```

### Adding New Components

After adding a new component (see `developing-andee` skill for guide):

1. Add entry to `apps/vite.config.ts`
2. Run `npm run typecheck` to verify
3. Run `npm run deploy`

---

## Set Secrets

### Telegram Bot Secrets

The telegram bot uses `.prod.env` for production secrets (auto-deployed):

```bash
# Edit production secrets
vim /Users/sam/projects/Andee/claude-telegram-bot/.prod.env
```

**.prod.env format:**
```bash
BOT_TOKEN=your_bot_token
ANDEE_API_KEY=adk_your_key
ALLOWED_USER_IDS=123456,789012   # Comma-separated Telegram user IDs
```

**Deploy secrets:**
```bash
cd /Users/sam/projects/Andee/claude-telegram-bot
npm run deploy-secrets   # Upload secrets to Cloudflare
```

### Adding a New User

1. Get their Telegram ID (from bot logs: `[AUTH] User xxx (ID: yyy)` or via @userinfobot)
2. Edit `.prod.env`: add ID to `ALLOWED_USER_IDS=existing_ids,new_id`
3. Run `npm run deploy-secrets`

### Sandbox Worker Secrets

The sandbox worker still uses manual secret setting:

```bash
cd /Users/sam/projects/Andee/claude-sandbox-worker
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ANDEE_API_KEY
```

### Generate API Key

```bash
openssl rand -hex 16 | sed 's/^/adk_/'
```

**Note:** `ANDEE_API_KEY` must match between both workers.

---

## Configure Telegram Webhook

### Set Webhook

```bash
cd /Users/sam/projects/Andee/claude-telegram-bot
node scripts/set-webhook.mjs
```

### Verify Webhook

```bash
# Check webhook status via Telegram API
curl "https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo"
```

---

## Container Instance Types

Configure in `claude-sandbox-worker/wrangler.toml`:

```toml
[[containers]]
class_name = "Sandbox"
image = "./Dockerfile"
instance_type = "standard-4"  # Options below
```

| Type | vCPU | Memory | Disk | Use Case |
|------|------|--------|------|----------|
| lite | 1/16 | 256 MiB | 2 GB | Testing only (very slow) |
| basic | 1/4 | 1 GiB | 4 GB | Light usage |
| standard-1 | 1/2 | 4 GiB | 8 GB | Normal usage |
| standard-2 | 1 | 6 GiB | 12 GB | Better performance |
| standard-3 | 2 | 8 GiB | 16 GB | Heavy usage |
| standard-4 | 4 | 12 GiB | 20 GB | Maximum performance |

**Important:** After changing instance_type, you must reset user sandboxes for them to use the new instance type.

### Container Lifecycle

Configure sleep behavior in code:

```typescript
const sandbox = await this.env.SANDBOX.get(sandboxId, { sleepAfter: "1h" });
```

- `sleepAfter: "1h"` - Container stays alive for 1 hour of inactivity
- After sleeping, next message triggers fresh cold start (~7s)
- During active period, messages use warm container (~3.5s)

---

## R2 Bucket Configuration

### Bucket Setup

Three R2 buckets are used. Configured in `wrangler.toml`:

```toml
# Session storage (shared with telegram bot)
[[r2_buckets]]
binding = "SESSIONS"
bucket_name = "andee-sessions"

# Filesystem snapshots (backup/restore workspace)
[[r2_buckets]]
binding = "SNAPSHOTS"
bucket_name = "andee-snapshots"

# Transcripts (optional, not actively used)
[[r2_buckets]]
binding = "TRANSCRIPTS"
bucket_name = "andee-transcripts"
```

### Create Buckets (if needed)

```bash
cd claude-sandbox-worker
npx wrangler r2 bucket create andee-sessions
npx wrangler r2 bucket create andee-snapshots
npx wrangler r2 bucket create andee-transcripts
```

### Storage Structure

```
andee-sessions/
└── sessions/
    └── {chatId}.json           # Claude sessionId, messageCount

andee-snapshots/
└── snapshots/
    └── {chatId}/
        └── {timestamp}.tar.gz  # Filesystem backups (/workspace + /home/claude)
```

### Snapshot Lifecycle

- **Auto-snapshot**: 55 minutes after last activity (before container sleeps)
- **Pre-reset snapshot**: Automatically created when /reset is called
- **Manual snapshot**: Via /snapshot Telegram command or POST /snapshot endpoint
- **Restore**: Happens automatically when a fresh container starts for a chatId that has snapshots

---

## Service Bindings

The telegram bot connects to sandbox worker via service binding.

### telegram-bot wrangler.toml

```toml
[[services]]
binding = "SANDBOX"
service = "claude-sandbox-worker"
```

### Usage in Code

```typescript
// In telegram bot worker
const response = await env.SANDBOX.fetch(
  new Request("https://sandbox/ask", {
    method: "POST",
    body: JSON.stringify({ chatId, message, botToken, userMessageId })
  })
);
```

---

## Deployment Troubleshooting

### Issue: "Runtime signalled the container to exit due to a new version rollout"

**Cause:** User sent message during deployment. Container was killed for version update.

**Solution:** Transient issue - just retry. Message sent after deployment completes will work.

### Issue: Service binding not working

**Cause:** Sandbox worker not deployed or service name mismatch.

**Solution:**
1. Deploy sandbox worker first: `cd claude-sandbox-worker && npx wrangler deploy`
2. Verify service name matches in telegram-bot's `wrangler.toml`
3. Redeploy telegram bot

### Issue: Secrets not available

**Cause:** Secrets set locally but not pushed to Cloudflare.

**Solution:** Use `npx wrangler secret put` (not `.dev.vars` for production).

### Issue: R2 bucket not accessible

**Cause:** Bucket not created or binding name mismatch.

**Solution:**
```bash
# Create bucket if needed
npx wrangler r2 bucket create andee-sessions

# Verify binding name matches wrangler.toml
```

### Issue: Webhook not receiving messages

**Cause:** Webhook URL incorrect or bot token invalid.

**Solution:**
1. Re-run `node scripts/set-webhook.mjs`
2. Verify BOT_TOKEN secret is set correctly
3. Check `getWebhookInfo` response for errors

---

## Key Code Locations

Key code locations in `claude-sandbox-worker/src/index.ts`:
- `PERSISTENT_SERVER_SCRIPT` - HTTP server with streaming input mode
- `/ask` endpoint - Uses `startProcess()` + `waitForPort(8080)`
- `getSandbox(..., { sleepAfter: "1h" })` - Container lifecycle config

Key config files:
- `claude-sandbox-worker/wrangler.toml` - Container config, R2 bindings, instance type
- `claude-telegram-bot/wrangler.toml` - Service binding to sandbox worker
- `claude-sandbox-worker/Dockerfile` - Container image with Claude CLI + SDK
