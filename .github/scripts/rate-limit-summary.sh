#!/usr/bin/env bash
set -euo pipefail

# Write the token's GitHub rate-limit headroom to the job summary. Call with "start" before a
# lane's tests and "end" after; "end" also reports requests used since "start".
# GET /rate_limit does not count against the limit. Never prints the token.
#
# Usage: rate-limit-summary.sh <start|end> <label>
# Requires: GH_TOKEN

PHASE="${1:-}"
LABEL="${2:-}"
if [[ ! "${PHASE}" =~ ^(start|end)$ ]] || [ -z "${LABEL}" ]; then
  echo "Usage: rate-limit-summary.sh <start|end> <label>" >&2
  exit 2
fi

STATE="${RUNNER_TEMP:-/tmp}/rate-limit-${LABEL//[^A-Za-z0-9_-]/_}.tsv"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if ! CURRENT=$(gh api rate_limit --jq '.resources | to_entries[] | select(.key == "core" or .key == "graphql") | [.key, .value.used, .value.remaining, .value.limit, .value.reset] | @tsv' 2>/dev/null); then
  echo "::warning title=Rate limit unavailable::could not read the rate limit for ${LABEL} (${PHASE})"
  exit 0
fi

{
  echo "#### Rate limit: ${LABEL} (${PHASE})"
  echo ""
  if [ "${PHASE}" = "start" ]; then
    echo "| Resource | Used | Remaining | Limit | Resets |"
    echo "| --- | --- | --- | --- | --- |"
  else
    echo "| Resource | Used | Remaining | Limit | Used by this lane | Resets |"
    echo "| --- | --- | --- | --- | --- | --- |"
  fi
  while IFS=$'\t' read -r RESOURCE USED REMAINING LIMIT RESET; do
    [ -n "${RESOURCE}" ] || continue
    RESETS=$(date -u -d "@${RESET}" +%H:%M:%SZ 2>/dev/null || echo "${RESET}")
    if [ "${PHASE}" = "start" ]; then
      echo "| ${RESOURCE} | ${USED} | ${REMAINING} | ${LIMIT} | ${RESETS} |"
      continue
    fi
    DELTA="n/a"
    if [ -f "${STATE}" ]; then
      read -r _ START_USED _ _ START_RESET < <(grep "^${RESOURCE}"$'\t' "${STATE}" || true)
      if [ -n "${START_USED:-}" ]; then
        # The delta counts every user of the token, other lanes included
        if [ "$(date +%s)" -lt "${START_RESET}" ]; then
          DELTA="+$((USED - START_USED))"
        else
          DELTA="window reset"
        fi
      fi
    fi
    echo "| ${RESOURCE} | ${USED} | ${REMAINING} | ${LIMIT} | ${DELTA} | ${RESETS} |"
  done <<<"${CURRENT}"
  echo ""
} >>"${SUMMARY}"

if [ "${PHASE}" = "start" ]; then
  printf '%s\n' "${CURRENT}" >"${STATE}"
fi
