#!/bin/bash
# Delete .xfg.json manifest from test repo
# Usage: delete-manifest.sh <repo>
# Requires: GH_TOKEN environment variable

set -euo pipefail

REPO="${1:?Usage: delete-manifest.sh <repo>}"

echo "Deleting manifest..."
SHA=$(gh api "repos/${REPO}/contents/.xfg.json" --jq '.sha' 2>/dev/null || true)
if [ -n "$SHA" ]; then
  gh api --method DELETE "repos/${REPO}/contents/.xfg.json" \
    -f message="test: cleanup seeded manifest" \
    -f sha="$SHA" || true
  echo "Manifest deleted"
else
  echo "Manifest does not exist"
fi
