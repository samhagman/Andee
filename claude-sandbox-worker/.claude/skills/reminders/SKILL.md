---
name: reminders
description: Set, list, and cancel reminders. Use when user says "remind me", "set a reminder", "what reminders do I have", or "cancel reminder".
---

# Reminders

## CRITICAL: Check Timezone First

Before setting any reminder with an absolute time (e.g., "at 3pm", "tomorrow at 9am"):

1. **Check if user has a timezone preference:**
```bash
cat /home/claude/private/${SENDER_ID}/preferences.yaml 2>/dev/null | grep timezone
```

2. **If NO timezone found, ASK the user:**
   > "What timezone are you in? (e.g., 'New York', 'EST', 'America/Los_Angeles')"

3. **Create the preferences file with their response:**
```bash
mkdir -p /home/claude/private/${SENDER_ID}
cat > /home/claude/private/${SENDER_ID}/preferences.yaml << 'EOF'
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
set-reminder "Call mom" "in 30 minutes"
set-reminder "Take medication" "at 3pm"
set-reminder "Meeting prep" "tomorrow at 9am"
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

- Relative: "in 30 minutes", "in 2 hours", "in 1 day"
- Absolute: "at 3pm", "at 15:00", "at 9:30am"
- Future dates: "tomorrow at 9am", "next monday at 10am"

## Notes

- Reminders are stored and will fire even if this conversation ends
- The reminder message is sent directly to this Telegram chat
- Use `list-reminders` to see pending reminders and their IDs
