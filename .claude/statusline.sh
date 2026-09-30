#!/bin/bash
# shellcheck disable=all
set -f

input=$(cat)
[ -z "$input" ] && printf "Claude" && exit 0

blue='\033[38;2;0;153;255m'
orange='\033[38;2;255;176;85m'
green='\033[38;2;0;160;0m'
cyan='\033[38;2;46;149;153m'
red='\033[38;2;255;85;85m'
yellow='\033[38;2;230;200;0m'
purple='\033[38;2;167;139;250m'
white='\033[38;2;220;220;220m'
dim='\033[2m'
reset='\033[0m'
sep=" ${dim}|${reset} "

format_tokens() {
  awk -v n="$1" 'BEGIN {
    if (n >= 1000000) { v = n / 1000000; if (v == int(v)) printf "%dm", v; else printf "%.1fm", v }
    else if (n >= 1000) printf "%.0fk", n / 1000
    else printf "%d", n
  }'
}

usage_color() {
  if [ "$1" -ge 90 ]; then
    echo "$red"
  elif [ "$1" -ge 70 ]; then
    echo "$orange"
  elif [ "$1" -ge 50 ]; then
    echo "$yellow"
  else
    echo "$green"
  fi
}

IFS=$'\x1f' read -r model cwd size used pct effort fh_pct fh_reset sd_pct sd_reset < <(echo "$input" | jq -r '[
  (.model.display_name // "Claude"),
  (.workspace.current_dir // .cwd // ""),
  (.context_window.context_window_size // 200000),
  (.context_window.total_input_tokens // 0),
  (.context_window.used_percentage // 0),
  (.effort.level // ""),
  (.rate_limits.five_hour.used_percentage // ""),
  (.rate_limits.five_hour.resets_at // ""),
  (.rate_limits.seven_day.used_percentage // ""),
  (.rate_limits.seven_day.resets_at // "")
] | map(tostring) | join("\u001f")')

model=$(echo "$model" | sed 's/ *(\([0-9.]*[kKmM]*\) context)/ \1/')
pct=$(printf '%.0f' "$pct")
config_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
[ -z "$effort" ] && effort="$CLAUDE_CODE_EFFORT_LEVEL"
[ -z "$effort" ] && effort=$(jq -r '.effortLevel // "medium"' "$config_dir/settings.json" 2>/dev/null)

out="${blue}${model}${reset}"

if [ -n "$cwd" ]; then
  out+="${sep}${cyan}${cwd##*/}${reset}"
  branch=$(git -C "$cwd" --no-optional-locks rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ -n "$branch" ]; then
    out+="${dim}@${reset}${green}${branch}${reset}"
    stat=$(git -C "$cwd" --no-optional-locks diff --numstat 2>/dev/null | awk '{a+=$1; d+=$2} END {if (a+d>0) printf "+%d -%d", a, d}')
    [ -n "$stat" ] && out+=" ${dim}(${reset}${green}${stat%% *}${reset} ${red}${stat##* }${reset}${dim})${reset}"
  fi
fi

ctx_color=$(usage_color "$pct")
out+="${sep}${ctx_color}ctx $(format_tokens "$used")/$(format_tokens "$size") ${pct}%${reset}"

case "$effort" in
low) effort_color="$dim" ;;
medium) effort_color="$orange" ;;
xhigh) effort_color="$purple" ;;
max) effort_color="$red" ;;
*) effort_color="$green" ;;
esac
out+="${sep}effort ${effort_color}${effort}${reset}"

limit() {
  local label=$1 raw=$2 reset_at=$3 fmt=$4 p when
  [ -z "$raw" ] && return
  p=$(printf '%.0f' "$raw")
  out+="${sep}${white}${label}${reset} $(usage_color "$p")${p}%${reset}"
  [ -n "$reset_at" ] && when=$(date -d "@$reset_at" +"$fmt" 2>/dev/null || date -j -r "$reset_at" +"$fmt" 2>/dev/null)
  [ -n "$when" ] && out+=" ${dim}@${when}${reset}"
}
limit 5h "$fh_pct" "$fh_reset" "%H:%M"
limit 7d "$sd_pct" "$sd_reset" "%b %-d, %H:%M"

printf "%b" "$out"
