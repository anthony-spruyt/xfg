# Development Environment

This repository uses a VS Code devcontainer for a consistent development experience.

## Prerequisites

- [VS Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine
- SSH agent running with keys loaded (see [SSH Agent Setup](#ssh-agent-setup))
- GitHub token in `~/.secrets/.env` (for GitHub CLI operations)

### Installing Prerequisites

**macOS:**

1. Install [Homebrew](https://brew.sh) if you don't have it:

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. Install VS Code and Docker Desktop:

   ```bash
   brew install --cask visual-studio-code docker
   ```

3. Open Docker Desktop and complete the setup wizard. Ensure it is running before opening the devcontainer.

4. Install the Dev Containers extension: open VS Code, then `Cmd+Shift+X` and search for "Dev Containers" (`ms-vscode-remote.remote-containers`).

5. Generate an SSH key if you don't have one:

   ```bash
   ssh-keygen -t ed25519
   ```

6. Add your public key to GitHub: copy the output of `cat ~/.ssh/id_ed25519.pub` and add it at [GitHub Settings > SSH and GPG keys](https://github.com/settings/keys).

**Windows:**

1. Install WSL2 from an elevated PowerShell:

   ```powershell
   wsl --install
   ```

   This installs WSL2 with Ubuntu by default. Restart when prompted.

2. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and enable the **WSL 2 backend** in Settings > General.

3. Install [VS Code](https://code.visualstudio.com/) and the [WSL extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl) plus the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).

4. All development happens inside WSL. Open a WSL terminal to clone the repo and generate your SSH key:

   ```bash
   ssh-keygen -t ed25519
   ```

5. Add your public key to GitHub: copy the output of `cat ~/.ssh/id_ed25519.pub` and add it at [GitHub Settings > SSH and GPG keys](https://github.com/settings/keys).

6. Install `keychain` for SSH agent management (used by the devcontainer initialize script):

   ```bash
   sudo apt install keychain
   ```

**Linux:**

1. Install [VS Code](https://code.visualstudio.com/) and [Docker Engine](https://docs.docker.com/engine/install/).

2. Install `keychain` for SSH agent management:

   ```bash
   sudo apt install keychain
   ```

3. Generate an SSH key if you don't have one and add it to GitHub:

   ```bash
   ssh-keygen -t ed25519
   cat ~/.ssh/id_ed25519.pub
   ```

   Copy the output and add it at [GitHub Settings > SSH and GPG keys](https://github.com/settings/keys).

4. Install the Dev Containers extension: open VS Code, then `Ctrl+Shift+X` and search for "Dev Containers" (`ms-vscode-remote.remote-containers`).

## Host Directory Structure

The devcontainer expects these directories on your host machine:

```text
~/.secrets/
├── .env                    # Environment variables (loaded via --env-file)
└── ...                     # Other secrets as needed

~/.claude/                  # Claude Code settings and memory

~/.ssh/
├── id_ed25519              # SSH private key
├── id_ed25519.pub          # SSH public key
├── known_hosts             # Known host keys (required mount)
└── allowed_signers         # SSH signing trust store (required mount)

~/.gitconfig                # Git identity and signing config (mounted read-only)
```

Create the required structure:

```bash
mkdir -p ~/.claude ~/.secrets ~/.ssh
chmod 700 ~/.secrets
touch ~/.secrets/.env ~/.ssh/known_hosts ~/.ssh/allowed_signers
chmod 600 ~/.secrets/.env
```

Set your git identity (this also creates `~/.gitconfig`, which the devcontainer mounts):

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

The `.env` file sets environment variables:

```text
GH_TOKEN=<github-token>
# Optional, see https://context7.com
# CONTEXT7_API_KEY=<context7-key>
```

Create a classic `GH_TOKEN` at [GitHub Settings > Developer settings > Personal access tokens (classic)](https://github.com/settings/tokens) with `repo` and `workflow` scopes.

## SSH Agent Setup

The devcontainer uses SSH agent forwarding via socket mount. Your private keys stay on
the host and are never copied into the container.

The devcontainer also mounts your `~/.gitconfig` (read-only) for git identity and commit signing.

### Commit Signing

GitHub requires signed commits for verified badges. You can use either SSH or GPG.

**SSH signing (recommended):**

```bash
git config --global gpg.format ssh
git config --global user.signingkey "$(cat ~/.ssh/id_ed25519.pub)"
git config --global commit.gpgsign true
git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers
echo "$(git config --global user.email) $(cat ~/.ssh/id_ed25519.pub)" >> ~/.ssh/allowed_signers
```

Then add the same public key as a **signing key** at [GitHub Settings > SSH and GPG keys](https://github.com/settings/keys) (this is separate from the authentication key added during setup).

**GPG signing (advanced):**

> **Note:** The devcontainer only forwards the SSH agent, not the GPG agent. GPG signing requires additional host-side configuration to forward the GPG socket into the container. SSH signing is recommended for simplicity.

1. Generate a GPG key:

   ```bash
   gpg --full-generate-key
   ```

   Select RSA 4096-bit, and use the same email as your GitHub account.

2. Get your key ID:

   ```bash
   gpg --list-secret-keys --keyid-format=long
   ```

   The key ID is the hex string after `sec rsa4096/` (e.g., `3AA5C34371567BD2`).

3. Configure git:

   ```bash
   git config --global user.signingkey <key-id>
   git config --global commit.gpgsign true
   ```

4. Export and add to GitHub:

   ```bash
   gpg --armor --export <key-id>
   ```

   Copy the output and add it at [GitHub Settings > SSH and GPG keys](https://github.com/settings/keys) under **GPG keys**.

### macOS

macOS manages the SSH agent via launchd -- no extra tooling is needed. Add your key to the system keychain:

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

Keys added with `--apple-use-keychain` persist across restarts. The initialize script (`.devcontainer/initialize.sh`) automatically finds the macOS agent socket and creates the `~/.ssh/agent.sock` symlink that the devcontainer mounts.

### Linux/WSL

For passphrase-protected keys, use `keychain` to persist the agent across sessions:

```bash
# Install: sudo apt install keychain
# Add to ~/.bashrc or ~/.zshrc:
# SSH agent setup
eval "$(keychain --eval --agents ssh id_ed25519)"
```

The initialize script (`.devcontainer/initialize.sh`) uses `keychain` to start the agent and creates the `~/.ssh/agent.sock` symlink automatically. You just need `keychain` installed and your keys available.

### Windows

Windows users develop inside WSL, so follow the [Linux/WSL](#linuxwsl) instructions above for SSH agent setup.

## Troubleshooting

### Devcontainer fails to start after reboot with mount error

**Error**: `error mounting "..." to rootfs at "/ssh-agent": not a directory`

**Cause**: The SSH agent socket path changed after reboot, but your devcontainer was created with the old path.

**Solution**:

1. Restart your terminal or run: `source ~/.bashrc`
2. Verify the symlink exists: `ls -la ~/.ssh/agent.sock`
3. **Rebuild the devcontainer**: Command Palette > "Dev Containers: Rebuild Container"

On macOS, the initialize script handles the socket path automatically. If the agent is not running or keys are missing, re-add them:

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

If the symlink is missing or broken after reboot on Linux, ensure `keychain` is installed and configured in `~/.bashrc` (not just set in the current terminal session).

## Opening the Devcontainer

1. Clone the repository:

   ```bash
   git clone git@github.com:anthony-spruyt/xfg.git
   ```

2. Open the folder in VS Code
3. When prompted, click "Reopen in Container" (or run `Dev Containers: Reopen in Container` from the command palette)

Setup is verified automatically when the container is created. The `post-create.sh` script installs dependencies, builds the project, and runs verification tests for Docker-in-Docker, pre-commit hooks, safe-chain, GitHub CLI, SSH agent forwarding, and Claude Code CLI.

## Included Tools

- **Docker-in-Docker** -- Build and test container images
- **Node.js** -- TypeScript/JavaScript runtime
- **Python** -- Required for pre-commit hooks
- **Pre-commit hooks** -- Automatic linting on commit (gitleaks, prettier, yamllint, trailing-whitespace, etc.)
- **Safe-chain** -- Supply chain attack protection for npm/pip
- **GitHub CLI** -- `gh` command for GitHub operations
- **Azure CLI** -- `az` command with Azure DevOps extension
- **GitLab CLI** -- `glab` command for GitLab operations
- **Git Credential Manager** -- Azure DevOps git authentication
- **Claude Code CLI** -- AI-assisted development

## Platform Authentication

After the devcontainer is running, authenticate with the platforms you need to work with. These steps are only required if you are targeting that platform.

**GitHub:** Already authenticated via `GH_TOKEN` in `~/.secrets/.env`. No additional steps needed.

**Azure DevOps:**

```bash
az login
az devops configure --defaults organization=https://dev.azure.com/ORG
```

Replace `ORG` with your Azure DevOps organization name.

**GitLab:**

```bash
glab auth login
```

Follow the interactive prompts to authenticate with your GitLab instance.

## Development Commands

```bash
npm run build    # Compile TypeScript
npm test         # Run unit tests
npm run dev      # Run CLI via ts-node
./lint.sh        # Run linting (MegaLinter)
```
