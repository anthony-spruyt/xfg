#!/bin/bash
# Verify commit message file count matches actual files changed (issue #268)
# Usage: verify-commit-file-count.sh <repo> <commit_sha>
# Requires: GH_TOKEN environment variable

set -euo pipefail

REPO="${1:?Usage: verify-commit-file-count.sh <repo> <commit_sha>}"
COMMIT_SHA="${2:?Usage: verify-commit-file-count.sh <repo> <commit_sha>}"

echo "Verifying file count in commit message..."
COMMIT_MESSAGE=$(gh api "repos/${REPO}/commits/${COMMIT_SHA}" --jq '.commit.message')
echo "Commit message: $COMMIT_MESSAGE"

# Get actual files changed
ACTUAL_FILES=$(gh api "repos/${REPO}/commits/${COMMIT_SHA}" --jq '.files[].filename' | sort)
ACTUAL_COUNT=$(echo "$ACTUAL_FILES" | wc -l | tr -d ' ')
echo "Actual files changed ($ACTUAL_COUNT):"
echo "$ACTUAL_FILES"

# Extract file names from commit message and verify count
if echo "$COMMIT_MESSAGE" | grep -q "config files"; then
  # Message says "N config files" - extract N and compare
  MSG_COUNT=$(echo "$COMMIT_MESSAGE" | grep -oE '[0-9]+ config files' | grep -oE '[0-9]+')
  echo "Commit message claims $MSG_COUNT files"
  if [ "$MSG_COUNT" != "$ACTUAL_COUNT" ]; then
    echo "ERROR: Commit message says $MSG_COUNT files but $ACTUAL_COUNT actually changed"
    exit 1
  fi
else
  # Message lists individual files - check for duplicates and count
  FILE_LIST=$(echo "$COMMIT_MESSAGE" | head -1 | sed 's/^[^:]*: [^ ]* //')
  echo "Files listed in message: $FILE_LIST"

  # Count commas + 1 to get file count (or 1 if no commas)
  if echo "$FILE_LIST" | grep -q ","; then
    MSG_COUNT=$(($(echo "$FILE_LIST" | tr -cd ',' | wc -c) + 1))
  else
    MSG_COUNT=1
  fi
  echo "Commit message lists $MSG_COUNT file(s)"

  # Check for duplicates
  SORTED_FILES=$(echo "$FILE_LIST" | tr ',' '\n' | sed 's/^ *//' | sort)
  UNIQUE_FILES=$(echo "$SORTED_FILES" | uniq)
  if [ "$SORTED_FILES" != "$UNIQUE_FILES" ]; then
    echo "ERROR: Duplicate file names in commit message!"
    echo "Files: $FILE_LIST"
    exit 1
  fi

  if [ "$MSG_COUNT" != "$ACTUAL_COUNT" ]; then
    echo "ERROR: Commit message lists $MSG_COUNT files but $ACTUAL_COUNT actually changed"
    exit 1
  fi
fi

echo "File count verification passed"
