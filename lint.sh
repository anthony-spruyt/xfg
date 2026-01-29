#!/usr/bin/env bash
# shellcheck disable=SC2193,SC2157 # $$ is xfg template escaping, becomes $ after processing
set -euo pipefail

# This file is automatically updated - do not modify directly

# Runs MegaLinter against the repository.
# Usage:
#   ./lint.sh       - Local mode (with fixes, user permissions)
#   ./lint.sh --ci  - CI mode (no fixes, passes GitHub env vars)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source config file (required)
# shellcheck source=lint-config.sh
source "$REPO_ROOT/lint-config.sh"

if [[ "${1:-}" == "--ci" ]]; then
  # CI mode
  # Skip bot commits if configured
  if [[ "$SKIP_BOT_COMMITS" == "true" && ("${GITHUB_ACTOR:-}" == "renovate[bot]" || "${GITHUB_ACTOR:-}" == "dependabot[bot]") ]]; then
    echo "::notice::Skipping lint for bot commit"
    exit 0
  fi

  # Build docker run arguments
  docker_args=(
    -e MEGALINTER_FLAVOR="$MEGALINTER_FLAVOR"
    -e SARIF_REPORTER=true
    -e GITHUB_TOKEN="${GITHUB_TOKEN:-}"
    -e VALIDATE_ALL_CODEBASE="${VALIDATE_ALL_CODEBASE:-}"
    -e DEFAULT_WORKSPACE=/tmp/lint
    -e GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-}"
    -e GITHUB_SHA="${GITHUB_SHA:-}"
    -e GITHUB_REF="${GITHUB_REF:-}"
    -e GITHUB_RUN_ID="${GITHUB_RUN_ID:-}"
    -v "$REPO_ROOT:/tmp/lint:rw"
    --rm
  )

  # Mount GITHUB_STEP_SUMMARY if available (for job summaries)
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" && -f "${GITHUB_STEP_SUMMARY}" ]]; then
    docker_args+=(-e GITHUB_STEP_SUMMARY="${GITHUB_STEP_SUMMARY}")
    docker_args+=(-v "${GITHUB_STEP_SUMMARY}:${GITHUB_STEP_SUMMARY}:rw")
  fi

  docker run "${docker_args[@]}" "$MEGALINTER_IMAGE"
else
  # Local mode - with fixes and user permissions
  rm -rf "$REPO_ROOT/.output"
  mkdir "$REPO_ROOT/.output"

  docker run \
    -a STDOUT \
    -a STDERR \
    -u "$(id -u):$(id -g)" \
    -w /tmp/lint \
    -e HOME=/tmp \
    -e MEGALINTER_FLAVOR="$MEGALINTER_FLAVOR" \
    -e VALIDATE_ALL_CODEBASE="true" \
    -e APPLY_FIXES="all" \
    -e UPDATED_SOURCES_REPORTER="true" \
    -e REPORT_OUTPUT_FOLDER="/tmp/lint/.output" \
    -v "$REPO_ROOT:/tmp/lint:rw" \
    --rm \
    "$MEGALINTER_IMAGE"

  LINT_EXIT_CODE=$?

  # Copy fixed files back to workspace
  if compgen -G "$REPO_ROOT/.output/updated_sources/*" >/dev/null; then
    cp -r "$REPO_ROOT/.output/updated_sources"/* "$REPO_ROOT/"
  fi

  exit $LINT_EXIT_CODE
fi
