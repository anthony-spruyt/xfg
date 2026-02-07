#!/usr/bin/env bash
set -euo pipefail

# Global reset script for Azure DevOps integration tests.
# Resets a test repo to a clean state: no active PRs, no extra branches,
# default branch contains only README.md.
#
# Usage: reset-test-repo-ado.sh <org-url> <project> <repo>
# Requires: AZURE_DEVOPS_EXT_PAT environment variable

ORG_URL="${1:?Usage: reset-test-repo-ado.sh <org-url> <project> <repo>}"
PROJECT="${2:?Usage: reset-test-repo-ado.sh <org-url> <project> <repo>}"
REPO="${3:?Usage: reset-test-repo-ado.sh <org-url> <project> <repo>}"

PAT="${AZURE_DEVOPS_EXT_PAT:?AZURE_DEVOPS_EXT_PAT must be set}"
AUTH=$(printf ':%s' "${PAT}" | base64 -w 0)

echo "=== Resetting ${ORG_URL}/${PROJECT}/_git/${REPO} to clean state ==="

# Helper: call ADO REST API
ado_api() {
  local method="$1"
  local uri="$2"
  local body="${3:-}"

  if [ -n "${body}" ]; then
    curl -s -X "${method}" \
      -H "Authorization: Basic ${AUTH}" \
      -H "Content-Type: application/json" \
      -d "${body}" \
      "${uri}"
  else
    curl -s -X "${method}" \
      -H "Authorization: Basic ${AUTH}" \
      "${uri}"
  fi
}

# Step 1 — Auto-detect default branch
echo "Step 1: Detecting default branch..."
REPO_INFO=$(ado_api GET "${ORG_URL}/${PROJECT}/_apis/git/repositories/${REPO}?api-version=7.0")
DEFAULT_BRANCH=$(printf '%s' "${REPO_INFO}" | jq -r '.defaultBranch // empty' | sed 's|refs/heads/||')
if [ -z "${DEFAULT_BRANCH}" ]; then
  echo "  Could not detect default branch, assuming 'main'"
  DEFAULT_BRANCH="main"
fi
echo "  Default branch: ${DEFAULT_BRANCH}"

# Step 2 — Abandon all active PRs
echo "Step 2: Abandoning all active PRs..."
PR_IDS=$(az repos pr list \
  --repository "${REPO}" \
  --org "${ORG_URL}" \
  --project "${PROJECT}" \
  --status active \
  --query "[].pullRequestId" -o tsv 2>/dev/null || true)

for pr_id in ${PR_IDS}; do
  az repos pr update --id "${pr_id}" --status abandoned --org "${ORG_URL}" 2>/dev/null || true
  echo "  Abandoned PR #${pr_id}"
done

if [ -z "${PR_IDS}" ]; then
  echo "  No active PRs found"
fi

# Step 3 — Delete all branches except default
echo "Step 3: Deleting all branches except ${DEFAULT_BRANCH}..."
REFS_JSON=$(ado_api GET "${ORG_URL}/${PROJECT}/_apis/git/repositories/${REPO}/refs?filter=heads/&api-version=7.0")
REFS=$(printf '%s' "${REFS_JSON}" | jq -r '.value[]? | "\(.name) \(.objectId)"')

while IFS=' ' read -r ref_name object_id; do
  [ -z "${ref_name}" ] && continue
  branch_name="${ref_name#refs/heads/}"
  if [ "${branch_name}" != "${DEFAULT_BRANCH}" ]; then
    az repos ref delete \
      --name "${ref_name}" \
      --repository "${REPO}" \
      --org "${ORG_URL}" \
      --project "${PROJECT}" \
      --object-id "${object_id}" 2>/dev/null || true
    echo "  Deleted branch ${branch_name}"
  fi
done <<<"${REFS}"

# Step 4 — Reset default branch to README-only
echo "Step 4: Resetting ${DEFAULT_BRANCH} to README-only..."

# Get latest commit on default branch
LATEST_COMMIT=$(printf '%s' "$(ado_api GET "${ORG_URL}/${PROJECT}/_apis/git/repositories/${REPO}/refs?filter=heads/${DEFAULT_BRANCH}&api-version=7.0")" |
  jq -r '.value[0].objectId // empty')

if [ -z "${LATEST_COMMIT}" ]; then
  echo "  No commits on default branch, skipping reset"
  echo "=== Reset complete ==="
  exit 0
fi

# Get current tree items
ITEMS_JSON=$(ado_api GET "${ORG_URL}/${PROJECT}/_apis/git/repositories/${REPO}/items?recursionLevel=full&api-version=7.0")

# Build changes array: delete everything except README.md, then add/edit README.md
README_CONTENT=$(printf '# %s\n\nIntegration test repository for xfg.\n' "${REPO}" | base64 -w 0)

CHANGES="["

# Delete all files except README.md
ITEMS=$(printf '%s' "${ITEMS_JSON}" | jq -r '.value[]? | select(.gitObjectType == "blob") | .path')
NEEDS_CHANGES=false
while IFS= read -r item_path; do
  [ -z "${item_path}" ] && continue
  if [ "${item_path}" != "/README.md" ]; then
    if [ "${NEEDS_CHANGES}" = true ]; then
      CHANGES+=","
    fi
    CHANGES+="{\"changeType\":\"delete\",\"item\":{\"path\":\"${item_path}\"}}"
    NEEDS_CHANGES=true
  fi
done <<<"${ITEMS}"

# Add/edit README.md
if [ "${NEEDS_CHANGES}" = true ]; then
  CHANGES+=","
fi

# Check if README.md exists
HAS_README=$(printf '%s' "${ITEMS_JSON}" | jq -r '.value[]? | select(.path == "/README.md") | .path')
if [ -n "${HAS_README}" ]; then
  CHANGE_TYPE="edit"
else
  CHANGE_TYPE="add"
fi

CHANGES+="{\"changeType\":\"${CHANGE_TYPE}\",\"item\":{\"path\":\"/README.md\"},\"newContent\":{\"content\":\"${README_CONTENT}\",\"contentType\":\"base64encoded\"}}"
CHANGES+="]"

PUSH_BODY=$(
  cat <<PUSH_JSON
{
  "refUpdates": [{"name": "refs/heads/${DEFAULT_BRANCH}", "oldObjectId": "${LATEST_COMMIT}"}],
  "commits": [{"comment": "test: reset to clean state", "changes": ${CHANGES}}]
}
PUSH_JSON
)

ado_api POST "${ORG_URL}/${PROJECT}/_apis/git/repositories/${REPO}/pushes?api-version=7.0" "${PUSH_BODY}" >/dev/null
echo "  Reset ${DEFAULT_BRANCH} to README-only"

echo "=== Reset complete ==="
