#!/usr/bin/env bash
set -euo pipefail

# Fail fast when a GitHub environment lacks a secret its job needs. Pass each secret as an
# env var of the same name; values are only tested for emptiness, never printed.
#
# Usage: require-env-secrets.sh <environment> <SECRET_NAME>...

if [ "$#" -lt 2 ]; then
  echo "Usage: require-env-secrets.sh <environment> <SECRET_NAME>..." >&2
  exit 2
fi

ENVIRONMENT="$1"
shift

MISSING=0
for NAME in "$@"; do
  if [ -z "${!NAME:-}" ]; then
    echo "::error title=Missing environment secret::environment '${ENVIRONMENT}' is missing secret ${NAME}"
    MISSING=1
  fi
done

if [ "${MISSING}" -ne 0 ]; then
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    echo "Add the secrets at https://github.com/${GITHUB_REPOSITORY}/settings/environments" >&2
  fi
  exit 1
fi

echo "Environment '${ENVIRONMENT}' has all required secrets: $*"
