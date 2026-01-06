---
name: implement-s
description: End-to-end feature implementation workflow for Andee. Use this when you want to implement a new feature with proper planning, testing, and documentation. Invoke with /implement-s <feature description>.
---

# Andee Feature Implementation Workflow

You are implementing a new feature for Andee, the Claude-powered Telegram bot. Follow this structured workflow to ensure nothing is missed.

## CRITICAL: Use the Todo List Tool

**You MUST use the `TodoWrite` tool throughout this entire workflow.**

### At the Start
Create a comprehensive todo list covering ALL phases before you begin coding:
```
- [ ] Phase 1: Clarify requirements
- [ ] Phase 1: Identify components
- [ ] Phase 1: Read relevant code
- [ ] Phase 2: Implement changes
- [ ] Phase 2: Type check before deploy
- [ ] Phase 3: Deploy to production
- [ ] Phase 3: Test feature
- [ ] Phase 3: Final type check
- [ ] Phase 4: Update documentation
```

### As You Work
- **Mark todos complete** immediately after finishing each task
- **Add new todos** as you discover additional work needed
- **Update todos** when requirements become clearer

### At Each Phase Transition
When you reach a new phase, **add detailed sub-todos** for that phase based on what you've learned. For example, entering Phase 2 you might add:
```
- [ ] Create recipes skill SKILL.md
- [ ] Add /recipes endpoint to worker
- [ ] Create recipes Mini App
```

The todo list keeps you organized and shows the user your progress. **Never skip this.**

## Your Task

Implement the feature described by the user. Use this workflow to plan, build, test, and document the feature properly.

## Context & Resources

Before starting, familiarize yourself with these resources:

| Resource | Location | Purpose |
|----------|----------|---------|
| **andee-dev skill** | `.claude/skills/andee-dev/SKILL.md` | How to add skills, Mini Apps, architecture guide |
| **andee-ops skill** | `.claude/skills/andee-ops/SKILL.md` | Deployment, debugging, curl commands |
| **CLAUDE.md** | `/Users/sam/projects/Andee/CLAUDE.md` | Project overview, commands, gotchas |
| **FUTURE_IDEAS.md** | `/Users/sam/projects/Andee/FUTURE_IDEAS.md` | Backlog of feature ideas |

### Current Andee Skills (for reference)

```
claude-sandbox-worker/.claude/skills/
├── weather/          → Weather reports with Mini App
└── [your new skill]  → What you're building
```

### Architecture Quick Reference

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Phone ──► Telegram ──► Grammy Bot ──► Sandbox Worker ──► Container     │
│                         (Worker)       (Worker+DO)        (Firecracker) │
│                                                                         │
│  Components you might modify:                                           │
│  • Skill (claude-sandbox-worker/.claude/skills/)  ← Most features       │
│  • Worker (claude-sandbox-worker/src/index.ts)    ← Storage/endpoints   │
│  • Bot (claude-telegram-bot/src/index.ts)         ← Telegram handling   │
│  • Mini App (apps/src/{app}/)                     ← Rich UI             │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation Checklist

Work through these steps in order. Mark each as you complete it.

### Phase 1: Understand & Plan

- [ ] **Clarify requirements** - Ask the user clarifying questions before coding
  - What exactly should this feature do?
  - What are the edge cases?
  - Any specific UX preferences?

- [ ] **Identify components** - What needs to change?
  - [ ] New skill? (`claude-sandbox-worker/.claude/skills/{name}/SKILL.md`)
  - [ ] Worker changes? (`claude-sandbox-worker/src/index.ts`)
  - [ ] Bot changes? (`claude-telegram-bot/src/index.ts`)
  - [ ] New Mini App? (`apps/src/{app}/index.html`)
  - [ ] Storage schema? (R2, Durable Objects SQL)

- [ ] **Read relevant code** - Understand existing patterns before writing new code

### Phase 2: Implement

- [ ] **Create/modify skill** - Most features only need a skill
  ```bash
  mkdir -p claude-sandbox-worker/.claude/skills/{skill-name}
  # Create SKILL.md with YAML frontmatter
  ```

- [ ] **Add storage if needed** - R2 for files, Durable Objects SQL for structured data

- [ ] **Create Mini App if needed** - For rich UI beyond text
  ```bash
  mkdir -p apps/src/{app-name}
  # Create index.html with Telegram WebApp SDK
  ```

- [ ] **Update worker/bot if needed** - Only for new endpoints or Telegram features

- [ ] **Type check before first deploy** - Fix any TypeScript errors before deploying
  ```bash
  # Check sandbox worker
  cd /Users/sam/projects/Andee/claude-sandbox-worker && npx tsc --noEmit

  # Check telegram bot
  cd /Users/sam/projects/Andee/claude-telegram-bot && npx tsc --noEmit
  ```
  Fix any errors before proceeding to deployment.

### Phase 3: Deploy & Test in Production

**Important:** All testing happens in production Cloudflare environment (R2, Durable Objects, etc. don't work locally).

```bash
# Deploy sandbox worker
cd /Users/sam/projects/Andee/claude-sandbox-worker
npx wrangler deploy

# Deploy telegram bot
cd /Users/sam/projects/Andee/claude-telegram-bot
npx wrangler deploy

# Deploy Mini Apps (if changed)
cd /Users/sam/projects/Andee/apps
npm run deploy
```

**Test via curl (production):**

```bash
# Health check
curl https://claude-sandbox-worker.samuel-hagman.workers.dev/

# Test your feature
curl -X POST https://claude-sandbox-worker.samuel-hagman.workers.dev/ask-telegram \
  -H "Content-Type: application/json" \
  -d '{"chatId":"test","message":"YOUR TEST MESSAGE","botToken":"fake","claudeSessionId":null}'

# Check logs
curl "https://claude-sandbox-worker.samuel-hagman.workers.dev/logs?chatId=test"

# Reset sandbox between tests
curl -X POST https://claude-sandbox-worker.samuel-hagman.workers.dev/reset \
  -H "Content-Type: application/json" \
  -d '{"chatId":"test"}'
```

- [ ] **Deploy all changed components**
- [ ] **Reset sandbox** - Clear state for clean test
- [ ] **Test feature via curl** - Verify it works
- [ ] **Test via Telegram** - Send real messages from phone
- [ ] **Tail logs if debugging** - Capture real-time worker logs
  ```bash
  timeout 30 npx wrangler tail --format pretty
  ```
  - Start tail FIRST, then send Telegram message (no history available)
  - Increase timeout if request takes longer than 30s
  - See `andee-dev` skill for detailed troubleshooting and debugging
- [ ] **Verify Mini App** - If applicable, button appears and opens correctly

- [ ] **Final type check** - Before declaring done, run type check one more time
  ```bash
  cd /Users/sam/projects/Andee/claude-sandbox-worker && npx tsc --noEmit
  cd /Users/sam/projects/Andee/claude-telegram-bot && npx tsc --noEmit
  ```
  Fix any errors that crept in during iteration.

### Phase 4: Document & Update Skills

Keep all documentation in sync with changes:

- [ ] **Update CLAUDE.md** - If architecture changed, new endpoints, or gotchas discovered

- [ ] **Update developer skills** - Any skills in `.claude/skills/` that need updating:
  - `.claude/skills/andee-dev/SKILL.md` - If you changed how features are built
  - `.claude/skills/andee-ops/SKILL.md` - If you changed deployment/debugging
  - `.claude/skills/implement-s/SKILL.md` - If this workflow needs updates
  - Other skills as relevant

- [ ] **Update FUTURE_IDEAS.md** - Note any follow-up improvements discovered

- [ ] **Summarize changes** - Tell the user what was implemented and how to use it

## Testing Reference (Production)

| Test | Command | Expected |
|------|---------|----------|
| Health check | `curl https://claude-sandbox-worker.samuel-hagman.workers.dev/` | `"ok"` |
| Feature test | `curl -X POST .../ask-telegram -d '...'` | Your feature works |
| Check logs | `curl ".../logs?chatId=test"` | No errors |
| Reset sandbox | `curl -X POST .../reset -d '{"chatId":"test"}'` | Clean state |

## When You're Done

1. Summarize what was built
2. Show example usage (what to say to Andee)
3. Note any limitations or future improvements
4. Ask if the user wants to test it together via Telegram

---

**Now, what feature would you like to implement?**

Read the user's feature description and begin with Phase 1: asking clarifying questions.
