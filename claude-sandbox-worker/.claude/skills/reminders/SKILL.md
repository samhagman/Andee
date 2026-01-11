---
name: reminders
description: Set, list, and cancel reminders. Use when user says "remind me", "set a reminder", "what reminders do I have", or "cancel reminder".
---

# Reminders

## Important Behaviors

- **Short reminders are fully supported** - Users can set reminders for 10 seconds, 1 minute, or any duration
- **There is NO minimum time** - The system accepts any future time, no matter how soon
- **Never refuse a reminder as "too short"** - If the user wants a 30-second reminder, set it
- **Trust the user's judgment** - They know why they need a quick reminder (timer for cooking, quick check-in, etc.)

## Getting Context

The sender ID is available in the context file. Read it first:

```bash
SENDER_ID=$(jq -r .senderId /tmp/protected/telegram_context/context.json)
```

## CRITICAL: Check Timezone First

Before setting any reminder with an absolute time (e.g., "at 3pm", "tomorrow at 9am"):

1. **Get sender ID and check timezone preference:**
```bash
SENDER_ID=$(jq -r .senderId /tmp/protected/telegram_context/context.json)
cat /home/claude/private/$SENDER_ID/preferences.yaml 2>/dev/null | grep timezone
```

2. **If NO timezone found, ASK the user:**
   > "What timezone are you in? (e.g., 'New York', 'EST', 'America/Los_Angeles')"

3. **Create the preferences file with their response:**
```bash
SENDER_ID=$(jq -r .senderId /tmp/protected/telegram_context/context.json)
mkdir -p /home/claude/private/$SENDER_ID
cat > /home/claude/private/$SENDER_ID/preferences.yaml << 'EOF'
timezone: America/New_York
EOF
```

4. **For this session, use explicit TZ when calling date:**
```bash
TZ=America/New_York set-reminder "Call mom" "at 3pm"
```

**Common timezone mappings:**
- "New York", "EST", "Eastern" → America/New_York
- "Los Angeles", "PST", "Pacific" → America/Los_Angeles
- "Chicago", "CST", "Central" → America/Chicago
- "London", "GMT", "UK" → Europe/London
- "Tokyo", "JST", "Japan" → Asia/Tokyo

## Set a Reminder

```bash
# Very short reminders (fully supported!)
set-reminder "Check the oven" "in 30 seconds"
set-reminder "Flip the pancakes" "in 1 minute"
set-reminder "Stir the pasta" "in 2 minutes"

# Standard relative times
set-reminder "Take a break" "in 15 minutes"
set-reminder "Call mom" "in 30 minutes"
set-reminder "Check laundry" "in 1 hour"
set-reminder "Follow up on email" "in 2 hours"
set-reminder "Water the plants" "in 3 days"

# Absolute times (12-hour format)
set-reminder "Take medication" "at 3pm"
set-reminder "Morning standup" "at 9:30am"
set-reminder "Lunch break" "at 12pm"

# Absolute times (24-hour format)
set-reminder "Team sync" "at 15:00"
set-reminder "Dinner prep" "at 18:30"

# Future dates
set-reminder "Meeting prep" "tomorrow at 9am"
set-reminder "Weekly review" "next monday at 10am"
set-reminder "Pay rent" "next friday at noon"
```

## List Reminders

```bash
list-reminders           # Shows pending reminders
list-reminders all       # Shows all reminders
```

## Cancel a Reminder

```bash
cancel-reminder <id>     # Use ID from list-reminders output
```

## Time Formats Supported

**Relative (from now):**
- Seconds: "in 10 seconds", "in 30 seconds", "in 45 seconds"
- Minutes: "in 1 minute", "in 5 minutes", "in 30 minutes"
- Hours: "in 1 hour", "in 2 hours", "in 90 minutes"
- Days: "in 1 day", "in 3 days", "in a week"

**Absolute (specific time):**
- 12-hour: "at 3pm", "at 9:30am", "at 12pm", "at noon"
- 24-hour: "at 15:00", "at 09:30", "at 18:45"

**Future dates:**
- Tomorrow: "tomorrow at 9am", "tomorrow at noon"
- Day of week: "next monday at 10am", "this friday at 3pm"
- Relative days: "in 2 days at 9am"

## Notes

- Reminders are stored and will fire even if this conversation ends
- The reminder message is sent directly to this Telegram chat
- **Reminders are automatically pinned** for visibility
  - In groups: Bot needs "Pin Messages" admin permission
  - If pinning fails, a one-time tip is sent to the chat
- Use `list-reminders` to see pending reminders and their IDs
