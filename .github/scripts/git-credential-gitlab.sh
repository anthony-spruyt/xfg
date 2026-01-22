#!/bin/bash
# Git credential helper for GitLab - used by CI only
# Reads token from GITLAB_TOKEN environment variable
# Local dev should use glab auth login instead
if [ -n "${GITLAB_TOKEN:-}" ]; then
  echo "username=oauth2"
  echo "password=${GITLAB_TOKEN}"
fi
