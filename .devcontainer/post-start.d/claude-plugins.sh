#!/bin/bash
set -uo pipefail

# ~/.claude persists across rebuilds (host bind mount locally, home PVC on Coder), so `claude plugin install` never upgrades it.

command -v claude >/dev/null && command -v jq >/dev/null || exit 0
workspace="$(pwd -P)"

timeout --foreground 120 claude plugin marketplace update || echo "WARNING: marketplace update failed"

claude plugin list --json |
  jq -r --arg ws "$workspace" '.[] | select(.scope == "user" or .projectPath == $ws) | "\(.id)\t\(.scope)"' |
  sort -u | while IFS="$(printf '\t')" read -r id scope; do
  timeout --foreground 60 claude plugin update "$id" --scope "$scope" </dev/null || echo "WARNING: failed to update $id ($scope)"
done

exit 0
