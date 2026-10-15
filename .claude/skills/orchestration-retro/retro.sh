#!/usr/bin/env bash
# Read-only helper delegation report. Never print tool inputs, tool results or env values.
# Keep variables unbraced: xfg substitutes brace-dollar references when it syncs this file.
set -euo pipefail

usage() {
  echo "Usage: retro.sh [--since YYYY-MM-DD] [--projects-dir DIR]" >&2
  exit 2
}

since=""
projects_dir="$HOME/.claude/projects"
while [[ $# -gt 0 ]]; do
  case "$1" in
  --since)
    [[ $# -ge 2 ]] || usage
    since="$2"
    shift 2
    ;;
  --projects-dir)
    [[ $# -ge 2 ]] || usage
    projects_dir="$2"
    shift 2
    ;;
  *) usage ;;
  esac
done

if [[ -n "$since" ]] && ! [[ "$since" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "retro.sh: --since must be YYYY-MM-DD" >&2
  exit 2
fi
if [[ ! -d "$projects_dir" ]]; then
  echo "retro.sh: $projects_dir is not a directory" >&2
  exit 1
fi

# One object per helper transcript. Assistant messages repeat once per content
# block under the same id, so tokens take the max per id.
read -r -d '' extract <<'JQ' || true
def text_of:
  if (.message.content | type) == "array"
  then [.message.content[]
        | if .type == "text" then .text
          elif .type == "tool_use" and .name == "SubagentHandback" then (.input.message | strings)
          else empty end] | join("\n")
  else "" end;
[inputs | fromjson? | select(type == "object")] as $lines
| [$lines[] | select(.type == "assistant" and (.message.model // "<synthetic>") != "<synthetic>")] as $assistant
| ([$assistant[] | text_of | select(length > 0)] | last // "") as $reply
| {
    agent: $meta.agent,
    desc: ($meta.desc | gsub("\\s+"; " ")),
    date: (([$lines[] | .timestamp // empty] | first // "")[0:10]),
    model: (($assistant | first | .message.model) // "unknown"),
    tokens: ([$assistant | group_by(.message.id)[] | map(.message.usage.output_tokens // 0) | max] | add // 0),
    verdict: (
      if $reply | test("VERDICT:\\s*NOT READY") then "NOT READY"
      elif $reply | test("VERDICT:\\s*READY") then "READY"
      elif $reply | test("NOT READY") then "NOT READY"
      elif $reply | test("\\bREADY\\b") then "READY"
      else "none" end),
    mode: (
      if $reply | test("(^|\\n)Mode:\\s*fix-check") then "fix-check"
      elif $reply | test("(^|\\n)Mode:\\s*full") then "full"
      else "none" end),
    prline: ($reply | [scan("(?:^|\\n)PR:[^\\n]*?([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)#([0-9]+)")] | first),
    feedback: (
      $reply | split("### Agent Definition Feedback")
      | if length > 1
        then last | split("\n#")[0] | gsub("\\A\\s+|\\s+\\z"; "")
        else "" end
      | if gsub("\\s+"; " ") | test("^none\\.?$"; "i") then "" else . end)
  }
JQ

read -r -d '' report <<'JQ' || true
def clip($n): if length > $n then .[0:$n] + "..." else . end;
def cap($n; $label):
  if length > $n then .[0:$n] + ["- ... and \(length - $n) more \($label)"] else . end;
def prnum:
  if .prline != null then .prline[1]
  else .desc | [scan("(?:#|\\bPR\\s*#?)([0-9]+)")] | first[0]?
  end
  | if . == null then null else tonumber end;
def prlabel:
  ([.[].repo | select(. != null)] | sort | first) as $r | "\($r // "")#\(.[0].pr)";

map(select($since == "" or .date >= $since)) as $runs
| "# Orchestration retro",
  "",
  (if $since == "" then "Window: all logs" else "Window: since \($since)" end)
    + ", \($runs | length) helper runs",
  "",
  "## Helper runs by agent type and model",
  "",
  (if ($runs | length) == 0 then "No helper runs in the window."
   else
     "| Agent type | Model | Runs | Output tokens |",
     "|---|---|---|---|",
     ($runs | group_by([.agent, .model])[]
       | "| \(.[0].agent) | \(.[0].model) | \(length) | \(map(.tokens) | add) |")
   end),
  "",
  "## Routing misses",
  "",
  ([$runs[] | select(.agent == "general-purpose")] as $gp
   | [$gp[] | select(.model | test("opus"; "i"))] as $miss
   | if ($gp | length) == 0 then "None."
     else
       "general-purpose helpers on an Opus model: \($miss | length) of \($gp | length)",
       "",
       ($miss | sort_by(.date) | reverse
         | map("- \(.date) \(.desc | clip(120))") | cap(25; "misses") | .[])
     end),
  "",
  "## Review verdicts",
  "",
  ([$runs[] | select(.agent | IN("reviewer", "pr-reviewer"))] as $rev
   | if ($rev | length) == 0 then "None."
     else
       "- READY: \($rev | map(select(.verdict == "READY")) | length)",
       "- NOT READY: \($rev | map(select(.verdict == "NOT READY")) | length)",
       "- No verdict found: \($rev | map(select(.verdict == "none")) | length)"
     end),
  "",
  "## PRs with fix rounds",
  "",
  ([$runs[]
     | select((.agent | IN("reviewer", "pr-reviewer")) and .mode == "fix-check")
     | . + {pr: prnum, repo: .prline[0]}] as $fix
   | ([$fix[] | select(.pr == null)] | length) as $nonum
   | ([$fix[] | select(.pr != null)] | group_by(.pr) | sort_by(-length)) as $groups
   | (if ($groups | length) == 0 then "None."
      else
        $groups
        | map("- \(prlabel): \(length) fix round" + (if length == 1 then "" else "s" end) + (if length >= 2 then " (at cap)" else "" end))
        | cap(15; "PRs") | .[]
      end),
     (if $nonum > 0 then "- Fix-checks with no PR number: \($nonum)" else empty end)),
  "",
  "## Agent Definition Feedback",
  "",
  ([$runs[] | select(.feedback != "")] | sort_by(.date) | reverse) as $fb
  | def items($t):
    [.feedback | split("\n")[]]
    | reduce .[] as $l ([];
        if $l | test("^\\s*- \\[") then . + [$l | gsub("^\\s*- "; "")]
        elif length > 0 then .[-1] += " " + ($l | gsub("^\\s+|\\s+$"; ""))
        else . end)
    | map(gsub("\\s+"; " ") | gsub("\\s+$"; "") | select(test("^\\[\($t)\\]")));
    def untagged: items("definition") + items("rules") + items("brief") | length == 0;
    def tagged($t): [$fb[] | . + {items: items($t)} | select(.items | length > 0)];
    if ($fb | length) == 0 then "None."
    else
      "- [definition] items: \(tagged("definition") | map(.items | length) | add // 0)",
        "- [rules] items: \(tagged("rules") | map(.items | length) | add // 0)",
        "- [brief] items: \(tagged("brief") | map(.items | length) | add // 0)",
        "- Untagged entries: \([$fb[] | select(untagged)] | length)",
        "",
        "### [definition]",
        "",
        (tagged("definition") | if length == 0 then "None." else map("- \(.agent) (\(.date), \(.desc | clip(80))): \(.items | join(" ") | clip(300))") | cap(15; "[definition] entries") | .[] end),
        "",
        "### [rules]",
        "",
        (tagged("rules") | if length == 0 then "None." else map("- \(.agent) (\(.date), \(.desc | clip(80))): \(.items | join(" ") | clip(300))") | cap(15; "[rules] entries") | .[] end),
        "",
        "### [brief]",
        "",
        (tagged("brief") | if length == 0 then "None." else map("- \(.agent) (\(.date), \(.desc | clip(80))): \(.items | join(" ") | clip(300))") | cap(15; "[brief] entries") | .[] end),
        "",
        "### Untagged",
        "",
        ([$fb[] | select(untagged)] | if length == 0 then "None." else map("- \(.agent) (\(.date), \(.desc | clip(80))): \(.feedback | gsub("\\s+"; " ") | clip(300))") | cap(15; "untagged entries") | .[] end)
    end
JQ

runs_file="$(mktemp)"
trap 'rm -f "$runs_file"' EXIT

while IFS= read -r -d '' transcript; do
  meta_file=$(printf '%s' "$transcript" | sed 's/\.jsonl$/.meta.json/')
  meta='{"agent":"unknown","desc":""}'
  if [[ -f "$meta_file" ]]; then
    meta="$(jq -c '{agent: (.agentType // "unknown"), desc: (.description // "")}' "$meta_file" 2>/dev/null || echo "$meta")"
  fi
  jq -R -n -c --argjson meta "$meta" "$extract" "$transcript" >>"$runs_file" ||
    echo "retro.sh: skipped unreadable transcript $(basename "$transcript")" >&2
done < <(find "$projects_dir" -mindepth 4 -maxdepth 4 -path '*/subagents/agent-*.jsonl' -type f -print0)

jq -s -r --arg since "$since" "$report" "$runs_file"
