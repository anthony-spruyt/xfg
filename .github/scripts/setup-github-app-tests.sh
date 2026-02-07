#!/usr/bin/env bash
set -euo pipefail

# Setup for GitHub App integration tests.
# Runs with GH_TOKEN (PAT) — completely separate from the test step.

TEST_REPO="anthony-spruyt/xfg-test"
SYNC_BRANCH="chore/sync-github-app-test"
DIRECT_FILE="github-app-direct-test.json"
TARGET_FILE="github-app-test.json"
ORPHAN_FILE="github-app-orphan-test.json"
REMAINING_FILE="github-app-remaining.json"
MANIFEST_FILE=".xfg.json"
RULESET_NAME="xfg-app-bypass-test"

echo "=== Setting up GitHub App integration tests ==="

# 1. Delete test rulesets first (they enforce branch protection that blocks file deletion)
echo "Cleaning up test rulesets..."
RULESET_IDS=$(gh api "repos/${TEST_REPO}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id" 2>/dev/null || true)
if [ -n "${RULESET_IDS}" ]; then
  for id in ${RULESET_IDS}; do
    echo "  Deleting ruleset ${id}"
    gh api --method DELETE "repos/${TEST_REPO}/rulesets/${id}" 2>/dev/null || true
  done
else
  echo "  No test rulesets found"
fi

# 2. Close any existing PRs from the sync branch
echo "Closing any existing PRs for ${SYNC_BRANCH}..."
PR_NUMBERS=$(gh pr list --repo "${TEST_REPO}" --head "${SYNC_BRANCH}" --json number --jq '.[].number' 2>/dev/null || true)
if [ -n "${PR_NUMBERS}" ]; then
  for pr in ${PR_NUMBERS}; do
    echo "  Closing PR #${pr}"
    gh pr close "${pr}" --repo "${TEST_REPO}" --delete-branch 2>/dev/null || true
  done
else
  echo "  No existing PRs found"
fi

# 3. Delete the sync branch if it exists
echo "Deleting remote branch ${SYNC_BRANCH} if exists..."
gh api --method DELETE "repos/${TEST_REPO}/git/refs/heads/${SYNC_BRANCH}" 2>/dev/null || echo "  Branch does not exist"

# 4. Delete test files if they exist
for file in "${TARGET_FILE}" "${DIRECT_FILE}" "${ORPHAN_FILE}" "${REMAINING_FILE}" "${MANIFEST_FILE}"; do
  echo "Checking ${file}..."
  SHA=$(gh api "repos/${TEST_REPO}/contents/${file}" --jq '.sha' 2>/dev/null || true)
  if [ -n "${SHA}" ]; then
    echo "  Deleting ${file}..."
    gh api --method DELETE "repos/${TEST_REPO}/contents/${file}" \
      -f message="test: cleanup ${file} for integration test" \
      -f sha="${SHA}" 2>/dev/null || true
  else
    echo "  ${file} does not exist"
  fi
done

echo "=== Setup complete ==="
