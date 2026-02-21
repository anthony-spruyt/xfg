# Development Environment

This repository uses a VS Code devcontainer for a consistent development experience.

## Prerequisites

- [VS Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine
- SSH agent running with keys loaded (see [SSH Agent Setup](#ssh-agent-setup))
- GitHub token in `~/.secrets/.env` (for GitHub CLI operations)

## Host Directory Structure

The devcontainer expects these directories on your host machine:

```text
~/.secrets/
├── .env                    # Environment variables (loaded via --env-file)
└── ...                     # Other secrets as needed

~/.claude/                  # Claude Code settings and memory
```

Create the required structure:

```bash
mkdir -p ~/.claude
touch ~/.secrets/.env
```

The `.env` file sets environment variables:

```bash
GH_TOKEN=<github-token>
CONTEXT7_API_KEY=<context7-key>  # Optional, for Context7 MCP plugin
```

## SSH Agent Setup

The devcontainer uses SSH agent forwarding via socket mount. Your private keys stay on
the host and are never copied into the container.

The devcontainer also mounts your `~/.gitconfig` (read-only) for git identity and commit signing.

### SSH Commit Signing

To enable SSH commit signing on your host:

```bash
git config --global gpg.format ssh
git config --global user.signingkey "$(cat ~/.ssh/id_ed25519.pub)"
git config --global commit.gpgsign true
```

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

### Windows (Git Bash)

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

Or enable the OpenSSH Authentication Agent service in Windows Services.

> **Note:** On Windows, you may need to manually create the socket symlink. See the initialize script for details.

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

## GitHub CLI Setup

The devcontainer loads environment variables from `~/.secrets/.env` on your host. Create this file with a GitHub token for CLI operations:

```bash
mkdir -p ~/.secrets
chmod 700 ~/.secrets
echo "GH_TOKEN=ghp_your_token_here" > ~/.secrets/.env
chmod 600 ~/.secrets/.env
```

Create a token at [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens) with `repo` and `workflow` scopes.

## Opening the Devcontainer

1. Clone the repository
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
