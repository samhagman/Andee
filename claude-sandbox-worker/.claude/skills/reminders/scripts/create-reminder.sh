#!/bin/bash
# create-reminder.sh - Create a reminder artifact
#
# Usage: create-reminder.sh <title> <sender_id> <trigger_at_iso> <chat_id> <is_group> [private]
# Example:
#   create-reminder.sh "Call mom" "123456789" "2026-01-07T16:00:00Z" "123456789" "false"

set -e

TITLE=$1
SENDER_ID=$2
TRIGGER_AT_ISO=$3
CHAT_ID=$4
IS_GROUP=$5
IS_PRIVATE=${6:-""}  # Optional: pass "private" for private storage

if [ -z "$TITLE" ] || [ -z "$SENDER_ID" ] || [ -z "$TRIGGER_AT_ISO" ] || [ -z "$CHAT_ID" ] || [ -z "$IS_GROUP" ]; then
  echo "Usage: create-reminder.sh <title> <sender_id> <trigger_at_iso> <chat_id> <is_group> [private]"
  exit 1
fi

# Generate UUID
UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')

# Slugify title (lowercase, replace spaces with hyphens, remove special chars)
SLUG=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')

# Determine path based on is_group and private flag
if [ "$IS_PRIVATE" = "private" ]; then
  SCOPE="private"
  DIR="/home/claude/private/${SENDER_ID}/lists/reminders"
  LISTS_DIR="/home/claude/private/${SENDER_ID}/lists"
elif [ "$IS_GROUP" = "true" ]; then
  SCOPE="shared"
  DIR="/home/claude/shared/lists/reminders"
  LISTS_DIR="/home/claude/shared/lists"
else
  # Private chat - still use shared by default (user's private with Andee)
  SCOPE="shared"
  DIR="/home/claude/shared/lists/reminders"
  LISTS_DIR="/home/claude/shared/lists"
fi

# Create directories if needed
mkdir -p "$DIR"

# Ensure MENU.JSON exists at lists/ level
MENU_FILE="${LISTS_DIR}/MENU.JSON"
if [ ! -f "$MENU_FILE" ]; then
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  cat > "$MENU_FILE" << EOF
{
  "description": "Lists and artifacts",
  "created_at": "${TIMESTAMP}",
  "last_updated": "${TIMESTAMP}",
  "artifact_types": {}
}
EOF
fi

# Ensure reminders type exists in MENU.JSON
if ! jq -e ".artifact_types.reminders" "$MENU_FILE" > /dev/null 2>&1; then
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  jq ".artifact_types.reminders = {
    \"description\": \"Scheduled reminders\",
    \"folder\": \"reminders\",
    \"schema\": {
      \"required\": [\"uuid\", \"type\", \"title\", \"created_at\", \"created_by\", \"status\", \"trigger_at\", \"chat_id\", \"is_group\"],
      \"optional\": [\"notes\"]
    },
    \"vocabularies\": {
      \"status\": {
        \"description\": \"Reminder status\",
        \"values\": {
          \"pending\": \"Scheduled and waiting to fire\",
          \"completed\": \"Successfully sent\",
          \"cancelled\": \"Cancelled before firing\"
        }
      }
    },
    \"example_queries\": [
      \".status == \\\"pending\\\"\",
      \".trigger_at > now\"
    ]
  } | .last_updated = \"${TIMESTAMP}\"" "$MENU_FILE" > "${MENU_FILE}.tmp" && mv "${MENU_FILE}.tmp" "$MENU_FILE"
fi

# Create file path (use first 8 chars of UUID in filename)
FILEPATH="${DIR}/${SLUG}-${UUID:0:8}.md"

# Generate frontmatter
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Convert trigger_at to Unix ms for the worker
TRIGGER_MS=$(($(date -d "$TRIGGER_AT_ISO" +%s) * 1000))

cat > "$FILEPATH" << EOF
---
uuid: ${UUID}
type: reminder
title: ${TITLE}
created_at: ${TIMESTAMP}
created_by: "${SENDER_ID}"
scope: ${SCOPE}
status: pending
trigger_at: ${TRIGGER_AT_ISO}
chat_id: "${CHAT_ID}"
is_group: ${IS_GROUP}
---

# ${TITLE}

Reminder set for ${TRIGGER_AT_ISO}.

EOF

# Return the details for the conversation log
echo "CREATED: ${FILEPATH}"
echo "UUID: ${UUID}"
echo "SCOPE: ${SCOPE}"
echo "TRIGGER_AT: ${TRIGGER_MS}"
