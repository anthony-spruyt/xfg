#!/usr/bin/env bash
# shellcheck disable=SC2034 # Variables used by sourcing script (lint.sh)
# Lint configuration - customize per repository
# This file is sourced by lint.sh for both local and CI runs

# MegaLinter Docker image (use digest for reproducibility)
# renovate: datasource=docker depName=ghcr.io/anthony-spruyt/megalinter-xfg
MEGALINTER_IMAGE="ghcr.io/anthony-spruyt/megalinter-xfg:v1.0.46@sha256:7e1cc1308ad98be2821669db97619392c5b8b6df9dd8a2c65c2a0e957aa5c02b"

# Skip linting for renovate/dependabot commits in CI
SKIP_BOT_COMMITS=false

# MegaLinter flavor (use "all" for custom images to bypass flavor validation)
MEGALINTER_FLAVOR="all"
