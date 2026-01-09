---
name: cloudflare-sandbox-sdk
description: Reference documentation for Cloudflare Sandbox SDK. Use when working with sandbox containers, executing code in isolation, managing files/processes, exposing services, or configuring the worker deployment.
---

# Cloudflare Sandbox SDK

Run untrusted code securely in isolated containers from Workers.

## What's Covered

- **Getting Started** - project setup, local dev, deployment
- **Core API** - exec, startProcess, writeFile, readFile, exposePort
- **Concepts** - sandbox lifecycle, sessions, preview URLs, security
- **Configuration** - wrangler.toml, Dockerfile, environment variables
- **Guides** - common patterns and how-tos
- **Andee Patterns** - persistent server pattern with port 8080

## Key Gotchas

- Port 3000 is reserved by Sandbox infra - use 8080
- Use `startProcess()` for servers, `exec()` for one-off commands
- Pass env vars via `{ env: {...} }` option, not inline in command

## Documentation

| Topic | File |
|-------|------|
| Setup & deployment | [getting-started.md](getting-started.md) |
| Complete API | [api.md](api.md) |
| Architecture | [concepts.md](concepts.md) |
| How-to guides | [guides.md](guides.md) |
| Wrangler config | [configuration.md](configuration.md) |
