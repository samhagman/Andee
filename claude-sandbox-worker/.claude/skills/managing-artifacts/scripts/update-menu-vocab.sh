#!/bin/bash
# update-menu-vocab.sh - Add a new vocabulary value to MENU.JSON
#
# Usage: update-menu-vocab.sh <artifact_type> <vocabulary> <value> <description> [senderId]
# Examples:
#   update-menu-vocab.sh recipes cuisine korean "Korean cuisine - kimchi, BBQ, fermented flavors"
#   update-menu-vocab.sh recipes tags keto "Ketogenic diet friendly - low carb, high fat"
#   update-menu-vocab.sh recipes tags secret-family "Secret family recipes" 123456789  # Private MENU.JSON

set -e

ARTIFACT_TYPE=$1
VOCAB=$2
NEW_VALUE=$3
DESCRIPTION=$4
SENDER_ID=${5:-""}  # Optional: if provided and non-empty, uses private MENU.JSON

if [ -z "$ARTIFACT_TYPE" ] || [ -z "$VOCAB" ] || [ -z "$NEW_VALUE" ] || [ -z "$DESCRIPTION" ]; then
  echo "Usage: update-menu-vocab.sh <artifact_type> <vocabulary> <value> <description> [senderId]"
  exit 1
fi

# Determine MENU.JSON location
if [ -n "$SENDER_ID" ]; then
  MENU_FILE="/home/claude/private/${SENDER_ID}/lists/MENU.JSON"
  # Ensure private lists directory exists
  mkdir -p "/home/claude/private/${SENDER_ID}/lists"
else
  MENU_FILE="/home/claude/shared/lists/MENU.JSON"
fi

# Ensure MENU.JSON exists
if [ ! -f "$MENU_FILE" ]; then
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  cat > "$MENU_FILE" << MENUJSON
{
  "description": "Lists and artifacts",
  "created_at": "${TIMESTAMP}",
  "last_updated": "${TIMESTAMP}",
  "artifact_types": {}
}
MENUJSON
fi

# Check if artifact type exists
if ! jq -e ".artifact_types.${ARTIFACT_TYPE}" "$MENU_FILE" > /dev/null 2>&1; then
  echo "ERROR: Artifact type '${ARTIFACT_TYPE}' does not exist in MENU.JSON"
  echo "Available types: $(jq -r '.artifact_types | keys | join(", ")' "$MENU_FILE")"
  exit 1
fi

# Check if vocabulary exists
if ! jq -e ".artifact_types.${ARTIFACT_TYPE}.vocabularies.${VOCAB}" "$MENU_FILE" > /dev/null 2>&1; then
  echo "ERROR: Vocabulary '${VOCAB}' does not exist for '${ARTIFACT_TYPE}'"
  echo "Available vocabularies: $(jq -r ".artifact_types.${ARTIFACT_TYPE}.vocabularies | keys | join(\", \")" "$MENU_FILE")"
  exit 1
fi

# Check if value already exists
if jq -e ".artifact_types.${ARTIFACT_TYPE}.vocabularies.${VOCAB}.values.\"${NEW_VALUE}\"" "$MENU_FILE" > /dev/null 2>&1; then
  EXISTING=$(jq -r ".artifact_types.${ARTIFACT_TYPE}.vocabularies.${VOCAB}.values.\"${NEW_VALUE}\"" "$MENU_FILE")
  echo "Value '${NEW_VALUE}' already exists: ${EXISTING}"
  exit 0
fi

# Add the new value with its description and update timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
jq ".artifact_types.${ARTIFACT_TYPE}.vocabularies.${VOCAB}.values.\"${NEW_VALUE}\" = \"${DESCRIPTION}\" | .last_updated = \"${TIMESTAMP}\"" \
  "$MENU_FILE" > "${MENU_FILE}.tmp" && mv "${MENU_FILE}.tmp" "$MENU_FILE"

echo "ADDED: '${NEW_VALUE}' to ${ARTIFACT_TYPE}.${VOCAB}"
echo "DESCRIPTION: ${DESCRIPTION}"
