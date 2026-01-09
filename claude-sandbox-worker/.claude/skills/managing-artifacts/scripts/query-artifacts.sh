#!/bin/bash
# query-artifacts.sh - Return JSON array of matching artifacts
#
# Usage: query-artifacts.sh <artifact_type> '<yq_expression>' [senderId]
# Examples:
#   query-artifacts.sh recipes '.tags[] == "italian"'
#   query-artifacts.sh movies '.watched == false'

set -e

ARTIFACT_TYPE=$1
EXPR=$2
SENDER_ID=${3:-""}

if [ -z "$ARTIFACT_TYPE" ] || [ -z "$EXPR" ]; then
  echo "Usage: query-artifacts.sh <artifact_type> '<yq_expression>' [senderId]"
  exit 1
fi

# Always search shared
SEARCH_PATHS="/home/claude/shared/lists/${ARTIFACT_TYPE}"

# Optionally include private
if [ -n "$SENDER_ID" ]; then
  PRIVATE_DIR="/home/claude/private/${SENDER_ID}/lists/${ARTIFACT_TYPE}"
  if [ -d "$PRIVATE_DIR" ]; then
    SEARCH_PATHS="$SEARCH_PATHS $PRIVATE_DIR"
  fi
fi

# Collect results into JSON array
RESULTS="["
FIRST=true

for dir in $SEARCH_PATHS; do
  [ -d "$dir" ] || continue

  for file in "$dir"/*.md; do
    [ -f "$file" ] || continue

    # Check if file matches expression
    match=$(yq --front-matter=extract "select(${EXPR})" "$file" 2>/dev/null || true)
    if [ -n "$match" ]; then
      # Extract key fields for the result
      result=$(yq --front-matter=extract -o=json \
        "{\"uuid\": .uuid, \"title\": .title, \"type\": .type, \"path\": \"${file}\", \"tags\": .tags, \"status\": .status, \"scope\": .scope}" \
        "$file" 2>/dev/null || true)

      if [ -n "$result" ]; then
        if [ "$FIRST" = true ]; then
          FIRST=false
          RESULTS="${RESULTS}${result}"
        else
          RESULTS="${RESULTS},${result}"
        fi
      fi
    fi
  done
done

RESULTS="${RESULTS}]"

# Pretty print if jq available
echo "$RESULTS" | jq '.' 2>/dev/null || echo "$RESULTS"
