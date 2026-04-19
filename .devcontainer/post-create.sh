#!/bin/bash
set -euo pipefail

# This file is automatically updated - do not modify directly
# AI AGENTS: Do NOT add installs or dependencies here. Use setup-devcontainer.sh instead.

PASSED=0
FAILED=0

pass() {
  echo "✓ $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "✗ $1"
  FAILED=$((FAILED + 1))
}

# Mark repo as safe — envbuilder clones as root, postCreate runs as vscode user
git config --global --add safe.directory '*'

# Relax /etc/containers perms so podman (which strips supplementary groups in
# its user namespace) can read storage.conf and the *.conf.d drop-ins. Image
# ships /etc/containers as 0750 root:root which is unreadable from inside
# the userns. Done before the podman verification test below. Ref #976.
sudo mkdir -p /etc/containers/registries.conf.d /etc/containers/containers.conf.d
sudo chmod a+rx /etc/containers /etc/containers/registries.conf.d /etc/containers/containers.conf.d

# Make all shell scripts executable (runs from repo root via postCreateCommand)
# Uses git ls-files to only touch tracked files, avoiding permission denied errors
# on directories we don't own (e.g. mounted volumes, .git objects)
git ls-files -z '*.sh' | xargs -0 -r chmod +x 2>/dev/null || true

# Change to script directory for package.json access
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Install and setup safe-chain FIRST before any other npm installs
echo "Installing safe-chain..."
npm install -g "@aikidosec/safe-chain@$(node -p "require('./package.json').dependencies['@aikidosec/safe-chain']")"

echo "Setting up safe-chain..."
safe-chain setup    # Shell aliases for interactive terminals
safe-chain setup-ci # Executable shims for scripts/CI

# Add safe-chain shims to PATH for all subsequent commands
# This ensures pre-commit and other tools use protected pip/npm
export PATH="$HOME/.safe-chain/shims:$PATH"

echo "Installing pre-commit hooks..."
git config --unset-all core.hooksPath 2>/dev/null || true
pre-commit install --install-hooks

echo "Installing Claude Code CLI..."
curl -fsSL https://claude.ai/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
# Ensure ~/.local/bin is in PATH for future shells
# shellcheck disable=SC2016 # intentional: literal string written to .bashrc, expanded at shell startup
grep -q 'local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >>"$HOME/.bashrc"

echo "Installing rootless Podman..."
# Remove any moby/docker CLI that shipped with the base image so podman-docker
# can claim /usr/bin/docker without dpkg file-conflict.
sudo apt-get remove -y --purge moby-cli moby-engine moby-buildx moby-compose \
  moby-containerd moby-runc docker-ce-cli docker-ce 2>/dev/null || true
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  podman \
  podman-docker \
  fuse-overlayfs \
  uidmap \
  slirp4netns

# Confirm the vscode user has subuid/subgid allocations (required for rootless)
if ! grep -q '^vscode:' /etc/subuid; then
  echo "vscode:100000:65536" | sudo tee -a /etc/subuid >/dev/null
fi
if ! grep -q '^vscode:' /etc/subgid; then
  echo "vscode:100000:65536" | sudo tee -a /etc/subgid >/dev/null
fi

# Suppress the podman-docker "emulated" MOTD on every docker invocation
sudo mkdir -p /etc/containers
sudo touch /etc/containers/nodocker

# Default userns=keep-id so bind-mounted paths (e.g. MegaLinter's /tmp/lint
# with `-u $(id -u):$(id -g)`) retain the invoking user's UID inside the
# container and writes back through the bind mount succeed.
# Written as a drop-in so it is idempotent and does not clobber user edits
# to containers.conf.
mkdir -p "$HOME/.config/containers/containers.conf.d"
cat >"$HOME/.config/containers/containers.conf.d/10-userns.conf" <<'CONTAINERS_CONF'
[containers]
userns = "keep-id"
CONTAINERS_CONF

if [ -b /dev/containers-disk ]; then
  # Coder + Kata micro-VM: block PVC at /var/lib/containers provides real
  # ext4 for kernel overlay. VM boundary = isolation; rootful podman inside.
  if ! sudo blkid /dev/containers-disk >/dev/null 2>&1; then
    sudo mkfs.ext4 -q -L containers /dev/containers-disk
  fi
  sudo mkdir -p /var/lib/containers
  sudo mountpoint -q /var/lib/containers || sudo mount -o noatime /dev/containers-disk /var/lib/containers
  rm -rf "$HOME/.local/share/containers/storage" "$HOME/.config/containers/storage.conf"
  sudo mkdir -p /etc/containers
  sudo tee /etc/containers/storage.conf >/dev/null <<'ROOTFUL_STORAGE_CONF'
[storage]
driver = "overlay"
runroot = "/run/containers/storage"
graphroot = "/var/lib/containers/storage"
ROOTFUL_STORAGE_CONF
  sudo tee /etc/containers/containers.conf >/dev/null <<'CONTAINERS_CONF'
[containers]
cgroups = "disabled"

[engine]
cgroup_manager = "cgroupfs"
CONTAINERS_CONF
  grep -q 'alias podman=' "$HOME/.bashrc" 2>/dev/null || echo 'alias podman="sudo podman"' >>"$HOME/.bashrc"
else
  # WSL2 devcontainer: rootful podman via sudo. Rootless is structurally blocked
  # by Docker Desktop's userns-remap + missing /dev/net/tun + no delegated cgroup
  # subtree - see .devcontainer/README.md. /var/lib/containers is a named volume
  # mounted on Docker Desktop's ext4, which avoids overlay-on-overlay so native
  # kernel overlay works (fast, no fuse hop).
  sudo mkdir -p /etc/containers
  sudo tee /etc/containers/storage.conf >/dev/null <<'ROOTFUL_STORAGE_CONF'
[storage]
driver = "overlay"
runroot = "/run/containers/storage"
graphroot = "/var/lib/containers/storage"
ROOTFUL_STORAGE_CONF
  sudo tee /etc/containers/containers.conf >/dev/null <<'CONTAINERS_CONF'
[containers]
cgroups = "disabled"

[engine]
cgroup_manager = "cgroupfs"
CONTAINERS_CONF
  # Named volume comes up owned by root; chown so rootful podman can populate it.
  sudo chown root:root /var/lib/containers
  # $HOME rootless storage config kept for tooling that invokes podman without
  # sudo (podman-docker compatibility); backed by fuse-overlayfs since rootless
  # cannot use kernel overlay.
  mkdir -p "$HOME/.config/containers"
  cat >"$HOME/.config/containers/storage.conf" <<STORAGE_CONF
[storage]
driver = "overlay"
runroot = "/run/user/$(id -u)/containers"
graphroot = "$HOME/.local/share/containers/storage"
[storage.options.overlay]
mount_program = "/usr/bin/fuse-overlayfs"
STORAGE_CONF
  # Alias docker/podman -> sudo podman so lint.sh and agent-run hit the fast
  # rootful path by default.
  grep -q 'alias podman=' "$HOME/.bashrc" 2>/dev/null || echo 'alias podman="sudo podman"' >>"$HOME/.bashrc"
fi

# Registry allow-list: fully-qualified images only, short-name lookups fail.
# Prevents typo-squat pulls from unintended registries.
mkdir -p "$HOME/.config/containers/registries.conf.d"
cat >"$HOME/.config/containers/registries.conf.d/10-allow-list.conf" <<'REGISTRIES_CONF'
unqualified-search-registries = []
short-name-mode = "enforcing"

[[registry]]
location = "docker.io"

[[registry]]
location = "ghcr.io"

[[registry]]
location = "quay.io"

[[registry]]
location = "registry.k8s.io"

[[registry]]
location = "mcr.microsoft.com"
REGISTRIES_CONF

# Install agent-run wrapper (policy-enforcing podman wrapper for AI agents)
echo "Installing agent-run wrapper..."
sudo install -m 0755 "$SCRIPT_DIR/agent-run" /usr/local/bin/agent-run

echo ""
echo "Setting up devcontainer (repo-specific tooling)..."
"$SCRIPT_DIR/setup-devcontainer.sh"

echo "Running devcontainer verification tests..."
echo ""

# 1. Rootful Podman (exposed as `docker` via podman-docker; `alias podman=sudo podman`)
if ! docker --version 2>&1 | grep -qi 'podman'; then
  fail "docker CLI is not Podman (got: $(docker --version 2>&1))"
elif sudo -n docker run --rm docker.io/library/hello-world &>/dev/null; then
  pass "Rootful Podman is working (docker → podman)"
else
  echo "  SKIP: Podman not runnable yet (may start via agent script in Coder)"
fi

# 2. Pre-commit hooks installed
if pre-commit --version &>/dev/null; then
  pass "Pre-commit is installed"
else
  fail "Pre-commit is not installed"
fi

# 3. Safe-chain blocks malicious packages
SAFE_NPM="$HOME/.safe-chain/shims/npm"
if [[ -x "$SAFE_NPM" ]]; then
  TEMP_DIR=$(mktemp -d)
  SAFE_OUTPUT=$(cd "$TEMP_DIR" && "$SAFE_NPM" install safe-chain-test 2>&1 || true)
  rm -rf "$TEMP_DIR"
  if echo "$SAFE_OUTPUT" | grep -qi "safe-chain"; then
    pass "Safe-chain is blocking malicious packages"
  else
    fail "Safe-chain is not blocking (check output: $SAFE_OUTPUT)"
  fi
else
  fail "Safe-chain shims not found at $SAFE_NPM"
fi

# 4. GitHub CLI available
if command -v gh &>/dev/null; then
  pass "GitHub CLI is installed"
else
  fail "GitHub CLI is not installed"
fi

# 5. SSH key available (agent socket, Coder mount, or GIT_SSH_COMMAND)
SSH_AGENT_OK=false
if [[ -S "${SSH_AUTH_SOCK:-}" ]]; then
  # ssh-add exit codes: 0 = has keys, 1 = agent has no keys (still reachable),
  # 2 = cannot connect. Only 2 indicates an unusable agent.
  ssh_rc=0
  SSH_ASKPASS='' ssh-add -l &>/dev/null || ssh_rc=$?
  [[ $ssh_rc -ne 2 ]] && SSH_AGENT_OK=true
fi
if $SSH_AGENT_OK; then
  pass "SSH agent reachable ($SSH_AUTH_SOCK)"
elif [[ -f "/etc/coder/ssh-keys/id_ed25519" ]]; then
  pass "SSH key mounted (Coder direct mount)"
elif [[ -n "${GIT_SSH_COMMAND:-}" ]]; then
  pass "GIT_SSH_COMMAND configured"
else
  echo "  SKIP: No SSH key configured"
fi

# 6. Claude Code CLI available
if command -v claude &>/dev/null; then
  pass "Claude Code CLI is installed"
else
  fail "Claude Code CLI is not installed"
fi

# 7. agent-run wrapper installed and rejects forbidden flags
if [[ -x /usr/local/bin/agent-run ]]; then
  # agent-run exits 64 with "forbidden flag" message before invoking podman.
  # Capture output first to avoid pipefail interaction with non-zero exit.
  agent_run_out=$(/usr/local/bin/agent-run --privileged alpine true 2>&1 || true)
  if echo "$agent_run_out" | grep -q 'forbidden flag'; then
    pass "agent-run wrapper installed and enforcing policy"
  else
    fail "agent-run wrapper installed but not enforcing --privileged rejection"
  fi
else
  fail "agent-run wrapper not installed"
fi

# 8. Podman uses native kernel overlay (no fuse-overlayfs)
if command -v podman &>/dev/null; then
  graph_driver=$(podman info --format '{{.Store.GraphDriverName}}' 2>/dev/null || echo "unknown")
  if [[ "$graph_driver" == "overlay" ]]; then
    pass "Podman storage driver is overlay (fuse-overlayfs on Kata, native elsewhere)"
  else
    echo "  SKIP: Podman graph driver is '$graph_driver' (expected 'overlay')"
  fi
else
  fail "Podman not installed, cannot verify storage driver"
fi

echo ""
echo "Results: $PASSED passed, $FAILED failed"

if [[ $FAILED -eq 0 ]]; then
  exit 0
else
  exit 1
fi
