#!/usr/bin/env bash
set -euo pipefail

# Assert that an ephemeral repo was created and contains an expected file
# with expected JSON content.
#
# Usage: assert-ephemeral-repo.sh <owner/repo> <file-path> <jq-assertion>
# Requires: GH_TOKEN environment variable
#
# Example:
#   assert-ephemeral-repo.sh "anthony-spruyt/xfg-lifecycle-test-123" \
#     "lifecycle-action-test.json" '.createdByAction == true'

REPO="${1:?Usage: assert-ephemeral-repo.sh <owner/repo> <file-path> <jq-assertion>}"
FILE_PATH="${2:?Missing file-path}"
JQ_ASSERTION="${3:?Missing jq-assertion}"

echo "Verifying repo ${REPO} exists..."
FULL_NAME=$(gh api "repos/${REPO}" --jq '.full_name' 2>/dev/null || true)
if [ -z "$FULL_NAME" ]; then
  echo "ERROR: Repo ${REPO} was not created"
  exit 1
fi
echo "Repo ${REPO} created successfully"

echo "Verifying file ${FILE_PATH} exists..."
FILE_CONTENT=$(gh api "repos/${REPO}/contents/${FILE_PATH}" --jq '.content' | base64 -d)
echo "File content: ${FILE_CONTENT}"
echo "$FILE_CONTENT" | jq -e "${JQ_ASSERTION}"
echo "File verified successfully"
