#!/usr/bin/env bash
set -euo pipefail

# Cleanup for GitHub App integration tests.
# Runs with GH_TOKEN (PAT), always() — tears down test state regardless of pass/fail.

TEST_REPO="anthony-spruyt/xfg-test"
SYNC_BRANCH="chore/sync-github-app-test"
DIRECT_FILE="github-app-direct-test.json"
TARGET_FILE="github-app-test.json"
ORPHAN_FILE="github-app-orphan-test.json"
REMAINING_FILE="github-app-remaining.json"
MANIFEST_FILE=".xfg.json"
RULESET_NAME="xfg-app-bypass-test"

echo "=== Cleaning up GitHub App integration tests ==="

# 1. Delete test rulesets first (they enforce branch protection that blocks file deletion)
echo "Deleting test rulesets..."
RULESET_IDS=$(gh api "repos/${TEST_REPO}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id" 2>/dev/null || true)
for id in ${RULESET_IDS}; do
  gh api --method DELETE "repos/${TEST_REPO}/rulesets/${id}" 2>/dev/null || true
  echo "  Deleted ruleset ${id}"
done

# 2. Close PRs and delete branch
echo "Closing PRs..."
PR_NUMBERS=$(gh pr list --repo "${TEST_REPO}" --head "${SYNC_BRANCH}" --json number --jq '.[].number' 2>/dev/null || true)
for pr in ${PR_NUMBERS}; do
  gh pr close "${pr}" --repo "${TEST_REPO}" --delete-branch 2>/dev/null || true
  echo "  Closed PR #${pr}"
done
gh api --method DELETE "repos/${TEST_REPO}/git/refs/heads/${SYNC_BRANCH}" 2>/dev/null || true

# 3. Delete test files
echo "Deleting test files..."
for file in "${TARGET_FILE}" "${DIRECT_FILE}" "${ORPHAN_FILE}" "${REMAINING_FILE}" "${MANIFEST_FILE}"; do
  SHA=$(gh api "repos/${TEST_REPO}/contents/${file}" --jq '.sha' 2>/dev/null || true)
  if [ -n "${SHA}" ]; then
    gh api --method DELETE "repos/${TEST_REPO}/contents/${file}" \
      -f message="test: cleanup ${file}" \
      -f sha="${SHA}" 2>/dev/null || true
    echo "  Deleted ${file}"
  fi
done

echo "=== Cleanup complete ==="
