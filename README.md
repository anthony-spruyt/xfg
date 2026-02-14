# xfg

[![CI](https://github.com/anthony-spruyt/xfg/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/anthony-spruyt/xfg/actions/workflows/ci.yaml)
[![codecov](https://codecov.io/gh/anthony-spruyt/xfg/graph/badge.svg)](https://codecov.io/gh/anthony-spruyt/xfg)
[![npm version](https://img.shields.io/npm/v/@aspruyt/xfg.svg)](https://www.npmjs.com/package/@aspruyt/xfg)
[![npm downloads](https://img.shields.io/npm/dw/@aspruyt/xfg.svg)](https://www.npmjs.com/package/@aspruyt/xfg)
[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-xfg-blue?logo=github)](https://github.com/marketplace/actions/xfg-repo-as-code)
[![docs](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://anthony-spruyt.github.io/xfg/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

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
      - uses: anthony-spruyt/xfg@v3
        with:
          command: sync
          config: ./sync-config.yaml
          github-token: ${{ secrets.GH_PAT }} # PAT with repo scope for cross-repo access
```

### CLI

```bash
# Install
npm install -g @aspruyt/xfg

# Authenticate (GitHub)
gh auth login

# Sync files across repos
xfg sync --config ./config.yaml

# Apply repository settings and rulesets
xfg settings --config ./config.yaml
```

### Example Config

```yaml
# sync-config.yaml
id: my-org-standards

files:
  .prettierrc.json:
    content:
      semi: false
      singleQuote: true
      tabWidth: 2

settings:
  repo:
    allowSquashMerge: true
    deleteBranchOnMerge: true
    vulnerabilityAlerts: true
    secretScanning: true

  rulesets:
    main-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include: [refs/heads/main]
          exclude: []
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1
        - type: required_status_checks
          parameters:
            requiredStatusChecks:
              - context: "ci/build"

repos:
  - git:
      - git@github.com:your-org/frontend-app.git
      - git@github.com:your-org/backend-api.git
```

**Result:** PRs are created with `.prettierrc.json` files, and repos get standardized merge options, security settings, and branch protection rulesets.

## Documentation

See **[anthony-spruyt.github.io/xfg](https://anthony-spruyt.github.io/xfg/)** for the full feature list, configuration reference, examples, platform setup, and troubleshooting.
