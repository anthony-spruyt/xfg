#!/usr/bin/env bash
# shellcheck disable=SC2034 # Variables used by sourcing script (lint.sh)
# Lint configuration - customize per repository
# This file is sourced by lint.sh for both local and CI runs

# MegaLinter Docker image (use digest for reproducibility)
# renovate: TODO
MEGALINTER_IMAGE="ghcr.io/anthony-spruyt/megalinter-xfg@sha256:34fa4e372700ec214982d82277e79e7affbab864317a1e9f1192486a839bb610"

# Skip linting for renovate/dependabot commits in CI
SKIP_BOT_COMMITS=true

# MegaLinter flavor (use "all" for custom images to bypass flavor validation)
MEGALINTER_FLAVOR="all"
