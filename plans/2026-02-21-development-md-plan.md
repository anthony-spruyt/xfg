# DEVELOPMENT.md + Cross-platform Devcontainer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create contributor onboarding docs and fix the devcontainer to work on macOS (not just Linux/WSL).

**Architecture:** Extract the Linux-only `initializeCommand` into a cross-platform shell script, then create a `DEVELOPMENT.md` adapted from [claude-config's DEVELOPMENT.md](https://github.com/anthony-spruyt/claude-config/blob/main/DEVELOPMENT.md) with xfg-specific content.

**Tech Stack:** Bash, VS Code Dev Containers, Markdown

**Design doc:** `plans/2026-02-21-development-md-design.md`

---

### Task 1: Create cross-platform initialize script

**Files:**

- Create: `.devcontainer/initialize.sh`

**Step 1: Create `.devcontainer/initialize.sh`**

```bash
#!/bin/bash
set -euo pipefail

# Cross-platform SSH agent socket setup for devcontainer.
# Creates a stable symlink at ~/.ssh/agent.sock so the devcontainer
# can mount a consistent path regardless of the host OS.

AGENT_SOCK="$HOME/.ssh/agent.sock"

mkdir -p "$HOME/.ssh"

case "$(uname -s)" in
  Darwin)
    # macOS: SSH agent is managed by launchd. Find the socket.
    SOCK="${SSH_AUTH_SOCK:-$(launchctl getenv SSH_AUTH_SOCK 2>/dev/null || true)}"
    if [ -z "$SOCK" ] || [ ! -S "$SOCK" ]; then
      echo "ERROR: No SSH agent socket found on macOS."
      echo "Run: ssh-add --apple-use-keychain ~/.ssh/id_ed25519"
      exit 1
    fi
    rm -f "$AGENT_SOCK"
    ln -sf "$SOCK" "$AGENT_SOCK"
    echo "SSH agent socket linked (macOS): $SOCK -> $AGENT_SOCK"
    ;;
  Linux)
    # Linux/WSL: Use keychain to manage the SSH agent.
    # Requires: sudo apt install keychain (or equivalent)
    if ! command -v keychain &>/dev/null; then
      echo "ERROR: keychain not found. Install with: sudo apt install keychain"
      exit 1
    fi
    eval "$(keychain --eval --agents ssh id_ed25519)"
    flock -x "$HOME/.ssh/agent.lock" -c "rm -f '$AGENT_SOCK'; ln -sf '$SSH_AUTH_SOCK' '$AGENT_SOCK'"
    echo "SSH agent socket linked (Linux): $SSH_AUTH_SOCK -> $AGENT_SOCK"
    ;;
  *)
    echo "ERROR: Unsupported OS: $(uname -s)"
    echo "Manually create symlink: ln -sf \$SSH_AUTH_SOCK ~/.ssh/agent.sock"
    exit 1
    ;;
esac
```

**Step 2: Make it executable and verify syntax**

Run: `chmod +x .devcontainer/initialize.sh && bash -n .devcontainer/initialize.sh`
Expected: No output (syntax OK)

**Step 3: Commit**

```bash
git add .devcontainer/initialize.sh
git commit -m "feat(devcontainer): add cross-platform SSH agent initialize script"
```

---

### Task 2: Update devcontainer.json to use initialize script

**Files:**

- Modify: `.devcontainer/devcontainer.json:26` (the `initializeCommand` line)

**Step 1: Replace the inline initializeCommand**

Change line 26 from:

```json
"initializeCommand": "bash -lc 'eval $(keychain --eval --agents ssh id_ed25519); flock -x ~/.ssh/agent.lock -c \"rm -rf $HOME/.ssh/agent.sock; ln -sf $SSH_AUTH_SOCK $HOME/.ssh/agent.sock\"'",
```

To:

```json
"initializeCommand": "bash ${localWorkspaceFolder}/.devcontainer/initialize.sh",
```

**Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('.devcontainer/devcontainer.json','utf8'))"`
Expected: No output (valid JSON)

**Step 3: Commit**

```bash
git add .devcontainer/devcontainer.json
git commit -m "refactor(devcontainer): extract initializeCommand to cross-platform script"
```

---

### Task 3: Create DEVELOPMENT.md

**Files:**

- Create: `DEVELOPMENT.md`

**Reference:** Fetch the claude-config DEVELOPMENT.md for structure:

```bash
gh api repos/anthony-spruyt/claude-config/contents/DEVELOPMENT.md --jq '.content' | base64 -d
```

**Step 1: Create `DEVELOPMENT.md`**

Adapt the reference with these xfg-specific changes:

1. **Prerequisites** — Same as reference (VS Code, Docker Desktop, SSH agent, `~/.secrets/.env`)
2. **Host Directory Structure** — `~/.secrets/.env` needs `GH_TOKEN` (and optionally `CONTEXT7_API_KEY`). Same `~/.claude/` mount.
3. **SSH Agent Setup** — Same 3 platform sections (macOS, Linux/WSL, Windows). The macOS section should note that no extra tooling is needed (unlike Linux which needs `keychain`). The Linux section references the same `keychain` setup.
4. **SSH Commit Signing** — Same as reference.
5. **Troubleshooting: SSH mount error** — Same as reference, plus add a macOS-specific note about the agent socket path changing.
6. **GitHub CLI Setup** — Same as reference.
7. **Opening the Devcontainer** — Same as reference.
8. **Included Tools** — Update list to xfg's tools:
   - Docker-in-Docker
   - Node.js
   - Python
   - Pre-commit hooks (gitleaks, prettier, yamllint, trailing-whitespace, etc.)
   - Safe-chain (supply chain protection)
   - GitHub CLI (`gh`)
   - Azure CLI (`az`) with Azure DevOps extension
   - GitLab CLI (`glab`)
   - Git Credential Manager (for Azure DevOps git auth)
   - Claude Code CLI
9. **Platform Authentication** (NEW section, not in reference) — Document post-container-open auth steps:
   - Azure DevOps: `az login` then `az devops configure --defaults organization=https://dev.azure.com/ORG`
   - GitLab: `glab auth login`
   - GitHub: Already authenticated via `GH_TOKEN` in `~/.secrets/.env`
10. **Development Commands** (NEW section) — Document:
    - `npm run build` — Compile TypeScript
    - `npm test` — Run unit tests
    - `npm run dev` — Run CLI via ts-node
    - `./lint.sh` — Run linting (MegaLinter)
11. **Remove** the "Verify Setup" section from the reference — this project runs verification inline in `post-create.sh` during container creation.

**Step 2: Verify markdown renders correctly**

Run: `npx prettier --check DEVELOPMENT.md`
Expected: PASS or auto-fixable formatting only

**Step 3: Commit**

```bash
git add DEVELOPMENT.md
git commit -m "docs: add DEVELOPMENT.md for contributor onboarding"
```

---

### Task 4: Final verification

**Step 1: Verify all files are committed**

Run: `git status`
Expected: Clean working tree

**Step 2: Run pre-commit on all changed files**

Run: `pre-commit run --all-files`
Expected: All checks pass

**Step 3: Run project lint**

Run: `./lint.sh`
Expected: Exit 0
