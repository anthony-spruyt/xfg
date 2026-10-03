# Devcontainer

Standardized development container synced across repos via repo-operator. Edits here must also land in repo-operator to survive the next sync.

## Architecture

The heavy lifting is baked into `docker.io/aspruyt/devcontainer-common` (mirrored from ghcr.io, whose CDN drops long layer downloads) (built from `container-images/devcontainer-common/`). That image includes:

- Python, Node, GitHub CLI, pre-commit
- Podman, with `podman`/`docker` wrappers at `/usr/local/bin` that run it via `sudo`
- safe-chain supply-chain protection
- `agent-run` policy-enforcing podman wrapper at `/usr/local/bin/agent-run`
- `devcontainer-post-create` runtime config script at `/usr/local/bin/devcontainer-post-create`

Repo-operator syncs a thin layer on top.

## Contents

- `devcontainer.json` — VS Code devcontainer spec: base image, repo-specific features, `runArgs`, mounts.
- `Dockerfile` — thin layer on `devcontainer-common` adding Nexus apt proxy when `NEXUS_URL` is set.
- `setup-devcontainer.sh` — repo-specific tooling install hook (called by `devcontainer-post-create`).
- `initialize.sh` — host-side SSH agent socket setup (runs before container creation).
- `post-start.sh` — runs every `post-start.d/*.sh` on each container start, before the editor or Claude attaches. Groups add hooks by syncing a file into `post-start.d/`. A failing hook only warns.
- `post-start.d/claude-plugins.sh` (`claude` group) — refreshes plugin marketplaces and updates user-scope and this repo's Claude Code plugins. `~/.claude` persists across rebuilds (host bind mount locally, home PVC on Coder), so `claude plugin install` alone never upgrades them.
- `podman-seccomp.json` — vendored podman default seccomp profile, synced by repo-operator. Applied to the outer container via `runArgs: --security-opt seccomp=<path>`.

## What `devcontainer-post-create` does at runtime

1. Git safe.directory config
2. safe-chain shell setup (shims)
3. pre-commit hook installation
4. Claude Code CLI install
5. Podman storage config (mounts the Coder containers disk when present)
6. Registry allow-list (enforcing short-name mode)
7. Calls `setup-devcontainer.sh` for repo-specific setup
8. Runs verification tests

## Security posture

- Non-root by default (`USER vscode`).
- Rootful Podman by design. Rootless cannot run nested (no cgroup delegation, no `/dev/net/tun`), and `vscode` has passwordless sudo anyway. Isolation comes from the devcontainer itself (WSL2) or the Kata VM (Coder).
- Registry allow-list with `short-name-mode = "enforcing"` — typo-squat pulls fail.
- Seccomp profile narrows host syscall surface vs `seccomp=unconfined`.
- `agent-run` wrapper enforces `--userns=auto`, `--read-only`, cap-drop ALL, `--no-new-privileges`, and a private bridge network. It is a guardrail against hostile images, not a boundary against the agent. No pids/memory/cpu limits: cgroups are not delegated. Coder only: the WSL devcontainer has no `CAP_SYS_ADMIN`, so `devcontainer-podman-config` defaults podman to the host network and UTS
  namespaces there. Plain `docker run` / `docker build` work; use them for trusted images only. The `warn-raw-container-run` hookify rule reminds agents of this once per session.
- `docker` is Podman (a symlink to the wrapper), so scripts written for CI's Docker run unchanged. Docker-only commands such as `docker buildx` do not work.

## Seccomp profile updates

Repo-operator manages `podman-seccomp.json` updates via Renovate. The updated JSON is synced to all repos automatically.

## Troubleshooting

- `podman info` reports `vfs` driver: `/etc/containers/storage.conf` missing or graphroot was populated by vfs — remove it (`sudo rm -rf /var/lib/containers/storage`) and rebuild the devcontainer.
- `newuidmap: exit status 1`: something called `/usr/bin/podman` directly (rootless). Use `podman` from `PATH`, which resolves to the `/usr/local/bin` wrapper.
