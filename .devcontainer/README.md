# Devcontainer

Standardized development container synced across repos via repo-operator. Edits here must also land in repo-operator to survive the next sync.

## Architecture

The heavy lifting is baked into `ghcr.io/anthony-spruyt/devcontainer-common` (built from `container-images/devcontainer-common/`). That image includes:

- Python, Node, GitHub CLI, pre-commit
- Podman + podman-docker, fuse-overlayfs, uidmap, slirp4netns
- safe-chain supply-chain protection
- `agent-run` policy-enforcing podman wrapper at `/usr/local/bin/agent-run`
- `devcontainer-post-create` runtime config script at `/usr/local/bin/devcontainer-post-create`

Repo-operator syncs a thin layer on top.

## Contents

- `devcontainer.json` — VS Code devcontainer spec: base image, repo-specific features, `runArgs`, mounts.
- `Dockerfile` — thin layer on `devcontainer-common` adding Nexus apt proxy when `NEXUS_URL` is set.
- `setup-devcontainer.sh` — repo-specific tooling install hook (called by `devcontainer-post-create`).
- `initialize.sh` — host-side SSH agent socket setup (runs before container creation).
- `podman-seccomp.json` — vendored podman default seccomp profile, synced by repo-operator. Applied to the outer container via `runArgs: --security-opt seccomp=<path>`.

## What `devcontainer-post-create` does at runtime

1. Git safe.directory config
1. safe-chain shell setup (shims)
1. pre-commit hook installation
1. Claude Code CLI install
1. Podman storage config (auto-detects Kata vs WSL2)
1. Registry allow-list (enforcing short-name mode)
1. Calls `setup-devcontainer.sh` for repo-specific setup
1. Runs verification tests

## Security posture

- Non-root by default (`USER vscode`).
- Rootless Podman via `podman-docker` (`docker` CLI → `podman`).
- `/dev/fuse` injected so rootful path uses `fuse-overlayfs` (not `vfs`).
- Registry allow-list with `short-name-mode = "enforcing"` — typo-squat pulls fail.
- Seccomp profile narrows host syscall surface vs `seccomp=unconfined`.
- `agent-run` wrapper enforces `--userns=auto`, `--read-only`, cap-drop ALL, `--no-new-privileges`, pids/memory/cpu limits.

## Seccomp profile updates

Repo-operator manages `podman-seccomp.json` updates via Renovate. The updated JSON is synced to all repos automatically.

## Troubleshooting

- `podman info` reports `vfs` driver: `/etc/containers/storage.conf` missing or graphroot was populated by vfs — remove it (`sudo rm -rf /var/lib/containers/storage`) and rebuild the devcontainer.
- Rootless `newuidmap: exit status 1` in WSL2: outer namespace lacks delegated subuid ranges. Use `sudo podman`; `lint.sh` handles this automatically.
