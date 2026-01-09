#!/bin/bash
# cancel-reminder.sh - Cancel a pending reminder
#
# Usage: cancel-reminder <reminder-id>
# The ID can be the full UUID or just the first 8 characters

set -e

# Source the protected context
source /home/claude/.claude/scripts/telegram-context.sh

REMINDER_ID="$1"

if [[ -z "$REMINDER_ID" ]]; then
  echo "Usage: cancel-reminder <reminder-id>"
  echo "You can get reminder IDs from: list-reminders"
  exit 1
fi

# If only 8 chars provided, we need to find the full UUID
if [[ ${#REMINDER_ID} -le 8 ]]; then
  # Fetch all pending reminders and find one matching the prefix
  REMINDERS=$(curl -s "${WORKER_URL}/reminders?senderId=${SENDER_ID}&status=pending" \
    -H "X-API-Key: ${API_KEY}")

  FULL_ID=$(echo "$REMINDERS" | jq -r --arg prefix "$REMINDER_ID" \
    '.reminders[] | select(.id | startswith($prefix)) | .id' | head -1)

  if [[ -z "$FULL_ID" ]]; then
    echo "ERROR: No pending reminder found with ID starting with: $REMINDER_ID"
    exit 1
  fi

  REMINDER_ID="$FULL_ID"
fi

# Cancel the reminder
RESULT=$(curl -s -X POST "${WORKER_URL}/cancel-reminder" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d "$(jq -n \
    --arg senderId "$SENDER_ID" \
    --arg reminderId "$REMINDER_ID" \
    '{senderId: $senderId, reminderId: $reminderId}')")

# Check result
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
if [[ "$SUCCESS" == "true" ]]; then
  echo "Reminder cancelled successfully (ID: ${REMINDER_ID:0:8}...)"
else
  ERROR=$(echo "$RESULT" | jq -r '.error // "Unknown error"')
  echo "ERROR: Failed to cancel reminder: $ERROR"
  exit 1
fi
