#!/usr/bin/env bash
set -euo pipefail

# Global reset script for GitLab integration tests.
# Resets a test repo to a clean state: no open MRs, no extra branches,
# default branch contains only README.md.
#
# Usage: reset-test-repo-gitlab.sh <project-path>
# Requires: GITLAB_TOKEN environment variable (used by glab automatically)

PROJECT_PATH="${1:?Usage: reset-test-repo-gitlab.sh <project-path>}"

: "${GITLAB_TOKEN:?GITLAB_TOKEN must be set}"

# URL-encode the project path for API calls
PROJECT_ID=$(printf '%s' "${PROJECT_PATH}" | jq -sRr @uri)

echo "=== Resetting ${PROJECT_PATH} to clean state ==="

# Step 1 — Auto-detect default branch
echo "Step 1: Detecting default branch..."
DEFAULT_BRANCH=$(glab api "projects/${PROJECT_ID}" 2>/dev/null | jq -r '.default_branch // "main"')
echo "  Default branch: ${DEFAULT_BRANCH}"

# Step 2 — Close all open MRs
echo "Step 2: Closing all open MRs..."
MR_IIDS=$(glab api "projects/${PROJECT_ID}/merge_requests?state=opened&per_page=100" 2>/dev/null | jq -r '.[].iid' || true)

for iid in ${MR_IIDS}; do
  glab api --method PUT "projects/${PROJECT_ID}/merge_requests/${iid}" -f state_event=close 2>/dev/null || true
  echo "  Closed MR !${iid}"
done

if [ -z "${MR_IIDS}" ]; then
  echo "  No open MRs found"
fi

# Step 3 — Delete all branches except default
echo "Step 3: Deleting all branches except ${DEFAULT_BRANCH}..."
BRANCHES=$(glab api "projects/${PROJECT_ID}/repository/branches?per_page=100" 2>/dev/null | jq -r '.[].name' || true)

for branch in ${BRANCHES}; do
  if [ "${branch}" != "${DEFAULT_BRANCH}" ]; then
    ENCODED_BRANCH=$(printf '%s' "${branch}" | jq -sRr @uri)
    glab api --method DELETE "projects/${PROJECT_ID}/repository/branches/${ENCODED_BRANCH}" 2>/dev/null || true
    echo "  Deleted branch ${branch}"
  fi
done

# Step 4 — Reset default branch to README-only
echo "Step 4: Resetting ${DEFAULT_BRANCH} to README-only..."

# Get current tree items
TREE_JSON=$(glab api "projects/${PROJECT_ID}/repository/tree?ref=${DEFAULT_BRANCH}&recursive=true&per_page=100" 2>/dev/null || echo "[]")

# Build actions array
ACTIONS="["
NEEDS_COMMA=false
HAS_README=false

# Delete all files except README.md
while IFS= read -r file_path; do
  [ -z "${file_path}" ] && continue
  if [ "${file_path}" = "README.md" ]; then
    HAS_README=true
    continue
  fi
  if [ "${NEEDS_COMMA}" = true ]; then
    ACTIONS+=","
  fi
  # Escape any special characters in file path for JSON
  ESCAPED_PATH=$(printf '%s' "${file_path}" | jq -Rs '.')
  ACTIONS+="{\"action\":\"delete\",\"file_path\":${ESCAPED_PATH}}"
  NEEDS_COMMA=true
done <<<"$(printf '%s' "${TREE_JSON}" | jq -r '.[]? | select(.type == "blob") | .path')"

# Add/update README.md
if [ "${NEEDS_COMMA}" = true ]; then
  ACTIONS+=","
fi

README_CONTENT=$(printf '# %s\n\nIntegration test repository for xfg.\n' "$(basename "${PROJECT_PATH}")")

if [ "${HAS_README}" = true ]; then
  ACTION_TYPE="update"
else
  ACTION_TYPE="create"
fi

ESCAPED_CONTENT=$(printf '%s' "${README_CONTENT}" | jq -Rs '.')
ACTIONS+="{\"action\":\"${ACTION_TYPE}\",\"file_path\":\"README.md\",\"content\":${ESCAPED_CONTENT}}"
ACTIONS+="]"

# Create commit with all actions
COMMIT_BODY=$(jq -n \
  --arg branch "${DEFAULT_BRANCH}" \
  --arg message "test: reset to clean state" \
  --argjson actions "${ACTIONS}" \
  '{branch: $branch, commit_message: $message, actions: $actions}')

glab api --method POST "projects/${PROJECT_ID}/repository/commits" --input - <<<"${COMMIT_BODY}" >/dev/null 2>&1 || true

echo "  Reset ${DEFAULT_BRANCH} to README-only"

echo "=== Reset complete ==="
