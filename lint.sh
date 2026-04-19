#!/usr/bin/env bash
# shellcheck disable=SC1091 # lint-config.sh path resolved at runtime
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
  # Local mode - with fixes and user permissions.
  # .output may be root-owned from an earlier rootful-podman run, so fall
  # back to sudo if a plain rm is rejected.
  rm -rf "$REPO_ROOT/.output" 2>/dev/null || sudo -n rm -rf "$REPO_ROOT/.output"
  mkdir "$REPO_ROOT/.output"

  LINT_EXIT_CODE=0

  # Inside a WSL2 devcontainer (nested userns), rootless podman's newuidmap
  # fails because the outer namespace did not delegate subuid ranges. Use
  # `sudo podman` with --network=host so no slirp4netns / subuid setup is
  # required. The container still runs linters as the invoking user via -u.
  if [[ "$(id -u)" != "0" ]] && command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    runner=(sudo -n podman)
    network_arg=(--network=host --uts=host)
  else
    runner=(docker)
    network_arg=()
  fi

  "${runner[@]}" run \
    -a STDOUT \
    -a STDERR \
    "${network_arg[@]}" \
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
    "$MEGALINTER_IMAGE" ||
    LINT_EXIT_CODE=$?

  # Copy fixed files back to workspace
  if compgen -G "$REPO_ROOT/.output/updated_sources/*" >/dev/null; then
    cp -r "$REPO_ROOT/.output/updated_sources"/* "$REPO_ROOT/"
  fi

  exit "$LINT_EXIT_CODE"
fi
