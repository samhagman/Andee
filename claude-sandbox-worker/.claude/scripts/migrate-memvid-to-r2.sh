#!/bin/bash
# migrate-memvid-to-r2.sh
#
# Migrates memvid .mv2 files from legacy locations to R2-mounted storage.
# Run this script inside the container after restoring from a snapshot that has legacy data.
#
# Usage: ./migrate-memvid-to-r2.sh <chatId>
#
# Example:
#   ./migrate-memvid-to-r2.sh -1003285272358  # Migrate group chat
#   ./migrate-memvid-to-r2.sh 123456789       # Migrate private chat
#
# What it does:
#   1. Checks for legacy .mv2 files at /home/claude/shared/ or /home/claude/private/
#   2. Copies them to /media/conversation-history/{chatId}/memory.mv2
#   3. Optionally removes the old files

set -e

CHAT_ID="$1"

if [ -z "$CHAT_ID" ]; then
    echo "Usage: $0 <chatId>"
    echo ""
    echo "Example:"
    echo "  $0 -1003285272358  # Migrate group chat"
    echo "  $0 123456789       # Migrate private chat"
    exit 1
fi

# Determine if this is a group chat (negative ID)
if [[ "$CHAT_ID" == -* ]]; then
    echo "Detected group chat: $CHAT_ID"
    LEGACY_PATH="/home/claude/shared/shared.mv2"
else
    echo "Detected private chat: $CHAT_ID"
    LEGACY_PATH="/home/claude/private/$CHAT_ID/memory.mv2"
fi

# New R2 path
NEW_PATH="/media/conversation-history/$CHAT_ID/memory.mv2"
NEW_DIR="/media/conversation-history/$CHAT_ID"

echo ""
echo "Migration paths:"
echo "  From: $LEGACY_PATH"
echo "  To:   $NEW_PATH"
echo ""

# Check if legacy file exists
if [ ! -f "$LEGACY_PATH" ]; then
    echo "ERROR: Legacy file not found at $LEGACY_PATH"
    echo ""
    echo "Possible reasons:"
    echo "  - No conversation history exists yet"
    echo "  - Already migrated"
    echo "  - Wrong chatId"
    exit 1
fi

# Check if R2 is mounted
if [ ! -d "/media" ]; then
    echo "ERROR: /media directory doesn't exist"
    exit 1
fi

# Check if new file already exists
if [ -f "$NEW_PATH" ]; then
    echo "WARNING: Target file already exists at $NEW_PATH"
    echo ""
    read -p "Overwrite? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# Create target directory
echo "Creating directory: $NEW_DIR"
mkdir -p "$NEW_DIR"

# Copy the file
echo "Copying memvid file..."
cp -v "$LEGACY_PATH" "$NEW_PATH"

# Verify
if [ -f "$NEW_PATH" ]; then
    OLD_SIZE=$(stat -c %s "$LEGACY_PATH")
    NEW_SIZE=$(stat -c %s "$NEW_PATH")
    echo ""
    echo "SUCCESS! Migration complete."
    echo "  Old file: $OLD_SIZE bytes"
    echo "  New file: $NEW_SIZE bytes"
    echo ""

    # Ask about cleanup
    echo "The old file still exists at: $LEGACY_PATH"
    echo "It will be excluded from future snapshots automatically."
    echo ""
    read -p "Delete old file now? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -v "$LEGACY_PATH"
        echo "Old file deleted."
    else
        echo "Old file kept (will be excluded from snapshots)."
    fi
else
    echo "ERROR: Copy failed!"
    exit 1
fi

echo ""
echo "Migration complete for chat $CHAT_ID"
