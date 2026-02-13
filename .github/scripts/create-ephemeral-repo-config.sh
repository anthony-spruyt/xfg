#!/usr/bin/env bash
set -euo pipefail

# Generate a unique ephemeral repo name and write a lifecycle test config file.
#
# Usage: create-ephemeral-repo-config.sh <prefix> <owner> <config-path> <config-id> <file-name> <file-content-json>
# Outputs: repo_name=<generated-name> to GITHUB_OUTPUT (if available) and stdout
# Requires: GH_TOKEN or gh auth
#
# Example:
#   create-ephemeral-repo-config.sh \
#     "action-pat" "anthony-spruyt" "/tmp/config.yaml" \
#     "lifecycle-action-pat-test" "lifecycle-action-test.json" '{"createdByAction": true}'

PREFIX="${1:?Usage: create-ephemeral-repo-config.sh <prefix> <owner> <config-path> <config-id> <file-name> <file-content-json>}"
OWNER="${2:?Missing owner}"
CONFIG_PATH="${3:?Missing config-path}"
CONFIG_ID="${4:?Missing config-id}"
FILE_NAME="${5:?Missing file-name}"
FILE_CONTENT_JSON="${6:?Missing file-content-json}"

REPO_NAME="xfg-lifecycle-${PREFIX}-$(date +%s)-$(openssl rand -hex 3)"
echo "Generated repo name: ${REPO_NAME}"

# Write YAML config (content is a JSON object, so indent under content:)
cat >"${CONFIG_PATH}" <<ENDCONFIG
id: ${CONFIG_ID}
files:
  ${FILE_NAME}:
    content: ${FILE_CONTENT_JSON}
repos:
  - git: https://github.com/${OWNER}/${REPO_NAME}.git
ENDCONFIG

echo "Wrote config to ${CONFIG_PATH}"

# Output for GitHub Actions
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "repo_name=${REPO_NAME}" >>"$GITHUB_OUTPUT"
fi

# Always print to stdout for scripts that capture output
echo "REPO_NAME=${REPO_NAME}"
