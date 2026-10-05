#!/bin/bash
set -uo pipefail

# ~/.claude.json sits outside the persisted ~/.claude, so every rebuild brings back the first-run, folder-trust and auto-mode screens.

command -v jq >/dev/null || exit 0
workspace="$(pwd -P)"
state="$HOME/.claude.json"

[ -s "$state" ] || (umask 077; echo '{}' >"$state")
if ! { jq --arg d "$workspace" '.hasCompletedOnboarding = true | .hasSeenAutoDefaultNudge = true | .projects[$d].hasTrustDialogAccepted = true' "$state" >"$state.tmp" &&
  chmod 600 "$state.tmp" && mv "$state.tmp" "$state"; }; then
  rm -f "$state.tmp"
  echo "WARNING: could not update $state"
fi

exit 0
