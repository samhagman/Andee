#!/bin/bash
# list-reminders.sh - List pending reminders
#
# Usage: list-reminders [status]
# Examples:
#   list-reminders          # Lists pending reminders (default)
#   list-reminders pending  # Same as above
#   list-reminders all      # List all reminders regardless of status

set -e

# Source the protected context
source /home/claude/.claude/scripts/telegram-context.sh

STATUS="${1:-pending}"

if [[ "$STATUS" == "all" ]]; then
  URL="${WORKER_URL}/reminders?senderId=${SENDER_ID}"
else
  URL="${WORKER_URL}/reminders?senderId=${SENDER_ID}&status=${STATUS}"
fi

RESULT=$(curl -s "$URL" -H "X-API-Key: ${API_KEY}")

# Check for success
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
if [[ "$SUCCESS" != "true" ]]; then
  ERROR=$(echo "$RESULT" | jq -r '.error // "Unknown error"')
  echo "ERROR: $ERROR"
  exit 1
fi

# Count reminders
COUNT=$(echo "$RESULT" | jq '.reminders | length')

if [[ "$COUNT" -eq 0 ]]; then
  echo "No ${STATUS} reminders found."
  exit 0
fi

echo "Found $COUNT ${STATUS} reminder(s):"
echo ""

# Format and display each reminder
echo "$RESULT" | jq -r '.reminders[] |
  "ID: \(.id[0:8])...\n" +
  "Message: \(.message)\n" +
  "Time: \(.triggerAt / 1000 | strftime("%B %d at %I:%M %p"))\n" +
  "Status: \(.status)\n"'
