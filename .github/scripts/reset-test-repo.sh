#!/usr/bin/env bash
set -euo pipefail

# Global reset script for GitHub integration tests.
# Resets a test repo to a clean state: no rulesets, no PRs, no extra branches,
# default branch contains only README.md.
#
# Usage: reset-test-repo.sh <owner/repo>
# Requires: GH_TOKEN environment variable

REPO="${1:?Usage: reset-test-repo.sh <owner/repo>}"

echo "=== Resetting ${REPO} to clean state ==="

# Auto-detect default branch
DEFAULT_BRANCH=$(gh api "repos/${REPO}" --jq '.default_branch')
echo "Default branch: ${DEFAULT_BRANCH}"

# Step 1 — Delete all rulesets
# Must run first: rulesets enforce branch protection that blocks other cleanup.
echo "Step 1: Deleting all rulesets..."
RULESET_IDS=$(gh api "repos/${REPO}/rulesets" --paginate --jq '.[].id' 2>/dev/null || true)
for id in ${RULESET_IDS}; do
  gh api --method DELETE "repos/${REPO}/rulesets/${id}" 2>/dev/null || true
  echo "  Deleted ruleset ${id}"
done

# Step 2 — Close all open PRs (with --delete-branch)
echo "Step 2: Closing all open PRs..."
PR_NUMBERS=$(gh pr list --repo "${REPO}" --state open --json number --jq '.[].number' 2>/dev/null || true)
for pr in ${PR_NUMBERS}; do
  gh pr close "${pr}" --repo "${REPO}" --delete-branch 2>/dev/null || true
  echo "  Closed PR #${pr}"
done

# Brief pause — GitHub needs time to finish deleting branch refs from PR closures
if [ -n "${PR_NUMBERS}" ]; then
  echo "  Waiting for branch deletions to propagate..."
  sleep 3
fi

# Step 3 — Delete all branches except default
echo "Step 3: Deleting all branches except ${DEFAULT_BRANCH}..."
BRANCHES=$(gh api "repos/${REPO}/branches" --paginate --jq ".[].name" 2>/dev/null || true)
for branch in ${BRANCHES}; do
  if [ "${branch}" != "${DEFAULT_BRANCH}" ]; then
    gh api --method DELETE "repos/${REPO}/git/refs/heads/${branch}" 2>/dev/null || true
    echo "  Deleted branch ${branch}"
  fi
done

# Step 4 — Reset default branch to README-only via Git Data API
echo "Step 4: Resetting ${DEFAULT_BRANCH} to README-only..."

README_CONTENT=$(printf '# xfg-test\n\nIntegration test repository for xfg.\n' | base64 -w 0)

# Try Git Data API first; falls back to Contents API for empty repos (HTTP 409)
BLOB_SHA=$(gh api "repos/${REPO}/git/blobs" \
  -f content="${README_CONTENT}" \
  -f encoding="base64" \
  --jq '.sha' 2>/dev/null) || BLOB_SHA=""

if [ -z "${BLOB_SHA}" ]; then
  # Repo is empty — bootstrap via Contents API (creates initial commit automatically)
  echo "  Repo is empty, bootstrapping via Contents API..."
  gh api --method PUT "repos/${REPO}/contents/README.md" \
    -f message="test: reset to clean state" \
    -f content="${README_CONTENT}" >/dev/null
  echo "  Bootstrapped ${DEFAULT_BRANCH} with README.md"
else
  # Create tree with only README.md
  TREE_SHA=$(
    gh api "repos/${REPO}/git/trees" \
      --input - --jq '.sha' <<TREE_JSON
{
  "tree": [
    {
      "path": "README.md",
      "mode": "100644",
      "type": "blob",
      "sha": "${BLOB_SHA}"
    }
  ]
}
TREE_JSON
  )

  # Create orphan commit (no parents)
  COMMIT_SHA=$(
    gh api "repos/${REPO}/git/commits" \
      --input - --jq '.sha' <<COMMIT_JSON
{
  "message": "test: reset to clean state",
  "tree": "${TREE_SHA}",
  "parents": []
}
COMMIT_JSON
  )

  # Force-update default branch ref
  gh api --method PATCH "repos/${REPO}/git/refs/heads/${DEFAULT_BRANCH}" \
    -f sha="${COMMIT_SHA}" \
    -F force=true >/dev/null

  echo "  Reset ${DEFAULT_BRANCH} to commit ${COMMIT_SHA}"
fi

echo "=== Reset complete ==="
