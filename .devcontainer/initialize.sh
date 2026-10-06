#!/bin/bash
set -euo pipefail

# Stable agent.sock symlink so the devcontainer mounts one path on any host OS.

AGENT_SOCK="$HOME/.ssh/agent.sock"

mkdir -p "$HOME/.ssh"

case "$(uname -s)" in
Darwin)
  SOCK="${SSH_AUTH_SOCK:-$(launchctl getenv SSH_AUTH_SOCK 2>/dev/null || true)}"
  if [[ -z "$SOCK" || ! -S "$SOCK" ]]; then
    echo "ERROR: No SSH agent socket found on macOS." >&2
    echo "Run: ssh-add --apple-use-keychain ~/.ssh/id_ed25519" >&2
    exit 1
  fi
  rm -f "$AGENT_SOCK"
  ln -sf "$SOCK" "$AGENT_SOCK"
  echo "SSH agent socket linked (macOS): $SOCK -> $AGENT_SOCK"
  ;;
Linux)
  if ! command -v keychain &>/dev/null; then
    echo "ERROR: keychain not found. Install with: sudo apt install keychain" >&2
    exit 1
  fi
  eval "$(keychain --eval --agents ssh id_ed25519)"
  flock -x "$HOME/.ssh/agent.lock" -c "rm -f '$AGENT_SOCK'; ln -sf '$SSH_AUTH_SOCK' '$AGENT_SOCK'"
  echo "SSH agent socket linked (Linux): $SSH_AUTH_SOCK -> $AGENT_SOCK"
  ;;
*)
  echo "ERROR: Unsupported OS: $(uname -s)" >&2
  echo "Manually create symlink: ln -sf \$SSH_AUTH_SOCK ~/.ssh/agent.sock" >&2
  exit 1
  ;;
esac
