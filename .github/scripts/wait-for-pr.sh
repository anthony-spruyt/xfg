#!/usr/bin/env bash
set -euo pipefail

# Wait for a PR to become visible via gh pr list, with exponential backoff.
# Handles GitHub API eventual consistency after PR creation.
#
# Usage: wait-for-pr.sh <owner/repo> <head-branch>
# Outputs: JSON object of the first matching PR on success
# Requires: GH_TOKEN environment variable

REPO="${1:?Usage: wait-for-pr.sh <owner/repo> <head-branch>}"
HEAD="${2:?Missing head-branch}"
RETRIES=6
BASE_DELAY=2

for attempt in $(seq 1 $((RETRIES + 1))); do
  PR_INFO=$(gh pr list --repo "$REPO" --head "$HEAD" --json number,title,url --jq '.[0]')
  if [ -n "$PR_INFO" ]; then
    echo "$PR_INFO"
    exit 0
  fi
  if [ "$attempt" -gt "$RETRIES" ]; then
    echo "ERROR: PR on branch $HEAD not visible in $REPO after $RETRIES retries" >&2
    exit 1
  fi
  DELAY=$((BASE_DELAY * (2 ** (attempt - 1))))
  echo "  PR not visible yet (attempt $attempt/$((RETRIES + 1))), retrying in ${DELAY}s..." >&2
  sleep "$DELAY"
done
