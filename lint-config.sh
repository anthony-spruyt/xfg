#!/usr/bin/env bash
# shellcheck disable=SC2034 # Variables used by sourcing script (lint.sh)
# Lint configuration - customize per repository
# This file is sourced by lint.sh for both local and CI runs

# MegaLinter Docker image (use digest for reproducibility)
# renovate: datasource=docker depName=ghcr.io/anthony-spruyt/megalinter-xfg
MEGALINTER_IMAGE="ghcr.io/anthony-spruyt/megalinter-xfg:v1.0.47@sha256:5079e5f6d3d11b1a204afbb5cb1dba8eb64abd72c24aaf09ed569f771630ee58"

# Skip linting for renovate/dependabot commits in CI
SKIP_BOT_COMMITS=false

# MegaLinter flavor (use "all" for custom images to bypass flavor validation)
MEGALINTER_FLAVOR="all"
