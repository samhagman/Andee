#!/bin/bash
# set-reminder.sh - Set a reminder with automatic time parsing
#
# Usage: set-reminder "reminder text" "time expression"
# Examples:
#   set-reminder "Call mom" "in 30 minutes"
#   set-reminder "Take medication" "at 3pm"
#   set-reminder "Meeting prep" "tomorrow at 9am"

set -e

# Source the protected context (contains SENDER_ID, CHAT_ID, BOT_TOKEN, etc.)
source /home/claude/.claude/scripts/telegram-context.sh

REMINDER_TEXT="$1"
TIME_EXPR="$2"

if [[ -z "$REMINDER_TEXT" ]] || [[ -z "$TIME_EXPR" ]]; then
  echo "Usage: set-reminder \"reminder text\" \"time expression\""
  echo "Examples:"
  echo "  set-reminder \"Call mom\" \"in 30 minutes\""
  echo "  set-reminder \"Take medication\" \"at 3pm\""
  exit 1
fi

# Calculate trigger time using GNU date
# Try parsing as-is first, then try with "today" prefix for absolute times
if TRIGGER_SECS=$(date -d "$TIME_EXPR" +%s 2>/dev/null); then
  : # Success
elif TRIGGER_SECS=$(date -d "today $TIME_EXPR" +%s 2>/dev/null); then
  : # Success with "today" prefix
else
  echo "ERROR: Could not parse time expression: $TIME_EXPR"
  echo "Try formats like: 'in 30 minutes', 'at 3pm', 'tomorrow at 9am'"
  exit 1
fi

TRIGGER_MS=$((TRIGGER_SECS * 1000))
TRIGGER_ISO=$(date -d "@$TRIGGER_SECS" -u +"%Y-%m-%dT%H:%M:%SZ")

# Generate UUID
UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')

# Create artifact using the existing create-reminder.sh script
ARTIFACT_OUTPUT=$(/home/claude/.claude/skills/reminders/scripts/create-reminder.sh \
  "$REMINDER_TEXT" "$SENDER_ID" "$TRIGGER_ISO" "$CHAT_ID" "$IS_GROUP" 2>&1)

# Extract the UUID from create-reminder.sh output (it generates its own)
ARTIFACT_UUID=$(echo "$ARTIFACT_OUTPUT" | grep "^UUID:" | cut -d' ' -f2)
if [[ -n "$ARTIFACT_UUID" ]]; then
  UUID="$ARTIFACT_UUID"
fi

# Schedule with worker
SCHEDULE_RESULT=$(curl -s -X POST "${WORKER_URL}/schedule-reminder" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d "$(jq -n \
    --arg senderId "$SENDER_ID" \
    --arg chatId "$CHAT_ID" \
    --argjson isGroup "$IS_GROUP" \
    --arg reminderId "$UUID" \
    --argjson triggerAt "$TRIGGER_MS" \
    --arg message "$REMINDER_TEXT" \
    --arg botToken "$BOT_TOKEN" \
    '{senderId: $senderId, chatId: $chatId, isGroup: $isGroup,
      reminderId: $reminderId, triggerAt: $triggerAt,
      message: $message, botToken: $botToken}')")

# Check if scheduling succeeded
SUCCESS=$(echo "$SCHEDULE_RESULT" | jq -r '.success // false')
if [[ "$SUCCESS" != "true" ]]; then
  ERROR=$(echo "$SCHEDULE_RESULT" | jq -r '.error // "Unknown error"')
  echo "ERROR: Failed to schedule reminder: $ERROR"
  exit 1
fi

# Return human-readable confirmation
HUMAN_TIME=$(date -d "@$TRIGGER_SECS" +"%I:%M %p on %B %d")
echo "Reminder set: \"$REMINDER_TEXT\" at $HUMAN_TIME (ID: ${UUID:0:8})"
