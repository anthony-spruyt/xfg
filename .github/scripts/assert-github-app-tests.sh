#!/usr/bin/env bash
set -euo pipefail

# Assert step for GitHub App integration tests.
# Validates results using GH_TOKEN (PAT) — completely separate from the test step.

TEST_REPO="anthony-spruyt/xfg-test"
SYNC_BRANCH="chore/sync-github-app-test"
DIRECT_FILE="github-app-direct-test.json"

ERRORS=0

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
  VERIFIED=$(gh api "repos/${TEST_REPO}/commits/${MAIN_SHA}" --jq '.commit.verification.verified' 2>/dev/null || true)
  echo "  Direct mode commit verified: ${VERIFIED}"
  if [ "${VERIFIED}" != "true" ]; then
    echo "  ERROR: Direct mode commit is not verified"
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
