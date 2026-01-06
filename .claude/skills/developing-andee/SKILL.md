---
name: developing-andee
description: Develops and debugs Andee bot features. Covers creating skills, building Mini Apps, Direct Link Mini Apps, container tools, log analysis, and troubleshooting. Use when adding features, creating skills, implementing Mini Apps, debugging issues, or analyzing logs. For deployment, use deploying-andee instead.
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
