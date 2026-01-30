#!/bin/bash
# Seed .xfg.json manifest in test repo to trigger update path (bug #268)
# Usage: seed-manifest.sh <repo>
# Requires: GH_TOKEN environment variable

set -euo pipefail

REPO="${1:?Usage: seed-manifest.sh <repo>}"

# Create .xfg.json manifest so xfg will UPDATE it (not create)
# Bug #268 only manifests when updating an existing manifest
# Structure: configs[configId] = string[] (array of filenames directly)
MANIFEST='{"version":2,"configs":{"integration-test-action-github":["action-test.json"]}}'

# Check if manifest exists, create or update it
SHA=$(gh api "repos/${REPO}/contents/.xfg.json" --jq '.sha' 2>/dev/null || true)
if [ -n "$SHA" ]; then
  echo "Manifest exists, updating..."
  gh api --method PUT "repos/${REPO}/contents/.xfg.json" \
    -f message="test: seed manifest for bug #268 test" \
    -f content="$(echo "$MANIFEST" | base64 -w0)" \
    -f sha="$SHA"
else
  echo "Creating manifest..."
  gh api --method PUT "repos/${REPO}/contents/.xfg.json" \
    -f message="test: seed manifest for bug #268 test" \
    -f content="$(echo "$MANIFEST" | base64 -w0)"
fi
