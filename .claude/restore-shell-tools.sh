#!/bin/bash
# No ${...} here - xfg would substitute it on sync.
# Workaround for anthropics/claude-code#69736 (grep/find shadowed by ugrep/bfs); remove once an opt-out ships.
set -eu

file=$(printenv CLAUDE_ENV_FILE || true)
[[ -n "$file" ]] || exit 0
line='unset -f grep find 2>/dev/null || true'

if [[ -f "$file" ]]; then
  while IFS= read -r existing || [[ -n "$existing" ]]; do
    [[ "$existing" != "$line" ]] || exit 0
  done <"$file"
  # A file without a trailing newline would glue the line onto its last one
  if [[ -s "$file" && -n "$(tail -c1 "$file")" ]]; then
    printf '\n' >>"$file"
  fi
fi
printf '%s\n' "$line" >>"$file"
