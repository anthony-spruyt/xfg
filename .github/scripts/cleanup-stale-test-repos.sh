#!/usr/bin/env bash
set -euo pipefail

# Delete ephemeral integration test repos left behind by crashed or cancelled runs.
#
# Usage: cleanup-stale-test-repos.sh <owner> [max-age-hours] [--dry-run]
# Requires: GH_TOKEN with delete_repo scope for <owner>

OWNER="${1:?Usage: cleanup-stale-test-repos.sh <owner> [max-age-hours] [--dry-run]}"
MAX_AGE_HOURS="${2:-6}"
DRY_RUN="${3:-}"

# Age guard keeps repos that an in-flight test run is still using
CUTOFF=$(date -u -d "-${MAX_AGE_HOURS} hours" +%Y-%m-%dT%H:%M:%SZ)

STALE=$(gh repo list "${OWNER}" --limit 1000 --json name,createdAt \
  --jq ".[] | select(.name | test(\"^xfg-.+-test-[0-9]+-[0-9a-f]{6}$\")) | select(.createdAt < \"${CUTOFF}\") | .name")

if [ -z "${STALE}" ]; then
  echo "No stale test repos in ${OWNER}"
  exit 0
fi

FAILED=0
while IFS= read -r NAME; do
  if [ "${DRY_RUN}" = "--dry-run" ]; then
    echo "Would delete ${OWNER}/${NAME}"
  elif gh repo delete --yes "${OWNER}/${NAME}"; then
    echo "Deleted ${OWNER}/${NAME}"
  else
    echo "::warning::Failed to delete ${OWNER}/${NAME}"
    FAILED=1
  fi
done <<<"${STALE}"

exit "${FAILED}"
