#!/bin/bash
set -euo pipefail

# Make all shell scripts executable (runs from repo root via postCreateCommand)
find . -type f -name '*.sh' -exec chmod +x {} +

# Change to script directory for package.json access
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Install and setup safe-chain FIRST before any other npm installs
echo "Installing safe-chain..."
npm install -g "@aikidosec/safe-chain@$(node -p "require('./package.json').dependencies['@aikidosec/safe-chain']")"

echo "Setting up safe-chain..."
safe-chain setup        # Shell aliases for interactive terminals
safe-chain setup-ci     # Executable shims for scripts/CI

# Add safe-chain shims to PATH for all subsequent commands
# This ensures pre-commit and other tools use protected pip/npm
export PATH="$HOME/.safe-chain/shims:$PATH"

echo "Installing remaining npm tools (now protected by safe-chain)..."
npm install -g "@anthropic-ai/claude-code@$(node -p "require('./package.json').dependencies['@anthropic-ai/claude-code']")" --safe-chain-skip-minimum-package-age

# Install GitLab CLI (glab) via WakeMeOps repository
echo "Installing GitLab CLI..."
curl -sSL "https://raw.githubusercontent.com/upciti/wakemeops/main/assets/install_repository" | sudo bash
sudo apt-get install -y glab

# Install Azure DevOps CLI extension
echo "Installing Azure DevOps CLI extension..."
az extension add --name azure-devops --yes

# Install Git Credential Manager for Azure DevOps git auth
echo "Installing Git Credential Manager..."
curl -sL -o /tmp/gcm.deb https://github.com/git-ecosystem/git-credential-manager/releases/download/v2.6.1/gcm-linux_amd64.2.6.1.deb
sudo dpkg -i /tmp/gcm.deb
rm /tmp/gcm.deb

# Install and build the project
echo "Installing project dependencies..."
cd "${containerWorkspaceFolder:-/workspaces/xfg}"
npm install

echo "Building project..."
npm run build
