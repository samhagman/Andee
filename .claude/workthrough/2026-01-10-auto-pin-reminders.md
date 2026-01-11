# Auto-Pin Reminder Messages

## Overview
When Andee delivers a reminder, the message is now automatically pinned to the Telegram chat. This keeps important reminders visible at the top of the conversation, making them harder to miss.

## Context
- **Problem/Requirement**: Users could miss reminder messages if they scrolled past them or didn't check Telegram immediately
- **Initial State**: SchedulerDO sent reminder via `sendMessage` but discarded the response (no `message_id` captured)
- **Approach**: Capture `message_id` from successful send, then call `pinChatMessage` API with silent notification

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Always on vs preference | Always on | Simpler, pinning is almost always desirable for reminders |
| Failure handling | Notify once per chat | Helpful without being naggy |
| Scope | Private + groups | Pin everywhere, fail silently where not allowed |
| Pin notification | Silent (`disable_notification: true`) | Avoid spamming "Bot pinned a message" |

## Changes Made

### 1. SQLite Schema Extension
- **Description**: Added table to track which chats have been notified about pin failures
- **Files Modified**:
  - `claude-sandbox-worker/src/scheduler/SchedulerDO.ts` - Added `pin_notifications` table
- **Key Points**:
  - Prevents repeated "make me admin" tips (only notifies once per chat)
  - Simple schema: `chat_id TEXT PRIMARY KEY, notified_at INTEGER`

### 2. Pin Helper Methods
- **Description**: Added two new private methods to SchedulerDO
- **Files Modified**:
  - `claude-sandbox-worker/src/scheduler/SchedulerDO.ts`
- **Methods**:
  - `pinMessage(botToken, chatId, messageId)` - Attempts to pin, returns boolean
  - `notifyPinFailure(botToken, chatId)` - Sends one-time tip if not already notified

### 3. Modified Reminder Delivery
- **Description**: Enhanced `sendReminderToTelegram()` to capture message_id and attempt pinning
- **Files Modified**:
  - `claude-sandbox-worker/src/scheduler/SchedulerDO.ts`
- **Key Points**:
  - Parses `message_id` from successful sendMessage response
  - Calls `pinMessage()` after successful send
  - If pin fails, calls `notifyPinFailure()` to send one-time tip
  - Pinning failure doesn't affect reminder completion status

### 4. Test Updates
- **Description**: Added fetchMock for pinChatMessage API and new test case
- **Files Modified**:
  - `claude-sandbox-worker/test/integration/durable-objects/scheduler.test.ts`
- **Key Points**:
  - Mock returns `{ ok: true, result: true }` for pin success
  - Test verifies reminder completes and pin code path executes

## Code Examples

### Pin Message Helper
```typescript
// claude-sandbox-worker/src/scheduler/SchedulerDO.ts
private async pinMessage(
  botToken: string,
  chatId: string,
  messageId: number
): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/pinChatMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        disable_notification: true, // Silent pin
      }),
    });
    return response.ok;
  } catch (error) {
    console.log(`[SchedulerDO] Error pinning message: ${error}`);
    return false;
  }
}
```

### Reminder Delivery with Pinning
```typescript
// After successful sendMessage
if (messageId) {
  const pinned = await this.pinMessage(
    reminder.botToken,
    reminder.chatId,
    messageId
  );
  if (!pinned) {
    await this.notifyPinFailure(reminder.botToken, reminder.chatId);
  }
}
```

## Testing

### Integration Tests
```bash
cd claude-sandbox-worker && npm run test -- --run test/integration/durable-objects/scheduler.test.ts
```

All 15 tests pass, including new pin-specific test case.

### Production Verification
Tested with real Telegram chat (ID: 7821047187). Logs confirmed:
```
[SchedulerDO] Pinned message 228 in chat 7821047187
[SchedulerDO] Sent reminder e7dccdbe-dfd3-4f0b-af94-fe9b0c515fc0: drink water
```

User confirmed reminder appeared pinned in Telegram.

## Documentation Updated
- `CLAUDE.md` - Reminder system diagram updated with auto-pin mention
- `claude-sandbox-worker/.claude/skills/reminders/SKILL.md` - Added notes about auto-pin behavior
- `.claude/skills/developing-andee/DEBUGGING.md` - Added SchedulerDO log event patterns

## Log Patterns

| Log | Meaning |
|-----|---------|
| `[SchedulerDO] Pinned message X in chat Y` | Successful pin |
| `[SchedulerDO] Failed to pin message X in chat Y` | Pin failed (bot not admin) |
| `[SchedulerDO] Sent pin failure notification to chat Y` | One-time tip sent |

## Telegram API Reference

### pinChatMessage
```
POST https://api.telegram.org/bot{token}/pinChatMessage
{
  "chat_id": "123456789",
  "message_id": 42,
  "disable_notification": true
}
```

**Permissions:**
- Private chats: Works without special permissions
- Groups/supergroups: Bot needs `can_pin_messages` admin right
