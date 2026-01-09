#!/bin/bash
# telegram-context.sh - Source this to get Telegram context variables
# Used by skill scripts internally
#
# NOTE: The context file is in a protected path that Claude cannot directly access
# via Read/Write/Edit/Bash tools. But skill scripts CAN read it since they
# execute in the shell, not through Claude's permission-checked tools.

CONTEXT_FILE="/tmp/protected/telegram_context/context.json"

if [[ ! -f "$CONTEXT_FILE" ]]; then
  echo "ERROR: No Telegram context available at $CONTEXT_FILE" >&2
  echo "This script must be run within a Telegram bot context." >&2
  exit 1
fi

# Export all context variables for use by the calling script
export SENDER_ID=$(jq -r '.senderId' "$CONTEXT_FILE")
export CHAT_ID=$(jq -r '.chatId' "$CONTEXT_FILE")
export IS_GROUP=$(jq -r '.isGroup' "$CONTEXT_FILE")
export BOT_TOKEN=$(jq -r '.botToken' "$CONTEXT_FILE")
export WORKER_URL=$(jq -r '.workerUrl' "$CONTEXT_FILE")
export API_KEY=$(jq -r '.apiKey' "$CONTEXT_FILE")
