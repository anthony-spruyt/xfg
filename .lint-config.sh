#!/usr/bin/env bash
# shellcheck disable=SC2034 # Variables used by sourcing script (lint.sh)
# This file is automatically updated - do not modify directly
# The image pin lives in repo-operator (src/groups.yaml, or src/repos.yaml for a per-repo flavor), where Renovate bumps it

MEGALINTER_IMAGE="ghcr.io/anthony-spruyt/megalinter-xfg:v2.0.4@sha256:048c59dadfa90a1c2cfd631867958e4a07a0b07b67ad0a84555d292cd70dc4c5"

SKIP_BOT_COMMITS=false

# MegaLinter flavor (use "all" for custom images to bypass flavor validation)
MEGALINTER_FLAVOR="all"
