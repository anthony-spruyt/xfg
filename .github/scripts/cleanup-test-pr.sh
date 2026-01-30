#!/bin/bash
# Cleanup script for integration tests - closes PRs and deletes branches
# Usage: cleanup-test-pr.sh <repo> <branch>
# Requires: GH_TOKEN environment variable

set -euo pipefail

REPO="${1:?Usage: cleanup-test-pr.sh <repo> <branch>}"
BRANCH="${2:?Usage: cleanup-test-pr.sh <repo> <branch>}"

echo "Closing any existing PRs from branch ${BRANCH}..."
PR_NUMBERS=$(gh pr list --repo "${REPO}" --head "${BRANCH}" --json number --jq '.[].number' || true)
for pr in $PR_NUMBERS; do
  echo "  Closing PR #${pr}"
  gh pr close "$pr" --repo "${REPO}" --delete-branch || true
done

echo "Deleting remote branch ${BRANCH} if exists..."
gh api --method DELETE "repos/${REPO}/git/refs/heads/${BRANCH}" 2>/dev/null || echo "  Branch does not exist"
