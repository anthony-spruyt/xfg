#!/usr/bin/env bash
set -euo pipefail

# Assert step for GitHub App integration tests.
# Validates results using GH_TOKEN (PAT) — completely separate from the test step.

TEST_REPO="anthony-spruyt/xfg-test-2"
SYNC_BRANCH="chore/sync-github-app-test"
DIRECT_FILE="github-app-direct-test.json"
MAX_RETRIES=10
RETRY_DELAY=3

ERRORS=0

# Poll until a commit's verification.verified field returns "true".
# GitHub's API has eventual consistency — verification metadata may lag.
wait_for_verified() {
  local sha="$1"
  local label="$2"
  for i in $(seq 1 "${MAX_RETRIES}"); do
    VERIFIED=$(gh api "repos/${TEST_REPO}/commits/${sha}" --jq '.commit.verification.verified' 2>/dev/null || true)
    if [ "${VERIFIED}" = "true" ]; then
      echo "  ${label} verified: true (attempt ${i})"
      return 0
    fi
    echo "  ${label} verified: ${VERIFIED} (attempt ${i}/${MAX_RETRIES}, retrying in ${RETRY_DELAY}s...)"
    sleep "${RETRY_DELAY}"
  done
  echo "  ERROR: ${label} is not verified after ${MAX_RETRIES} attempts"
  return 1
}

echo "=== Validating GitHub App integration test results ==="

# 1. Validate sync test — PR should exist with App commit author and verified
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
    if ! wait_for_verified "${COMMIT_SHA}" "Sync commit"; then
      ERRORS=$((ERRORS + 1))
    fi
  fi
else
  echo "  WARNING: No sync PR found (test may have been skipped)"
fi

# 2. Validate direct mode — commit on main should be verified and authored by App
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
  if ! wait_for_verified "${MAIN_SHA}" "Direct mode commit"; then
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "  WARNING: Direct mode file not found (test may have been skipped)"
fi

echo ""
if [ "${ERRORS}" -gt 0 ]; then
  echo "=== VALIDATION FAILED: ${ERRORS} error(s) ==="
  exit 1
fi
echo "=== All validations passed ==="
