# Development Workflow

## 1. PREP

Before coding, read these files to understand context and patterns:
- `/Users/sam/projects/Andee/CLAUDE.md` - Project overview, gotchas
- `.claude/skills/developing-andee/` - How to build features, debugging

## 2. MILESTONES

If the plan isn't broken into milestones, do it now:
- M1: [First checkable deliverable]
- M2: [Second checkable deliverable]
- M3: [etc.]

Add milestones to your TodoWrite list.

## 3. EXECUTE

For each milestone:
1. Break into sub-tasks (M1.1, M1.2, M1.3...)
2. Add sub-tasks to TodoWrite list
3. Complete each sub-task, marking complete as you go
4. When all sub-tasks done, mark milestone complete
5. Move to next milestone

**CONTINUE WITHOUT STOPPING** - Don't pause for user input unless genuinely blocked. Make reasonable assumptions.

## 4. SELF-TEST

Second-to-last step. YOU test, not the user:

1. **Deploy** - See `deploying-andee` skill for deployment commands
2. **Test** - See `developing-andee` skill (DEBUGGING.md) for:
   - curl commands to test endpoints
   - /logs endpoint to check agent logs
   - /diag endpoint for diagnostics
   - wrangler tail for real-time logs
3. **Debug** - Iterate until it works

**STICK TO THE PLAN** - The plan was approved. Don't simplify, don't regress, don't change direction. Debug and fix until the original plan works.

## 5. DOCUMENTATION

Last step only. Update:
- `CLAUDE.md` - if architecture/endpoints/gotchas changed
- `.claude/skills/*` - any skills that reference changed code
- `FUTURE_IDEAS.md` - mark implemented, add new ideas discovered
