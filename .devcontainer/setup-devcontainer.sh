#!/bin/bash
set -euo pipefail

# Implement custom devcontainer setup here. This is run after the devcontainer has been created.

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
cd "/workspaces/xfg"
npm install

echo "Building project..."
npm run build
