#!/bin/bash
# find-by-tag.sh - Find artifacts matching a yq expression
#
# Usage: find-by-tag.sh <artifact_type> '<yq_expression>' [senderId]
# Examples:
#   find-by-tag.sh recipes '.tags[] == "italian"'
#   find-by-tag.sh recipes '.cuisine == "italian" and .difficulty == "easy"'
#   find-by-tag.sh movies '.watched == false'
#   find-by-tag.sh recipes '.tags[] == "secret"' 123456789  # Include private

set -e

ARTIFACT_TYPE=$1
EXPR=$2
SENDER_ID=${3:-""}  # Optional: if provided, also search private artifacts

if [ -z "$ARTIFACT_TYPE" ] || [ -z "$EXPR" ]; then
  echo "Usage: find-by-tag.sh <artifact_type> '<yq_expression>' [senderId]"
  echo ""
  echo "Examples:"
  echo "  find-by-tag.sh recipes '.cuisine == \"italian\"'"
  echo "  find-by-tag.sh recipes '.tags[] == \"vegetarian\"'"
  echo "  find-by-tag.sh movies '.watched == false'"
  exit 1
fi

# Always search shared
SEARCH_PATHS="/home/claude/shared/lists/${ARTIFACT_TYPE}"

# Optionally include private (if senderId provided)
if [ -n "$SENDER_ID" ]; then
  PRIVATE_DIR="/home/claude/private/${SENDER_ID}/lists/${ARTIFACT_TYPE}"
  if [ -d "$PRIVATE_DIR" ]; then
    SEARCH_PATHS="$SEARCH_PATHS $PRIVATE_DIR"
  fi
fi

FOUND=0

# Use yq to filter files by frontmatter expression
for dir in $SEARCH_PATHS; do
  [ -d "$dir" ] || continue

  for file in "$dir"/*.md; do
    [ -f "$file" ] || continue

    # Check if file matches expression
    result=$(yq --front-matter=extract "select(${EXPR})" "$file" 2>/dev/null || true)
    if [ -n "$result" ]; then
      echo "$file"
      FOUND=$((FOUND + 1))
    fi
  done
done

if [ $FOUND -eq 0 ]; then
  echo "No artifacts found matching: ${EXPR}"
  exit 0
fi

echo ""
echo "Found ${FOUND} artifact(s)"
