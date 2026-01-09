# Timezone Sync: Container Time Synced to User's Local Timezone

## Overview

Implemented automatic timezone synchronization for Andee's sandbox containers. When users set reminders like "at 3pm", the container now uses their local timezone instead of UTC. Preferences are stored in the container filesystem and persist across restarts via snapshots.

## Context

- **Problem/Requirement**: Users setting reminders with absolute times (e.g., "remind me at 3pm") were getting incorrect trigger times because the container used UTC. A user in New York saying "3pm" would get a reminder at 3pm UTC (10am New York time).
- **Initial State**: Container always started with UTC timezone. No mechanism to store or read user timezone preferences.
- **Approach**: Store timezone in a preferences file inside the container, read it on cold start, and set the TZ environment variable when starting the persistent server.

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  TIMEZONE SYNC FLOW                                                             │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  FIRST TIME USER:                                                               │
│  User: "Remind me at 3pm"                                                       │
│       │                                                                         │
│       ▼                                                                         │
│  Claude: Checks /home/claude/private/{senderId}/preferences.yaml                │
│       │                                                                         │
│       └── NOT FOUND → Asks: "What timezone are you in?"                         │
│                │                                                                │
│                ▼                                                                │
│           User: "New York"                                                      │
│                │                                                                │
│                ▼                                                                │
│           Claude: Creates preferences.yaml with timezone: America/New_York      │
│                   Uses TZ=America/New_York for date calculations                │
│                                                                                 │
│  RETURNING USER (after container restart):                                      │
│  Message arrives → ask.ts handles                                               │
│       │                                                                         │
│       ▼                                                                         │
│  Restore from snapshot (preferences.yaml included)                              │
│       │                                                                         │
│       ▼                                                                         │
│  Read preferences.yaml → timezone: America/New_York                             │
│       │                                                                         │
│       ▼                                                                         │
│  Start server: TZ=America/New_York node persistent_server.mjs                   │
│       │                                                                         │
│       ▼                                                                         │
│  All date commands use correct local time automatically                         │
│                                                                                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Changes Made

### 1. Worker Handler - Timezone Reading on Cold Start

- **Description**: Added timezone reading logic after snapshot restore, before server startup
- **Files Modified**:
  - `claude-sandbox-worker/src/handlers/ask.ts` - Added timezone reading and TZ env var
- **Key Points**:
  - Reads `/home/claude/private/{senderId}/preferences.yaml` after snapshot restore
  - Parses `timezone:` field from YAML
  - Passes TZ environment variable to `startProcess()` call
  - Defaults to UTC if no preferences file exists

### 2. Reminders Skill - Timezone Awareness

- **Description**: Updated skill instructions to check for timezone before setting reminders
- **Files Modified**:
  - `claude-sandbox-worker/.claude/skills/reminders/SKILL.md` - Added timezone check instructions
- **Key Points**:
  - Claude should check preferences.yaml for timezone before absolute time reminders
  - If no timezone, ask user
  - Create preferences file with user's response
  - Use explicit `TZ=xxx` prefix in date commands for mid-session changes

### 3. New User Preferences Skill

- **Description**: Created new skill to handle /timezone command and preference management
- **Files Created**:
  - `claude-sandbox-worker/.claude/skills/user-preferences/SKILL.md`
- **Key Points**:
  - Handles /timezone command
  - Natural language parsing ("I'm in Boston" → America/New_York)
  - CRUD operations for preferences.yaml
  - Common timezone mappings table

## Code Examples

### Timezone Reading in ask.ts

```typescript
// claude-sandbox-worker/src/handlers/ask.ts (lines 152-168)

// Read user timezone from preferences (if they exist)
let userTimezone = "UTC";
if (senderId) {
  const prefsPath = `/home/claude/private/${senderId}/preferences.yaml`;
  const prefsResult = await sandbox.exec(
    `cat ${prefsPath} 2>/dev/null || echo ""`,
    { timeout: QUICK_COMMAND_TIMEOUT_MS }
  );

  if (prefsResult.stdout.includes("timezone:")) {
    const match = prefsResult.stdout.match(/timezone:\s*([^\n]+)/);
    if (match) {
      userTimezone = match[1].trim();
      console.log(`[Worker] User ${senderId} timezone: ${userTimezone}`);
    }
  }
}

// Start server with TZ env var (lines 181-191)
const server = await sandbox.startProcess(
  "node /workspace/persistent_server.mjs",
  {
    env: {
      ANTHROPIC_API_KEY: ctx.env.ANTHROPIC_API_KEY,
      HOME: "/home/claude",
      TZ: userTimezone,  // <-- NEW
    },
  }
);
```

### Preferences File Format

```yaml
# /home/claude/private/{senderId}/preferences.yaml
timezone: America/New_York
```

## Verification Results

### Build & Deployment

```bash
> cd claude-sandbox-worker && npm run deploy

Uploaded claude-sandbox-worker (2.62 sec)
Building image claude-sandbox-worker-sandbox:c7909efd
...
SUCCESS  Modified application claude-sandbox-worker-sandbox
Deployed claude-sandbox-worker triggers (7.22 sec)
```

### Production Testing

```bash
# Test 1: Set timezone
User: "My timezone is America/New_York. Please save it to my preferences."
Result: preferences.yaml created (27 bytes)

# Test 2: Change timezone
User: "Change my timezone to America/Los_Angeles"
Result: preferences.yaml updated (27 → 30 bytes)

# Test 3: Container restart
> curl -X POST .../reset -d '{"chatId":"999999999",...}'
{"success":true,"snapshotKey":"snapshots/.../2026-01-09T03-34-40-949Z.tar.gz"}

# Test 4: Cold start verification
User: "What time is it?"
Worker Log: "[Worker] User 999999999 timezone: America/Los_Angeles"
Result: Server started with TZ=America/Los_Angeles
```

### Manual Testing Checklist

- [x] Timezone preferences file created correctly
- [x] Timezone preferences file updated on change
- [x] Preferences survive container restart (via snapshot)
- [x] Worker reads timezone on cold start
- [x] TZ env var passed to server process
- [x] Log message shows timezone being read

## Issues Encountered & Solutions

### Issue 1: Claude Not Proactively Asking for Timezone

**Observation**: When user first asks "remind me at 3pm", Claude didn't consistently ask for timezone as instructed in the skill.

**Root Cause**: Skill instructions are guidance, not enforced behavior. Claude's response depends on how it interprets the context.

**Workaround**: Users can explicitly set timezone via natural language ("set my timezone to New York") which works reliably.

### Issue 2: /timezone Command Empty Response

**Observation**: Sending "/timezone America/Los_Angeles" resulted in 0 character response.

**Root Cause**: Claude may not be loading the user-preferences skill for slash commands, or treating it as a command rather than a message.

**Workaround**: Natural language requests work: "Change my timezone to Los Angeles"

### Issue 3: Mid-Session TZ Change

**Challenge**: TZ env var is set at process start. Changing timezone mid-session doesn't update the running server's TZ.

**Solution**:
1. Claude updates the preferences.yaml file
2. For the current session, Claude uses explicit `TZ=xxx` prefix in date commands
3. On next container restart, TZ will be set correctly from preferences

## Next Steps

- [ ] Consider adding timezone to the context.json file for Claude to read directly
- [ ] Improve skill instructions for more consistent proactive timezone prompts
- [ ] Add Mini App auto-detection (JavaScript `Intl.DateTimeFormat()`) as future enhancement
- [ ] Consider /timezone inline keyboard for easy selection

## Notes

- The TZ env var is a convenience for default `date` output; the preferences file is the authoritative source
- Test users (999999999) skip Telegram API calls, so responses aren't visible in chat
- Timezone mappings in the skill are incomplete; Claude uses knowledge for unlisted cities
- Group chats use the message sender's timezone preference (senderId), not a shared chat preference

## References

- Plan file: `/Users/sam/.claude/plans/merry-snacking-meerkat.md`
- Sandbox SDK docs: `claude-sandbox-worker/.claude/skills/cloudflare-sandbox-sdk/SKILL.md`
- IANA timezone database: https://www.iana.org/time-zones
