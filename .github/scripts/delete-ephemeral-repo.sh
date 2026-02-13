#!/usr/bin/env bash
set -euo pipefail

# Delete an ephemeral test repo. Silently ignores if already deleted / not found.
# Intended for cleanup steps (if: always()) in CI.
#
# Usage: delete-ephemeral-repo.sh <owner/repo>
# Requires: GH_TOKEN environment variable

REPO="${1:-}"

if [ -z "${REPO}" ]; then
  echo "No repo to delete"
  exit 0
fi

echo "Cleaning up ${REPO}..."
gh repo delete --yes "${REPO}" 2>/dev/null &&
  echo "Deleted ${REPO}" ||
  echo "Repo ${REPO} already deleted or not found"
