#!/bin/bash
# Git credential helper for Azure DevOps - used by CI only
# Reads PAT from AZURE_DEVOPS_EXT_PAT environment variable
# Local dev should use Git Credential Manager (GCM) instead
if [ -n "${AZURE_DEVOPS_EXT_PAT:-}" ]; then
  echo "username=pat"
  echo "password=${AZURE_DEVOPS_EXT_PAT}"
fi
