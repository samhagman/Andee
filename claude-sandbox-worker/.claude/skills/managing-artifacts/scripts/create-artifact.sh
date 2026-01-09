#!/bin/bash
# create-artifact.sh - Create a new artifact with UUID
#
# Usage: create-artifact.sh <artifact_type> <name> <created_by> [private]
# Examples:
#   create-artifact.sh recipes "Pasta Carbonara" 123456789
#   create-artifact.sh recipes "Secret Family Recipe" 123456789 private

set -e

ARTIFACT_TYPE=$1
NAME=$2
CREATED_BY=$3
IS_PRIVATE=${4:-""}  # Optional: pass "private" for private storage

if [ -z "$ARTIFACT_TYPE" ] || [ -z "$NAME" ] || [ -z "$CREATED_BY" ]; then
  echo "Usage: create-artifact.sh <artifact_type> <name> <created_by> [private]"
  exit 1
fi

# Generate UUID
UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')

# Slugify name (lowercase, replace spaces with hyphens, remove special chars)
SLUG=$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')

# Determine path based on private flag
if [ "$IS_PRIVATE" = "private" ]; then
  SCOPE="private"
  DIR="/home/claude/private/${CREATED_BY}/lists/${ARTIFACT_TYPE}"
  LISTS_DIR="/home/claude/private/${CREATED_BY}/lists"
  # Create private directory structure if needed
  mkdir -p "$DIR"
else
  SCOPE="shared"
  DIR="/home/claude/shared/lists/${ARTIFACT_TYPE}"
  LISTS_DIR="/home/claude/shared/lists"
fi

# Create directories if needed
mkdir -p "$DIR"

# Ensure MENU.JSON exists at lists/ level
MENU_FILE="${LISTS_DIR}/MENU.JSON"
if [ ! -f "$MENU_FILE" ]; then
  cat > "$MENU_FILE" << 'MENUJSON'
{
  "description": "Lists and artifacts",
  "created_at": "TIMESTAMP_PLACEHOLDER",
  "last_updated": "TIMESTAMP_PLACEHOLDER",
  "artifact_types": {}
}
MENUJSON
  # Replace timestamp placeholder
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  sed -i "s/TIMESTAMP_PLACEHOLDER/${TIMESTAMP}/g" "$MENU_FILE"
fi

# Ensure this artifact type exists in MENU.JSON
if ! jq -e ".artifact_types.${ARTIFACT_TYPE}" "$MENU_FILE" > /dev/null 2>&1; then
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  jq ".artifact_types.${ARTIFACT_TYPE} = {
    \"description\": \"${ARTIFACT_TYPE}\",
    \"folder\": \"${ARTIFACT_TYPE}\",
    \"schema\": {
      \"required\": [\"uuid\", \"type\", \"title\", \"created_at\", \"created_by\", \"status\"],
      \"optional\": [\"tags\"]
    },
    \"vocabularies\": {
      \"tags\": {
        \"description\": \"Flexible tags for categorization\",
        \"values\": {}
      }
    },
    \"example_queries\": []
  } | .last_updated = \"${TIMESTAMP}\"" "$MENU_FILE" > "${MENU_FILE}.tmp" && mv "${MENU_FILE}.tmp" "$MENU_FILE"
fi

# Create file path (use first 8 chars of UUID in filename)
FILEPATH="${DIR}/${SLUG}-${UUID:0:8}.md"

# Generate frontmatter
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "$FILEPATH" << EOF
---
uuid: ${UUID}
type: ${ARTIFACT_TYPE}
title: ${NAME}
created_at: ${TIMESTAMP}
created_by: ${CREATED_BY}
scope: ${SCOPE}
tags: []
status: active
---

# ${NAME}

EOF

# Return the path and UUID for the conversation log
echo "CREATED: ${FILEPATH}"
echo "UUID: ${UUID}"
echo "SCOPE: ${SCOPE}"
