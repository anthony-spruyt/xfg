#!/usr/bin/env bash
set -euo pipefail

# This file is automatically updated - do not modify directly

# Apply repository rulesets from .github/rulesets/*.json
# Requires: gh CLI authenticated with repo admin permissions

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# Validate REPO format to prevent injection
if ! echo "$REPO" | grep -qE '^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$'; then
  echo "Error: Invalid repository format: $REPO" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESETS_DIR="$SCRIPT_DIR/rulesets"

echo "Applying rulesets to $REPO..."

for ruleset in "$RULESETS_DIR"/*.json; do
  if [ -f "$ruleset" ]; then
    name=$(basename "$ruleset" .json)
    echo "  Applying ruleset: $name"

    # Check if ruleset already exists (using --arg to prevent jq injection)
    existing=$(gh api "repos/$REPO/rulesets" 2>/dev/null | jq -r --arg name "$name" '.[] | select(.name == $name) | .id' || true)

    if [ -n "$existing" ]; then
      echo "    Updating existing ruleset (ID: $existing)"
      gh api "repos/$REPO/rulesets/$existing" -X PUT --input "$ruleset"
    else
      echo "    Creating new ruleset"
      gh api "repos/$REPO/rulesets" -X POST --input "$ruleset"
    fi
  fi
done

echo "Done. Rulesets applied successfully."
