---
name: user-preferences
description: Manage user preferences including timezone. Handles /timezone command and natural language preference changes like "I'm in Boston" or "I moved to Tokyo".
---

# User Preferences

## Getting Context

The sender ID is available in the context file. Read it first:

```bash
SENDER_ID=$(jq -r .senderId /tmp/protected/telegram_context/context.json)
```

## Preferences File Location

```
/home/claude/private/{senderId}/preferences.yaml
```

## Handling /timezone Command

When user says `/timezone`, `/timezone <timezone>`, or mentions changing their timezone:

### Show Current Timezone

```bash
SENDER_ID=$(jq -r .senderId /tmp/protected/telegram_context/context.json)
cat /home/claude/private/$SENDER_ID/preferences.yaml 2>/dev/null | grep timezone || echo "No timezone set"
```

### Set/Update Timezone

1. Parse user input to IANA timezone (see mappings below)
2. Update preferences file:

```bash
SENDER_ID=$(jq -r .senderId /tmp/protected/telegram_context/context.json)
mkdir -p /home/claude/private/$SENDER_ID
cat > /home/claude/private/$SENDER_ID/preferences.yaml << 'EOF'
timezone: America/New_York
EOF
```

3. Confirm to user:
   > "Timezone set to America/New_York (Eastern Time). Future times will use this timezone."

## Parsing Timezone Input

Accept various formats and normalize to IANA timezone:

| User Input | IANA Timezone |
|------------|---------------|
| "New York", "NYC", "EST", "Eastern" | America/New_York |
| "Los Angeles", "LA", "PST", "Pacific" | America/Los_Angeles |
| "Chicago", "CST", "Central" | America/Chicago |
| "Denver", "MST", "Mountain" | America/Denver |
| "London", "GMT", "UK" | Europe/London |
| "Paris", "CET", "Central Europe" | Europe/Paris |
| "Berlin", "Germany" | Europe/Berlin |
| "Tokyo", "JST", "Japan" | Asia/Tokyo |
| "Sydney", "AEST", "Australia" | Australia/Sydney |
| "Singapore", "SGT" | Asia/Singapore |
| "Dubai", "UAE" | Asia/Dubai |
| "Mumbai", "IST", "India" | Asia/Kolkata |

For cities not in the list, use your knowledge to determine the correct IANA timezone.

## Handling Natural Language

Users may say things like:
- "I'm in Boston" → America/New_York
- "I moved to California" → America/Los_Angeles (ask Pacific vs Mountain if unclear)
- "Set my timezone to PST" → America/Los_Angeles

## Ambiguous Cases

For ambiguous inputs, ask for clarification:
- "Portland" → "Portland, Oregon (Pacific) or Portland, Maine (Eastern)?"
- "Indiana" → Some counties are Central, most are Eastern - ask for city

## Responding to /timezone

If user just sends `/timezone` with no argument:
1. Show current timezone (or "Not set")
2. Ask: "Would you like to change it? Just tell me your city or timezone."

## Mid-Session Timezone Changes

When timezone is changed mid-session:
1. Update the preferences.yaml file
2. Use explicit `TZ=xxx` prefix for any `date` commands in this session
3. The TZ env var will be updated automatically on next container restart

Example for mid-session:
```bash
TZ=America/Los_Angeles date +%s -d "3pm"
```
