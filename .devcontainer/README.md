# Devcontainer

Standardized development container synced across repos via repo-operator. Edits here must also land in repo-operator to survive the next sync.

## Contents

- `devcontainer.json` — VS Code devcontainer spec: base image, features, `runArgs`, mounts.
- `Dockerfile` — layered on top of `mcr.microsoft.com/devcontainers/base`.
- `post-create.sh` — runs once after container creation: installs Podman, pre-commit, safe-chain, agent-run, writes storage/registry configs.
- `setup-devcontainer.sh` — repo-specific tooling install hook (called by `post-create.sh`).
- `agent-run` — policy-enforcing wrapper around `podman run` for AI agents (rejects `--privileged`, `--network=host`, etc.).
- `package.json` — pins npm-installed tooling versions (e.g. `@aikidosec/safe-chain`).
- `podman-seccomp.json` — vendored podman default seccomp profile. Applied to the outer container via `runArgs: --security-opt seccomp=<path>`.
- `update-podman-seccomp.sh` — re-fetches `podman-seccomp.json` from the version pinned by Renovate.

## Security posture

- Non-root by default (`USER vscode`).
- Rootless Podman via `podman-docker` (`docker` CLI → `podman`).
- `/dev/fuse` injected so rootful path uses `fuse-overlayfs` (not `vfs`).
- Registry allow-list with `short-name-mode = "enforcing"` — typo-squat pulls fail.
- Seccomp profile narrows host syscall surface vs `seccomp=unconfined`. Allows the syscalls nested Podman needs (`unshare`, `clone3` with CLONE_NEWUSER, namespace `mount` flags); blocks the default-Docker denylist (`keyctl`, `kexec_load`, `bpf`, `perf_event_open`, `io_uring_*` abuse paths, `userfaultfd`, etc.). Cuts the container-escape attack surface on any image an agent pulls.
- `agent-run` wrapper enforces `--userns=auto`, `--read-only`, cap-drop ALL, `--no-new-privileges`, pids/memory/cpu limits.

## Seccomp profile updates

1. Renovate bumps `PODMAN_SECCOMP_VERSION` in `update-podman-seccomp.sh`.
2. Run `task dev-env:update-podman-seccomp` locally to refresh `podman-seccomp.json`.
3. Commit the updated JSON alongside the Renovate PR.
4. Rebuild the devcontainer to pick up the new profile.

If nested Podman breaks on a syscall after an update, either narrow which operation triggers it (and file upstream to `containers/common`) or add a local override allow rule before merging.

## Troubleshooting

- `podman info` reports `vfs` driver: `/etc/containers/storage.conf` missing or graphroot was populated by vfs — remove it (`sudo rm -rf /var/lib/containers/storage`) and re-run `post-create.sh`.
- Rootless `newuidmap: exit status 1` in WSL2: outer namespace lacks delegated subuid ranges. Use `sudo podman`; `lint.sh` handles this automatically.
- Pre-commit rewrites `podman-seccomp.json` on commit: `end-of-file-fixer` / tab-remover normalize the vendored file. Harmless — re-stage and commit.
