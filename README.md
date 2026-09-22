# xfg

[![CI](https://github.com/anthony-spruyt/xfg/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/anthony-spruyt/xfg/actions/workflows/ci.yaml) [![codecov](https://codecov.io/gh/anthony-spruyt/xfg/graph/badge.svg)](https://codecov.io/gh/anthony-spruyt/xfg) [![Socket Badge](https://badge.socket.dev/npm/package/@aspruyt/xfg)](https://socket.dev/npm/package/@aspruyt/xfg)
[![npm version](https://img.shields.io/npm/v/@aspruyt/xfg.svg)](https://www.npmjs.com/package/@aspruyt/xfg) [![npm downloads](https://img.shields.io/npm/dw/@aspruyt/xfg.svg)](https://www.npmjs.com/package/@aspruyt/xfg) [![GitHub Marketplace](https://img.shields.io/badge/Marketplace-xfg-blue?logo=github)](https://github.com/marketplace/actions/xfg-repo-as-code)
[![docs](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://anthony-spruyt.github.io/xfg/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Manage files, settings, and repositories across GitHub, Azure DevOps, and GitLab — declaratively, from a single YAML config.

Define your organization's standards once. xfg creates PRs to sync config files, applies repository settings and rulesets via API, and can even create, fork, or migrate repositories — all from one config file.

**[Full Documentation](https://anthony-spruyt.github.io/xfg/)**

## Quick Start

### GitHub Action

```yaml
# .github/workflows/sync-configs.yml
name: Sync Configs
on:
  push:
    branches: [main]
    paths: [sync-config.yaml]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthony-spruyt/xfg@v7 # x-release-please-major
        with:
          config: ./sync-config.yaml
          github-token: ${{ secrets.GH_PAT }} # PAT with repo scope for cross-repo access
```

### CLI

```bash
# Install
npm install -g @aspruyt/xfg

# Authenticate (GitHub)
gh auth login

# Sync files, settings, rulesets, and labels across repos
xfg sync --config ./config.yaml
```

## Documentation

See **[anthony-spruyt.github.io/xfg](https://anthony-spruyt.github.io/xfg/)** for the full feature list, [configuration reference](https://anthony-spruyt.github.io/xfg/latest/reference/config-schema/), [CLI options](https://anthony-spruyt.github.io/xfg/latest/reference/cli-options/), examples, platform setup, and troubleshooting.
