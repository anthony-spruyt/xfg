#!/bin/bash
set -uo pipefail

# Runs every .devcontainer/post-start.d/*.sh from the workspace root. A failing hook only warns, so startup never blocks.

cd "$(dirname "$0")/.." || exit 0

# envbuilder (Coder) runs this without ~/.bashrc, where ~/.local/bin joins PATH
export PATH="$HOME/.local/bin:$PATH"

shopt -s nullglob
for hook in .devcontainer/post-start.d/*.sh; do
  echo "post-start: $hook"
  bash "$hook" || echo "WARNING: $hook failed"
done

exit 0
