#!/usr/bin/env bash
set -euo pipefail

# Generate a unique ephemeral repo name and write a config file.
#
# Mode 1 (inline): create-ephemeral-repo-config.sh <prefix> <owner> <config-path> <config-id> <file-name> <file-content-json>
#   Generates a simple inline config YAML.
#
# Mode 2 (fixture): create-ephemeral-repo-config.sh --fixture <prefix> <owner> <config-path> <fixture-path>
#   Reads a template fixture YAML, replaces OWNER/REPO_PLACEHOLDER with the ephemeral repo.

if [ "${1:-}" = "--fixture" ]; then
  # Fixture template mode
  shift
  PREFIX="${1:?Usage: ... --fixture <prefix> <owner> <config-path> <fixture-path>}"
  OWNER="${2:?Missing owner}"
  CONFIG_PATH="${3:?Missing config-path}"
  FIXTURE_PATH="${4:?Missing fixture-path}"

  REPO_NAME="xfg-${PREFIX}-test-$(date +%s)-$(openssl rand -hex 3)"
  echo "Generated repo name: ${REPO_NAME}"

  # Create the ephemeral repo (action jobs sync TO an existing repo)
  gh repo create "${OWNER}/${REPO_NAME}" --public --add-readme

  # Substitute placeholder in fixture template
  sed "s|OWNER/REPO_PLACEHOLDER|${OWNER}/${REPO_NAME}|g" "${FIXTURE_PATH}" >"${CONFIG_PATH}"

  echo "Wrote config to ${CONFIG_PATH} (from fixture ${FIXTURE_PATH})"
else
  # Inline config mode (backward compatible)
  PREFIX="${1:?Usage: create-ephemeral-repo-config.sh <prefix> <owner> <config-path> <config-id> <file-name> <file-content-json>}"
  OWNER="${2:?Missing owner}"
  CONFIG_PATH="${3:?Missing config-path}"
  CONFIG_ID="${4:?Missing config-id}"
  FILE_NAME="${5:?Missing file-name}"
  FILE_CONTENT_JSON="${6:?Missing file-content-json}"

  REPO_NAME="xfg-lifecycle-${PREFIX}-$(date +%s)-$(openssl rand -hex 3)"
  echo "Generated repo name: ${REPO_NAME}"

  cat >"${CONFIG_PATH}" <<ENDCONFIG
id: ${CONFIG_ID}
files:
  ${FILE_NAME}:
    content: ${FILE_CONTENT_JSON}
repos:
  - git: https://github.com/${OWNER}/${REPO_NAME}.git
ENDCONFIG

  echo "Wrote config to ${CONFIG_PATH}"
fi

# Output for GitHub Actions
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "repo_name=${REPO_NAME}" >>"$GITHUB_OUTPUT"
fi

# Always print to stdout
echo "REPO_NAME=${REPO_NAME}"
