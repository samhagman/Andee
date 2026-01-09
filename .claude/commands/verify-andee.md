---
description: Deep verification of Andee components with live testing and comprehensive research report
---

# Andee Verification Workflow

You are conducting a deep verification of an Andee component. This is a thorough investigation that includes code analysis, live testing, and a comprehensive report.

**Component to verify:** $ARGUMENTS

---

## Reference Skills

Use these skills for context on how Andee works:

@.claude/skills/developing-andee/SKILL.md
@.claude/skills/deploying-andee/SKILL.md
@CLAUDE.md

---

## Test Users

Dedicated test user IDs for verification. These are treated **exactly like real users** - same code paths, same storage. Use them to avoid polluting real user data.

| ID | Constant | Description |
|----|----------|-------------|
| `999999999` | TEST_USER_1 | Primary testing (nine 9s) |
| `888888888` | TEST_USER_2 | Multi-user isolation (nine 8s) |

**Important:** These are in ALLOWED_USER_IDS in production. Never use real user IDs (7821047187, 7580981566) for automated testing.

**Transformer Behavior:** The telegram-bot skips Telegram API calls for test users. Look for `[TEST] Skipping {method}` in logs instead of GrammyError.

---

## CRITICAL: Use the Todo List Tool

**You MUST use the `TodoWrite` tool throughout this entire workflow.**

At the start, create a todo list covering ALL phases:
```
- [ ] Phase 1: Explore & understand the component
- [ ] Phase 2: Deep code analysis
- [ ] Phase 3: Live testing (create plan, execute, verify)
- [ ] Phase 4: Run /review for additional analysis
- [ ] Phase 5: Write verification report to /research/
```

Mark todos complete as you finish each phase. Add sub-todos as you learn more.

---

## Phase 1: Explore & Understand

**Goal:** Build a complete mental model of how the component works.

1. Use the **Task tool with Explore agent** to find ALL relevant files for this component
2. Identify:
   - Key source files
   - Data flows and dependencies
   - Related endpoints and handlers
   - Configuration files
3. Create a list of all files you need to analyze in Phase 2

**Do not proceed until you have a comprehensive understanding of what files are involved.**

---

## Phase 2: Deep Code Analysis

**Goal:** Thoroughly understand the implementation and identify potential issues.

1. **Read all relevant source files** - Don't skim, read thoroughly
2. **Trace data flows** with specific line numbers:
   - Where does data enter the system?
   - How is it transformed?
   - Where is it stored?
   - How is it retrieved?
3. **Document key functions** and their behavior
4. **Identify potential issues:**
   - Race conditions
   - Edge cases
   - Error handling gaps
   - Security concerns
   - Data consistency issues
5. **Note assumptions and concerns** for testing

**Output:** A clear understanding of how the component works and a list of things to verify.

---

## Phase 3: Live Testing (SPEND SIGNIFICANT TIME HERE)

**Goal:** Verify the component works correctly through end-to-end testing.

### Step 1: Create a Testing Plan

Before running any tests, figure out:
- What endpoints/functionality need testing?
- What curl commands will you run?
- What intermediate state should you check?
- What logs should you inspect?
- What edge cases need testing?
- What error scenarios should you trigger?

### Step 2: Execute the Testing Plan

Run your tests step by step:
1. Start any required services
2. Execute test commands
3. **Check logs after each step** - Don't just look at responses
4. **Verify intermediate state** - R2 storage, container state, database records
5. **Confirm expected behavior** - Does it match what the code analysis predicted?

### Step 3: Test Edge Cases and Error Scenarios

Don't just test the happy path:
- What happens with invalid input?
- What happens with missing data?
- What happens with concurrent requests?
- What happens when services are unavailable?

### Step 4: Document Everything

For each test:
- The exact command you ran
- The full response
- Relevant log excerpts
- What you verified
- Pass/Fail status

**This phase should take significant time. Be thorough.**

---

## Phase 4: Code Review

**Goal:** Get additional analysis from the /review command.

Use a Task subagent to run the `/review` command:

```
Launch a Task with prompt:
"Run /review on the following component: [YOUR COMPONENT]
Focus on: [KEY AREAS FROM YOUR ANALYSIS]
Return the review findings."
```

Use this review report as another source of information for your final report.

---

## Phase 5: Write Verification Report

**Goal:** Create a comprehensive verification report synthesizing all findings.

### File Location

Save to: `/Users/sam/projects/Andee/research/{TOPIC}_VERIFICATION.md`

Use a descriptive name based on the component (e.g., `SESSION_STORAGE_VERIFICATION.md`, `WEBHOOK_HANDLING_VERIFICATION.md`).

### Report Template

```markdown
# {Component} Verification Report

**Date:** {Today's date}
**Scope:** {Brief description of what was verified}
**Status:** {VERIFIED / ISSUES FOUND / NEEDS ATTENTION}

---

## Executive Summary

{1-2 paragraph summary of key findings}

### Key Findings

| Component | Status | Notes |
|-----------|--------|-------|
| {Item 1} | **WORKING** / **ISSUE** | {Brief description} |
| {Item 2} | **WORKING** / **ISSUE** | {Brief description} |
| ... | ... | ... |

### Issues Identified

| Severity | Issue | Status |
|----------|-------|--------|
| HIGH / MEDIUM / LOW | {Issue description} | Unpatched / Mitigated |
| ... | ... | ... |

---

## Architecture Overview

{ASCII diagram showing the component architecture}

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  {COMPONENT NAME}                                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  {Diagram showing data flow, key files, interactions}                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Code Analysis

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `{path/to/file.ts}` | {relevant lines} | {Purpose} |
| ... | ... | ... |

### Data Flow

{Detailed description of how data flows through the system}

### Key Functions

{Description of important functions with line references}

---

## Live Test Results

### Test Environment

- **Host:** {localhost:8787 / production URL}
- **Date:** {Test date}

### Tests Executed

| Test | Command | Result | Notes |
|------|---------|--------|-------|
| {Test name} | `curl ...` | PASS / FAIL | {Brief notes} |
| ... | ... | ... | ... |

### Detailed Test Output

#### Test 1: {Name}

**Command:**
```bash
{exact curl command}
```

**Response:**
```json
{response}
```

**Logs:**
```
{relevant log excerpts}
```

**Verification:** {What was verified and how}

{Repeat for each significant test}

---

## Issues & Vulnerabilities

### {Issue 1 Name}

**Severity:** HIGH / MEDIUM / LOW

**File:** `{path/to/file.ts}:{line numbers}`

**Problem:** {Description of the issue}

**Code:**
```typescript
{relevant code snippet}
```

**Impact:** {What could go wrong}

**Recommended Fix:**
```typescript
{proposed fix}
```

**Complexity:** Low / Medium / High

{Repeat for each issue}

---

## Recommendations

### Priority Ranking

1. **{Fix 1}** - {Effort level}, {Impact description}
2. **{Fix 2}** - {Effort level}, {Impact description}
3. ...

---

## Conclusion

### What Works Well

1. {Thing that works well}
2. {Another thing}
3. ...

### What Needs Attention

1. {Thing that needs work}
2. {Another thing}
3. ...

### Overall Assessment

{Final paragraph summarizing the verification results and recommendations}

---

*Report generated: {Date}*
*Verification method: Code analysis + live testing + /review*
```

---

## When You're Done

1. Ensure all todos are marked complete
2. Verify the report is saved to `/research/`
3. Summarize the key findings for the user
4. Offer to discuss any issues found or implement fixes

---

**Now begin Phase 1: Explore & Understand the component specified above.**
