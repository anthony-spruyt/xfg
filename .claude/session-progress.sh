#!/bin/bash
# No ${...} here - xfg would substitute it on sync.
set -eu

common_dir() {
  local dir=$1
  git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true
}

input=$(cat)
project=$(printenv CLAUDE_PROJECT_DIR || true)
cwd=$(jq -r '.cwd // empty' <<<"$input")
session_id=$(jq -r '.session_id // empty' <<<"$input")
# The id becomes a file name, so accept only a plain identifier
[[ "$session_id" =~ ^[A-Za-z0-9_-]+$ ]] || exit 0
[[ -n "$cwd" ]] || cwd=$project
[[ -n "$cwd" ]] || exit 0
# cwd follows Claude into a worktree, but also into any other repo it cd's to
if [[ -n "$project" && "$(common_dir "$cwd")" != "$(common_dir "$project")" ]]; then
  cwd=$project
fi
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
dir="$root/.agent-progress"
file="$dir/$session_id.md"
[[ ! -L "$dir" && ! -L "$file" ]] || exit 0

# Notes written in the project checkout before cwd moved to another checkout
notes=$file
if [[ ! -s "$file" && -n "$project" ]]; then
  top=$(git -C "$project" rev-parse --show-toplevel 2>/dev/null || true)
  alt="$top/.agent-progress/$session_id.md"
  if [[ -n "$top" && "$top" != "$root" && ! -L "$top/.agent-progress" && ! -L "$alt" && -s "$alt" ]]; then
    notes=$alt
  fi
fi

if [[ ! -s "$notes" ]]; then
  printf 'Keep progress notes for this session in %s (none written yet).\n' "$file"
  exit 0
fi

if [[ "$notes" == "$file" ]]; then
  printf 'Progress notes for this session are in %s. Check them against git log before acting on them.\n\n' "$notes"
else
  printf 'Progress notes for this session are in %s (this checkout would use %s). Check them against git log before acting on them.\n\n' "$notes" "$file"
fi
# Hook output is capped at 10,000 characters
head -c 9000 "$notes"
if [[ "$(wc -c <"$notes")" -gt 9000 ]]; then
  printf '\n\n[truncated - read the rest of %s]\n' "$notes"
fi
