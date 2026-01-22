#!/bin/bash
# add-vocabulary.sh - Add a new vocabulary (field) to an artifact type in MENU.JSON
#
# Usage: add-vocabulary.sh <artifact_type> <vocabulary_name> <description> [senderId]
# Examples:
#   add-vocabulary.sh restaurants visited "Whether we've visited this place"
#   add-vocabulary.sh restaurants cuisine "The cuisine type or cultural origin"
#   add-vocabulary.sh recipes difficulty "How hard the recipe is to make" 123456789  # Private

set -e

ARTIFACT_TYPE=$1
VOCAB_NAME=$2
DESCRIPTION=$3
SENDER_ID=${4:-""}  # Optional: if provided, uses private MENU.JSON

if [ -z "$ARTIFACT_TYPE" ] || [ -z "$VOCAB_NAME" ] || [ -z "$DESCRIPTION" ]; then
  echo "Usage: add-vocabulary.sh <artifact_type> <vocabulary_name> <description> [senderId]"
  echo ""
  echo "Examples:"
  echo "  add-vocabulary.sh restaurants visited \"Whether we've visited this place\""
  echo "  add-vocabulary.sh recipes cuisine \"The cuisine type\" 123456789"
  exit 1
fi

# Determine MENU.JSON location
if [ -n "$SENDER_ID" ]; then
  LISTS_DIR="/home/claude/private/${SENDER_ID}/lists"
  mkdir -p "$LISTS_DIR"
else
  LISTS_DIR="/home/claude/shared/lists"
fi
MENU_FILE="${LISTS_DIR}/MENU.JSON"

# Ensure MENU.JSON exists
if [ ! -f "$MENU_FILE" ]; then
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  mkdir -p "$LISTS_DIR"
  cat > "$MENU_FILE" << MENUJSON
{
  "description": "Lists and artifacts",
  "created_at": "${TIMESTAMP}",
  "last_updated": "${TIMESTAMP}",
  "artifact_types": {}
}
MENUJSON
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Check if artifact type exists - create if not
if ! jq -e ".artifact_types.${ARTIFACT_TYPE}" "$MENU_FILE" > /dev/null 2>&1; then
  echo "Creating new artifact type: ${ARTIFACT_TYPE}"
  jq ".artifact_types.${ARTIFACT_TYPE} = {
    \"description\": \"${ARTIFACT_TYPE}\",
    \"folder\": \"${ARTIFACT_TYPE}\",
    \"schema\": {
      \"required\": [\"uuid\", \"type\", \"title\", \"created_at\", \"created_by\", \"status\"],
      \"optional\": [\"tags\", \"notes\"]
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

# Check if vocabulary already exists
if jq -e ".artifact_types.${ARTIFACT_TYPE}.vocabularies.${VOCAB_NAME}" "$MENU_FILE" > /dev/null 2>&1; then
  EXISTING_DESC=$(jq -r ".artifact_types.${ARTIFACT_TYPE}.vocabularies.${VOCAB_NAME}.description" "$MENU_FILE")
  echo "Vocabulary '${VOCAB_NAME}' already exists for '${ARTIFACT_TYPE}': ${EXISTING_DESC}"
  exit 0
fi

# Add the new vocabulary with description and empty values
jq ".artifact_types.${ARTIFACT_TYPE}.vocabularies.${VOCAB_NAME} = {
  \"description\": \"${DESCRIPTION}\",
  \"values\": {}
} | .last_updated = \"${TIMESTAMP}\"" "$MENU_FILE" > "${MENU_FILE}.tmp" && mv "${MENU_FILE}.tmp" "$MENU_FILE"

# Also add to schema.optional if not already there
OPTIONAL_FIELDS=$(jq -r ".artifact_types.${ARTIFACT_TYPE}.schema.optional // []" "$MENU_FILE")
if ! echo "$OPTIONAL_FIELDS" | jq -e ". | index(\"${VOCAB_NAME}\")" > /dev/null 2>&1; then
  jq ".artifact_types.${ARTIFACT_TYPE}.schema.optional += [\"${VOCAB_NAME}\"]" "$MENU_FILE" > "${MENU_FILE}.tmp" && mv "${MENU_FILE}.tmp" "$MENU_FILE"
fi

echo "ADDED VOCABULARY: '${VOCAB_NAME}' to ${ARTIFACT_TYPE}"
echo "DESCRIPTION: ${DESCRIPTION}"
echo "MENU.JSON: ${MENU_FILE}"
