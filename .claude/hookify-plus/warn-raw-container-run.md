---
name: warn-raw-container-run
enabled: true
event: bash
pattern: (^|\s|&&|\|\||;)(docker|podman)\s+run(\s|$)
action: warn
warn_once: true
---

**[warn-raw-container-run]** `docker` here is rootful Podman, not Docker. Pick the runner by workspace:

- **Coder** (`CODER_AGENT_URL` is set): use `agent-run` for any image you did not build. It adds `--userns=auto`, `--read-only`, `--cap-drop=ALL` and a private network. Set `AGENT_RUN_NET=none` for no network.
- **WSL devcontainer**: `agent-run` cannot work here (no `CAP_SYS_ADMIN`). Plain `docker run` / `docker build` work, but share the devcontainer's network. The devcontainer is the only boundary, so do not run untrusted images.

Check which one: `[ -n "" ] && echo coder || echo wsl`
