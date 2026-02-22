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
   brew install --cask visual-studio-code docker-desktop
   ```

3. Open Docker Desktop and complete the setup wizard. Ensure it is running before opening the devcontainer.

4. Install the Dev Containers extension: open VS Code, then `Cmd+Shift+X` and search for "Dev Containers" (`ms-vscode-remote.remote-containers`).

5. Generate an SSH key if you don't have one:

   ```bash
   ssh-keygen -t ed25519 -C "you@example.com" -f ~/.ssh/id_ed25519
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
   ssh-keygen -t ed25519 -C "you@example.com" -f ~/.ssh/id_ed25519
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
   ssh-keygen -t ed25519 -C "you@example.com" -f ~/.ssh/id_ed25519
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
the host and are never copied into the container. Follow the instructions for your platform below.

### macOS

macOS manages the SSH agent via launchd -- no extra tooling is needed. Add your key to the system keychain:

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

Keys added with `--apple-use-keychain` persist across restarts. The initialize script (`.devcontainer/initialize.sh`) automatically finds the macOS agent socket and creates the `~/.ssh/agent.sock` symlink that the devcontainer mounts.

### Linux/WSL

For passphrase-protected keys, use `keychain` to persist the agent across sessions:

Add the following to `~/.bashrc` or `~/.zshrc`:

```bash
# SSH agent setup
eval "$(keychain --eval --agents ssh id_ed25519)"

# Create stable symlink for devcontainer (only if not already correct)
export SSH_AUTH_SOCK_LINK="$HOME/.ssh/agent.sock"
if [ -S "$SSH_AUTH_SOCK" ] && [ -n "$SSH_AUTH_SOCK" ]; then
  [ -e "$SSH_AUTH_SOCK_LINK" ] && rm -f "$SSH_AUTH_SOCK_LINK"
  ln -sf "$SSH_AUTH_SOCK" "$SSH_AUTH_SOCK_LINK"
  export SSH_AUTH_SOCK="$SSH_AUTH_SOCK_LINK"
fi
```

`keychain` prompts for your passphrase once per reboot and reuses the agent across terminals. The symlink ensures the devcontainer can mount a consistent SSH agent path (`~/.ssh/agent.sock`) across reboots.

### Windows

Windows users develop inside WSL, so follow the [Linux/WSL](#linuxwsl) instructions above for SSH agent setup.

### Commit Signing

GitHub supports signed commits for verified badges. This is optional but recommended.

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

## Troubleshooting

### Devcontainer fails to start with SSH agent mount error

The SSH agent socket mount can fail after a reboot, sleep/wake cycle, or agent restart. The symptoms differ by platform but the root cause is the same: Docker tries to mount a socket path that no longer exists.

#### macOS

**Error**: `bind source path does not exist: /socket_mnt/private/tmp/com.apple.launchd.…/Listeners`

**Cause**: macOS launchd creates a new SSH agent socket path on each reboot (under `/private/tmp/com.apple.launchd.<random>/Listeners`). The `~/.ssh/agent.sock` symlink still points to the old path. Docker Desktop resolves the symlink through its Linux VM (the `/socket_mnt/` prefix), and the old target no longer exists.

**Solution** (run in a host terminal, not inside the container):

1. Ensure the agent has your key:

   ```bash
   ssh-add --apple-use-keychain ~/.ssh/id_ed25519
   ```

2. Refresh the symlink to the current socket:

   ```bash
   ln -sf "$SSH_AUTH_SOCK" ~/.ssh/agent.sock
   ```

3. Verify the symlink target is a live socket:

   ```bash
   ls -la ~/.ssh/agent.sock
   ```

4. **Rebuild the devcontainer** (not just Reopen): Command Palette > "Dev Containers: Rebuild Container"

> **Note:** "Reopen in Container" reuses the old container configuration with the stale mount path. You must **Rebuild** so Docker re-resolves the symlink target.

The `initialize.sh` script runs this symlink refresh automatically, but if the script's environment doesn't have `SSH_AUTH_SOCK` set (e.g., when VS Code launches from Spotlight rather than a terminal), it may pick up a stale value from `launchctl getenv`. Opening a fresh terminal and running the steps above ensures the correct socket path is used.

#### Linux / WSL

**Error**: `error mounting "..." to rootfs at "/ssh-agent": not a directory`

**Cause**: The SSH agent socket path changed after reboot, but the `~/.ssh/agent.sock` symlink still points to the old path.

**Solution**:

1. Restart your terminal or run: `source ~/.bashrc`
2. Verify the symlink exists: `ls -la ~/.ssh/agent.sock`
3. **Rebuild the devcontainer**: Command Palette > "Dev Containers: Rebuild Container"

If the symlink is missing or broken after reboot, ensure `keychain` is installed and configured in `~/.bashrc` (not just set in the current terminal session). The `keychain` approach creates a stable socket path that survives reboots, unlike the macOS launchd socket which changes each time.

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

## Secret Rotation

Rotate credentials regularly to limit the blast radius of a compromise.

| Credential                  | Recommended Schedule                  |
| --------------------------- | ------------------------------------- |
| GH_TOKEN (GitHub PAT)       | Every 90 days                         |
| SSH keys                    | Annually                              |
| Azure DevOps session        | Every 90 days                         |
| GitLab session              | Every 90 days                         |
| CONTEXT7_API_KEY / MCP keys | Per provider policy (check dashboard) |

### SSH Keys

1. Generate a new key:

   ```bash
   ssh-keygen -t ed25519 -C "you@example.com" -f ~/.ssh/id_ed25519_new
   ```

2. Add the new public key to GitHub at [SSH and GPG keys](https://github.com/settings/keys) (both as an **authentication key** and, if you sign commits, a **signing key**).

3. Update the allowed signers file:

   ```bash
   # macOS
   sed -i '' "s|$(cat ~/.ssh/id_ed25519.pub)|$(cat ~/.ssh/id_ed25519_new.pub)|" ~/.ssh/allowed_signers
   # Linux/WSL
   sed -i "s|$(cat ~/.ssh/id_ed25519.pub)|$(cat ~/.ssh/id_ed25519_new.pub)|" ~/.ssh/allowed_signers
   ```

   If this fails due to special characters in the key, replace the line manually in `~/.ssh/allowed_signers`.

4. Update git signing config (if signing commits):

   ```bash
   git config --global user.signingkey "$(cat ~/.ssh/id_ed25519_new.pub)"
   ```

5. Replace the old key:

   ```bash
   mv ~/.ssh/id_ed25519_new ~/.ssh/id_ed25519
   mv ~/.ssh/id_ed25519_new.pub ~/.ssh/id_ed25519.pub
   ```

6. Re-add the key to your SSH agent:

   ```bash
   # macOS
   ssh-add --apple-use-keychain ~/.ssh/id_ed25519
   # Linux/WSL
   ssh-add ~/.ssh/id_ed25519
   ```

7. Remove the old public key from GitHub after confirming the new key works:

   ```bash
   ssh -T git@github.com
   ```

### GH_TOKEN (GitHub PAT)

1. Generate a new classic token at [GitHub Settings > Personal access tokens (classic)](https://github.com/settings/tokens) with `repo` and `workflow` scopes.

2. Update `~/.secrets/.env`:

   ```text
   GH_TOKEN=<new-token>
   ```

3. Rebuild the devcontainer to pick up the new token (Command Palette > "Dev Containers: Rebuild Container").

4. Verify:

   ```bash
   gh auth status
   ```

### Azure DevOps

Azure CLI uses browser-based login. Re-authenticate when your session expires:

```bash
az login
```

### GitLab

Re-authenticate when your session or token expires:

```bash
glab auth login
```

If using a personal access token, generate a new one in GitLab > User Settings > Access Tokens, then re-run `glab auth login` with the new token.

### Dev Environment API Keys

For CONTEXT7_API_KEY and other MCP server API keys:

1. Regenerate the key from the provider's dashboard (e.g., [context7.com](https://context7.com) for CONTEXT7_API_KEY).

2. Update `~/.secrets/.env`:

   ```text
   CONTEXT7_API_KEY=<new-key>
   ```

3. Rebuild the devcontainer to pick up the new value.

## Development Commands

```bash
npm run build    # Compile TypeScript
npm test         # Run unit tests
npm run dev      # Run CLI via ts-node
./lint.sh        # Run linting (MegaLinter)
```
