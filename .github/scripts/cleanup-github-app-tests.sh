#!/usr/bin/env bash
set -euo pipefail

# Cleanup + validation for GitHub App integration tests.
# Runs with GH_TOKEN (PAT) — completely separate from the test step.

TEST_REPO="anthony-spruyt/xfg-test"
SYNC_BRANCH="chore/sync-github-app-test"
DIRECT_FILE="github-app-direct-test.json"
TARGET_FILE="github-app-test.json"
ORPHAN_FILE="github-app-orphan-test.json"
REMAINING_FILE="github-app-remaining.json"
MANIFEST_FILE=".xfg.json"
RULESET_NAME="xfg-app-bypass-test"

ERRORS=0

echo "=== Validating GitHub App integration test results ==="

# 1. Validate sync test — PR should exist with App commit author
echo "Checking sync test PR..."
PR_INFO=$(gh pr list --repo "${TEST_REPO}" --head "${SYNC_BRANCH}" --json number --jq '.[0].number' 2>/dev/null || true)
if [ -n "${PR_INFO}" ]; then
  echo "  PR #${PR_INFO} exists"
  COMMIT_SHA=$(gh api "repos/${TEST_REPO}/commits/${SYNC_BRANCH}" --jq '.sha' 2>/dev/null || true)
  if [ -n "${COMMIT_SHA}" ]; then
    AUTHOR=$(gh api "repos/${TEST_REPO}/commits/${COMMIT_SHA}" --jq '.commit.author.name' 2>/dev/null || true)
    echo "  Commit author: ${AUTHOR}"
    if [ "${AUTHOR}" = "github-actions[bot]" ]; then
      echo "  ERROR: Commit author is github-actions[bot] — PAT leaked into App test"
      ERRORS=$((ERRORS + 1))
    fi
    VERIFIED=$(gh api "repos/${TEST_REPO}/commits/${COMMIT_SHA}" --jq '.commit.verification.verified' 2>/dev/null || true)
    echo "  Commit verified: ${VERIFIED}"
    if [ "${VERIFIED}" != "true" ]; then
      echo "  ERROR: Commit is not verified"
      ERRORS=$((ERRORS + 1))
    fi
  fi
else
  echo "  WARNING: No sync PR found (test may have been skipped)"
fi

# 2. Validate direct mode — check commit on main
echo "Checking direct mode commit..."
DIRECT_SHA=$(gh api "repos/${TEST_REPO}/contents/${DIRECT_FILE}" --jq '.sha' 2>/dev/null || true)
if [ -n "${DIRECT_SHA}" ]; then
  MAIN_SHA=$(gh api "repos/${TEST_REPO}/commits/main" --jq '.sha' 2>/dev/null || true)
  AUTHOR=$(gh api "repos/${TEST_REPO}/commits/${MAIN_SHA}" --jq '.commit.author.name' 2>/dev/null || true)
  echo "  Direct mode commit author: ${AUTHOR}"
  if [ "${AUTHOR}" = "github-actions[bot]" ]; then
    echo "  ERROR: Direct mode commit author is github-actions[bot]"
    ERRORS=$((ERRORS + 1))
  fi
fi

echo ""
echo "=== Cleaning up ==="

# 3. Delete test rulesets first (they enforce branch protection that blocks file deletion)
RULESET_IDS=$(gh api "repos/${TEST_REPO}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id" 2>/dev/null || true)
for id in ${RULESET_IDS}; do
  gh api --method DELETE "repos/${TEST_REPO}/rulesets/${id}" 2>/dev/null || true
  echo "  Deleted ruleset ${id}"
done

# 4. Close PRs and delete branch
echo "Closing PRs..."
PR_NUMBERS=$(gh pr list --repo "${TEST_REPO}" --head "${SYNC_BRANCH}" --json number --jq '.[].number' 2>/dev/null || true)
for pr in ${PR_NUMBERS}; do
  gh pr close "${pr}" --repo "${TEST_REPO}" --delete-branch 2>/dev/null || true
  echo "  Closed PR #${pr}"
done
gh api --method DELETE "repos/${TEST_REPO}/git/refs/heads/${SYNC_BRANCH}" 2>/dev/null || true

# 5. Delete test files
for file in "${TARGET_FILE}" "${DIRECT_FILE}" "${ORPHAN_FILE}" "${REMAINING_FILE}" "${MANIFEST_FILE}"; do
  SHA=$(gh api "repos/${TEST_REPO}/contents/${file}" --jq '.sha' 2>/dev/null || true)
  if [ -n "${SHA}" ]; then
    gh api --method DELETE "repos/${TEST_REPO}/contents/${file}" \
      -f message="test: cleanup ${file}" \
      -f sha="${SHA}" 2>/dev/null || true
    echo "  Deleted ${file}"
  fi
done

echo ""
if [ "${ERRORS}" -gt 0 ]; then
  echo "=== VALIDATION FAILED: ${ERRORS} error(s) ==="
  exit 1
fi
echo "=== Cleanup complete ==="
