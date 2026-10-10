#!/bin/bash
# No ${...} here - xfg would substitute it on sync.
set -eu

common_dir() {
  local dir=$1
  git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true
}

project=$(printenv CLAUDE_PROJECT_DIR || true)
cwd=$(jq -r '.cwd // empty')
[[ -n "$cwd" ]] || cwd=$project
[[ -n "$cwd" ]] || exit 0
# cwd follows Claude into a worktree, but also into any other repo it cd's to
if [[ -n "$project" && "$(common_dir "$cwd")" != "$(common_dir "$project")" ]]; then
  cwd=$project
fi
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
branch=$(git -C "$root" branch --show-current)
[[ -n "$branch" ]] || exit 0

file="$root/.agent-progress/$(printf '%s' "$branch" | tr '/' '-').md"
[[ -s "$file" ]] || exit 0

printf 'Progress notes for branch %s from an earlier session (%s). Check them against git log before acting on them.\n\n' "$branch" "$file"
# Hook output is capped at 10,000 characters
head -c 9000 "$file"
if [[ "$(wc -c <"$file")" -gt 9000 ]]; then
  printf '\n\n[truncated - read the rest of %s]\n' "$file"
fi
