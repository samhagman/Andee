---
name: deploying-andee
description: Deploys and configures Andee on Cloudflare Workers. Covers wrangler commands, secrets, webhooks, container instance types, and R2 setup. Use when deploying to production, setting secrets, configuring webhooks, or changing container sizes. For building features or debugging runtime issues, use developing-andee instead.
---

# Andee Deployment Guide

> For building features or debugging, see `developing-andee` skill.

## What's Covered

- **Deploy Workers** - wrangler commands for sandbox-worker and telegram-bot
- **Deploy Mini Apps** - Cloudflare Pages deployment for Telegram Web Apps
- **Manage Secrets** - .prod.env, API keys, user allowlists
- **Telegram Webhook** - set-webhook.mjs script usage
- **Container Config** - instance types (lite to standard-4), sleepAfter lifecycle
- **R2 Storage** - bucket setup, storage structure, snapshot lifecycle
- **Service Bindings** - how telegram-bot connects to sandbox-worker
- **Workers AI** - Whisper binding for voice message transcription
- **Troubleshooting** - common deployment issues and fixes

## Workers AI Configuration

Voice message transcription requires Workers AI (Whisper model):

**wrangler.toml** (sandbox-worker):
```toml
[ai]
binding = "AI"
```

**Env interface** (src/types.ts):
```typescript
AI: Ai; // Workers AI for speech-to-text
```

**Cost**: ~$0.0005 per audio minute (whisper-large-v3-turbo)

Workers AI is automatically available in Cloudflare Workers - no additional setup needed beyond the binding.

## Full Reference

For complete deployment guide: [guides/full-reference.md](guides/full-reference.md)
