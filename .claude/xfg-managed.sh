#!/bin/bash
# No ${...} here - xfg would substitute it on sync.
# Usage: xfg-managed.sh check <path> | hook (PreToolUse JSON on stdin) | staged
set -eu

list_url=$(printenv XFG_MANAGED_URL || echo https://raw.githubusercontent.com/anthony-spruyt/repo-operator/main/.github/xfg-managed.json)
ttl=$(printenv XFG_MANAGED_TTL || echo 900)
self_repo=anthony-spruyt/repo-operator

repo_name() {
  local dir=$1
  git -C "$dir" remote get-url origin 2>/dev/null |
    sed -nE 's#^(https://|ssh://git@|git@)github\.com[:/]([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$#\2#p' |
    sed 's/\.git$//'
}

cached_list() {
  local common cache tmp
  common=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)
  cache="$common/xfg-managed.json"
  if [[ ! -f "$cache" || $(($(date +%s) - $(stat -c %Y "$cache"))) -ge "$ttl" ]]; then
    tmp=$(mktemp "$common/xfg-managed.XXXXXX")
    if curl -fsSL --max-time 5 "$list_url" -o "$tmp" 2>/dev/null && jq -e 'type == "object"' "$tmp" >/dev/null 2>&1; then
      mv "$tmp" "$cache"
    else
      rm -f "$tmp"
    fi
  fi
  [[ -f "$cache" ]] && echo "$cache"
}

managed_files() {
  local repo list
  repo=$(repo_name "$1")
  [[ -n "$repo" ]] || return 0
  list=$(cached_list "$1") || return 0
  jq -r --arg r "$repo" '.[$r] // [] | .[]' "$list"
}

existing_dir() {
  local dir=$1
  while [[ ! -d "$dir" ]]; do dir=$(dirname "$dir"); done
  echo "$dir"
}

locate() {
  local abs root
  abs=$(realpath -m "$1")
  root=$(git -C "$(existing_dir "$(dirname "$abs")")" rev-parse --show-toplevel 2>/dev/null) || return 0
  printf '%s\t%s\n' "$root" "$(realpath -m --relative-to="$root" "$abs")"
}

is_managed() {
  local root=$1 rel=$2
  managed_files "$root" | grep -qxF -- "$rel"
}

explain() {
  local root=$1 rel=$2
  if [[ "$(repo_name "$root")" == "$self_repo" ]]; then
    printf '%s is synced here by XFG Apply. Edit its source in src/ instead (usually src/templates/%s, or src/*.yaml).\n' "$rel" "$rel"
  else
    printf '%s is managed by %s: xfg overwrites it on every sync, so a change made here is lost. Change it in %s instead (usually src/templates/%s, or src/*.yaml).\n' "$rel" "$self_repo" "$self_repo" "$rel"
  fi
}

# shellcheck disable=SC2001,SC2016
ere_escape() {
  local text=$1
  sed 's#[]\.[*^$()+?{}|]#\\&#g' <<<"$text"
}

block_managed_writes() {
  local root=$1 cmd=$2 files pairs segments seg first second last p re before after redirect in_place
  files=$(managed_files "$root")
  [[ -n "$files" ]] || return 0
  pairs=$(paste <(echo "$files") <(ere_escape "$files"))
  cmd=$(awk -v r="$root/" '{ while ((i = index($0, r)) > 0) $0 = substr($0, 1, i - 1) substr($0, i + length(r)); print }' <<<"$cmd")
  segments=$(sed -E "s#(^|[[:space:]\"'=])\./#\1#g; s/&&|\|\|/\n/g; s/>\|/>/g; s/[|;]/\n/g" <<<"$cmd")
  before="(^|[[:space:]\"'=])"
  after="(\$|[[:space:]\"';)<>|&])"
  redirect="(>|&>|of=)[[:space:]]*[\"']?"
  in_place="[[:space:]](-[a-zA-Z]*i|--in-place)"
  while IFS= read -r seg; do
    seg=$(sed -E 's/^[[:space:](){]*//; s/^sudo[[:space:]]+//; s/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*//' <<<"$seg")
    read -r first second _ <<<"$seg" || true
    last=$(awk '{ print $NF }' <<<"$seg" | tr -d "\"'")
    while IFS=$'\t' read -r p re; do
      if [[ $seg =~ $redirect$re$after ]]; then
        explain "$root" "$p" >&2
        exit 2
      fi
      [[ $seg =~ $before$re$after ]] || continue
      case "$first" in
      sed | perl) [[ $seg =~ $in_place ]] || continue ;;
      tee | rm | truncate | unlink | shred | mv) ;;
      cp | install | ln | rsync) [[ "$last" == "$p" ]] || continue ;;
      git) [[ "$second" == rm || "$second" == mv ]] || continue ;;
      *) continue ;;
      esac
      explain "$root" "$p" >&2
      exit 2
    done <<<"$pairs"
  done <<<"$segments"
}

run_hook() {
  local input tool cwd path root rel
  input=$(cat)
  tool=$(jq -r '.tool_name // empty' <<<"$input")
  cwd=$(jq -r '.cwd // empty' <<<"$input")
  [[ -n "$cwd" ]] || cwd=$PWD
  case "$tool" in
  Edit | MultiEdit | Write | NotebookEdit)
    path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")
    [[ -n "$path" ]] || exit 0
    [[ "$path" == /* ]] || path="$cwd/$path"
    IFS=$'\t' read -r root rel < <(locate "$path") || exit 0
    if is_managed "$root" "$rel"; then
      explain "$root" "$rel" >&2
      exit 2
    fi
    ;;
  Bash)
    root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
    block_managed_writes "$root" "$(jq -r '.tool_input.command // empty' <<<"$input")"
    ;;
  *) ;;
  esac
  exit 0
}

run_staged() {
  local root files rel failed=0
  root=$(git rev-parse --show-toplevel)
  files=$(managed_files "$root")
  [[ -n "$files" ]] || exit 0
  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    if grep -qxF -- "$rel" <<<"$files"; then
      explain "$root" "$rel" >&2
      failed=1
    fi
  done < <(git -C "$root" diff --cached --name-only --no-renames)
  exit "$failed"
}

case "$1" in
check)
  if IFS=$'\t' read -r root rel < <(locate "$2") && is_managed "$root" "$rel"; then
    echo yes
  else
    echo no
  fi
  ;;
hook) run_hook ;;
staged) run_staged ;;
*)
  echo "usage: xfg-managed.sh check <path> | hook | staged" >&2
  exit 64
  ;;
esac
