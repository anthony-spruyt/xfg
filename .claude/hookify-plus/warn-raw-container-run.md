---
name: warn-raw-container-run
enabled: true
event: bash
action: warn
warn_once: true
mask_data: true
conditions:
  - field: command
    operator: command_match
    pattern: '^(docker|podman)(\s+-\S+)*\s+(container\s+)?run(\s|$)'
    fallback: '(^|\s|&&|\|\||;)(docker|podman)\s+(container\s+)?run(\s|$)'
---

**[warn-raw-container-run]** `docker` here is rootful Podman, not Docker. Pick the runner by workspace:

- **Coder** (`CODER_AGENT_URL` is set): use `agent-run` for any image you did not build. It adds `--userns=auto`, `--read-only`, `--cap-drop=ALL` and a private network. Set `AGENT_RUN_NET=none` for no network.
- **WSL devcontainer**: `agent-run` cannot work here (no `CAP_SYS_ADMIN`). Use plain `docker run` / `docker build` for trusted images only.

Check which one: `[ -n "${CODER_AGENT_URL:-}" ] && echo coder || echo wsl`
