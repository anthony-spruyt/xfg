#!/usr/bin/env bash
set -euo pipefail

# Wait for an Actions secret to become visible on a repo, with exponential backoff.
# Handles GitHub API eventual consistency after secret creation.
#
# Usage: wait-for-secret.sh <owner/repo> <secret-name>
# Requires: GH_TOKEN environment variable

REPO="${1:?Usage: wait-for-secret.sh <owner/repo> <secret-name>}"
NAME="${2:?Missing secret-name}"
RETRIES=6
BASE_DELAY=2

for attempt in $(seq 1 $((RETRIES + 1))); do
  if gh api "repos/${REPO}/actions/secrets/${NAME}" --jq '.name' >/dev/null 2>&1; then
    echo "Secret ${NAME} visible in ${REPO}"
    exit 0
  fi
  if [ "$attempt" -gt "$RETRIES" ]; then
    echo "ERROR: Secret ${NAME} not visible in ${REPO} after ${RETRIES} retries" >&2
    exit 1
  fi
  DELAY=$((BASE_DELAY * (2 ** (attempt - 1))))
  echo "  Secret not visible yet (attempt $attempt/$((RETRIES + 1))), retrying in ${DELAY}s..." >&2
  sleep "$DELAY"
done
