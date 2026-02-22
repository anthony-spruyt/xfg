#!/bin/bash
set -euo pipefail

# Cross-platform SSH agent socket setup for devcontainer.
# Creates a stable symlink at ~/.ssh/agent.sock so the devcontainer
# can mount a consistent path regardless of the host OS.

AGENT_SOCK="$HOME/.ssh/agent.sock"

mkdir -p "$HOME/.ssh"

case "$(uname -s)" in
Darwin)
  # macOS: SSH agent is managed by launchd. Find the socket.
  SOCK="$(launchctl getenv SSH_AUTH_SOCK 2>/dev/null || true)"
  if [ -z "$SOCK" ] || [ ! -S "$SOCK" ]; then
    echo "ERROR: No SSH agent socket found on macOS."
    echo "Run: ssh-add --apple-use-keychain ~/.ssh/id_ed25519"
    exit 1
  fi
  rm -f "$AGENT_SOCK"
  ln -sf "$SOCK" "$AGENT_SOCK"
  echo "SSH agent socket linked (macOS): $SOCK -> $AGENT_SOCK"
  ;;
Linux)
  # Linux/WSL: Use keychain to manage the SSH agent.
  # Requires: sudo apt install keychain (or equivalent)
  if ! command -v keychain &>/dev/null; then
    echo "ERROR: keychain not found. Install with: sudo apt install keychain"
    exit 1
  fi
  eval "$(keychain --eval --agents ssh id_ed25519)"
  flock -x "$HOME/.ssh/agent.lock" -c "rm -f '$AGENT_SOCK'; ln -sf '$SSH_AUTH_SOCK' '$AGENT_SOCK'"
  echo "SSH agent socket linked (Linux): $SSH_AUTH_SOCK -> $AGENT_SOCK"
  ;;
*)
  echo "ERROR: Unsupported OS: $(uname -s)"
  echo "Manually create symlink: ln -sf \$SSH_AUTH_SOCK ~/.ssh/agent.sock"
  exit 1
  ;;
esac
