#!/bin/bash
# No ${...} here - xfg would substitute it on sync.
set -uo pipefail

# ~/.claude persists across rebuilds (host bind mount locally, home PVC on Coder), so `claude plugin install` never upgrades it.
# A restarted container skips post-create, so plugins enabled since then are installed here, mirroring its bootstrap rules.

command -v claude >/dev/null && command -v jq >/dev/null || exit 0
workspace="$(pwd -P)"

known_marketplaces=""
installed_plugins=""
added_repos=""
new_plugins=""
refreshed_marketplaces=""

claude_timed() {
  timeout --foreground 120 claude "$@" </dev/null
  return $?
}

any_path_exists() {
  local path found=1
  while IFS= read -r path; do
    if [[ -n "$path" && -e "$path" ]]; then
      found=0
    fi
  done
  return "$found"
}

marketplace_known() {
  local repo="$1"
  grep -qxF -- "$repo" <<<"$added_repos" && return 0
  [[ -n "$known_marketplaces" ]] || known_marketplaces=$(claude_timed plugin marketplace list --json 2>/dev/null) || known_marketplaces='[]'
  jq -r --arg r "$repo" '.[] | select(.repo == $r) | .installLocation // empty' <<<"$known_marketplaces" 2>/dev/null | any_path_exists
}

plugin_installed() {
  local plugin="$1" project_scope_counts="$2"
  grep -qxF -- "$plugin" <<<"$new_plugins" && return 0
  [[ -n "$installed_plugins" ]] || installed_plugins=$(claude_timed plugin list --json 2>/dev/null) || installed_plugins='[]'
  jq -r --arg p "$plugin" --arg w "$workspace" --argjson project "$project_scope_counts" \
    '.[] | select(.id == $p and (.scope == "user" or ($project and .projectPath == $w))) | .installPath // empty' <<<"$installed_plugins" 2>/dev/null | any_path_exists
}

install_plugin() {
  local plugin="$1" marketplace
  IFS=@ read -r _ marketplace <<<"$plugin"
  claude_timed plugin install "$plugin" --scope user && return 0
  # A marketplace clone kept from an earlier run can predate the plugin
  grep -qxF -- "$marketplace" <<<"$refreshed_marketplaces" && return 1
  refreshed_marketplaces+="$marketplace"$'\n'
  echo "  refreshing marketplace '$marketplace' and retrying"
  claude_timed plugin marketplace update "$marketplace" && claude_timed plugin install "$plugin" --scope user
}

add_missing_marketplaces() {
  local settings_file="$1" marketplaces name repo
  marketplaces=$(jq -r '.extraKnownMarketplaces // {} | to_entries[] | select(.key != "claude-plugins-official") | select(.value.source != null and .value.source.repo != null) | "\(.key)\t\(.value.source.repo)"' "$settings_file" 2>/dev/null) || {
    echo "WARNING: unexpected extraKnownMarketplaces shape in $settings_file, skipping marketplaces"
    return 0
  }
  [[ -n "$marketplaces" ]] || return 0
  while IFS=$'\t' read -r name repo; do
    marketplace_known "$repo" && continue
    echo "  adding marketplace $name ($repo)"
    if claude_timed plugin marketplace add "$repo" --scope user; then
      added_repos+="$repo"$'\n'
      refreshed_marketplaces+="$name"$'\n'
    else
      echo "WARNING: failed to add marketplace '$name'"
    fi
  done <<<"$marketplaces"
  return 0
}

install_missing_plugins() {
  local settings_file="$1" project_scope_counts="$2" plugins plugin
  plugins=$(jq -r '.enabledPlugins // {} | to_entries[] | select(.value == true or .value == "true") | select(.key | endswith("@claude-plugins-official") | not) | .key' "$settings_file" 2>/dev/null) || {
    echo "WARNING: unexpected enabledPlugins shape in $settings_file, skipping plugins"
    return 0
  }
  [[ -n "$plugins" ]] || return 0
  while IFS= read -r plugin; do
    plugin_installed "$plugin" "$project_scope_counts" && continue
    echo "  installing $plugin"
    if install_plugin "$plugin"; then
      new_plugins+="$plugin"$'\n'
    else
      echo "WARNING: failed to install $plugin"
    fi
  done <<<"$plugins"
  return 0
}

bootstrap_plugins() {
  local settings_file="$1" project_scope_counts="$2"
  [[ -f "$settings_file" ]] || return 0
  jq empty "$settings_file" 2>/dev/null || {
    echo "WARNING: invalid JSON in $settings_file, skipping"
    return 0
  }
  add_missing_marketplaces "$settings_file"
  install_missing_plugins "$settings_file" "$project_scope_counts"
  return 0
}

bootstrap_plugins "$HOME/.claude/settings.json" false
bootstrap_plugins "$workspace/.claude/settings.json" true
bootstrap_plugins "$workspace/.claude/settings.local.json" true

timeout --foreground 120 claude plugin marketplace update || echo "WARNING: marketplace update failed"

timeout --foreground 60 claude plugin list --json </dev/null |
  jq -r --arg ws "$workspace" '.[] | select(.scope == "user" or .projectPath == $ws) | "\(.id)\t\(.scope)"' |
  sort -u | while IFS="$(printf '\t')" read -r id scope; do
  timeout --foreground 60 claude plugin update "$id" --scope "$scope" </dev/null || echo "WARNING: failed to update $id ($scope)"
done

exit 0
