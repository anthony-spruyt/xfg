# xfg

[![CI](https://github.com/anthony-spruyt/xfg/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/anthony-spruyt/xfg/actions/workflows/ci.yaml)
[![codecov](https://codecov.io/gh/anthony-spruyt/xfg/graph/badge.svg)](https://codecov.io/gh/anthony-spruyt/xfg)
[![npm version](https://img.shields.io/npm/v/@aspruyt/xfg.svg)](https://www.npmjs.com/package/@aspruyt/xfg)
[![npm downloads](https://img.shields.io/npm/dw/@aspruyt/xfg.svg)](https://www.npmjs.com/package/@aspruyt/xfg)
[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-xfg-blue?logo=github)](https://github.com/marketplace/actions/xfg-config-file-sync)
[![docs](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://anthony-spruyt.github.io/xfg/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A CLI tool that syncs JSON, JSON5, YAML, or text configuration files across multiple GitHub, Azure DevOps, and GitLab repositories. By default, changes are made via pull requests, but you can also push directly to the default branch.

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
      - uses: anthony-spruyt/xfg@v1
        with:
          config: ./sync-config.yaml
          github-token: ${{ secrets.SYNC_TOKEN }}
```

### CLI

```bash
# Install
npm install -g @aspruyt/xfg

# Authenticate (GitHub)
gh auth login

# Run
xfg --config ./config.yaml
```

### Example Config

```yaml
# sync-config.yaml
files:
  .prettierrc.json:
    content:
      semi: false
      singleQuote: true
      tabWidth: 2
      trailingComma: es5

repos:
  - git:
      - git@github.com:your-org/frontend-app.git
      - git@github.com:your-org/backend-api.git
      - git@github.com:your-org/shared-lib.git
```

**Result:** PRs are created in all three repos with identical `.prettierrc.json` files.

## Features

- **Multi-File Sync** - Sync multiple config files in a single run
- **Multi-Format Output** - JSON, JSON5, YAML, or plain text based on filename extension
- **Subdirectory Support** - Sync files to any path (e.g., `.github/workflows/ci.yaml`)
- **Text Files** - Sync `.gitignore`, `.markdownlintignore`, etc. with string or lines array
- **File References** - Use `@path/to/file` to load content from external template files
- **Content Inheritance** - Define base config once, override per-repo as needed
- **Multi-Repo Targeting** - Apply same config to multiple repos with array syntax
- **Environment Variables** - Use `${VAR}` syntax for dynamic values
- **Templating** - Use `${xfg:repo.name}` syntax for dynamic repo-specific content
- **Merge Strategies** - Control how arrays merge (replace, append, prepend)
- **Override Mode** - Skip merging entirely for specific repos
- **Empty Files** - Create files with no content (e.g., `.prettierignore`)
- **YAML Comments** - Add header comments and schema directives to YAML files
- **Multi-Platform** - Works with GitHub (including GitHub Enterprise Server), Azure DevOps, and GitLab (including self-hosted)
- **Auto-Merge PRs** - Automatically merge PRs when checks pass, or force merge with admin privileges
- **Direct Push Mode** - Push directly to default branch without creating PRs
- **Dry-Run Mode** - Preview changes without creating PRs
- **Error Resilience** - Continues processing if individual repos fail
- **Automatic Retries** - Retries transient network errors with exponential backoff

## Use Cases

### Platform Engineering Teams

Enforce organization-wide standards without requiring a monorepo. Push consistent tooling configs (linters, formatters, TypeScript settings) to hundreds of microservice repos from a single source of truth.

### CI/CD Workflow Standardization

Keep GitHub Actions workflows, Azure Pipelines, or GitLab CI configs in sync across all repos. Update a workflow once, create PRs everywhere.

### Security & Compliance Governance

Roll out security scanning configs (Dependabot, CodeQL, SAST tools) or compliance policies across your entire organization. Audit and update security settings from one place.

### Developer Experience Consistency

Sync `.editorconfig`, `.prettierrc`, `tsconfig.json`, and other DX configs so every repo feels the same. Onboard new team members faster with consistent tooling.

### Open Source Maintainers

Manage configuration across multiple related projects. Keep issue templates, contributing guidelines, and CI workflows consistent across your ecosystem.

### Configuration Drift Prevention

Detect and fix configuration drift automatically. Run xfg on a schedule to ensure repos stay in compliance with your standards.

**[See detailed use cases with examples →](https://anthony-spruyt.github.io/xfg/use-cases/)**

## Documentation

Visit **[anthony-spruyt.github.io/xfg](https://anthony-spruyt.github.io/xfg/)** for:

- [Getting Started](https://anthony-spruyt.github.io/xfg/getting-started/) - Installation and prerequisites
- [Configuration](https://anthony-spruyt.github.io/xfg/configuration/) - Full configuration reference
- [Examples](https://anthony-spruyt.github.io/xfg/examples/) - Real-world usage examples
- [Platforms](https://anthony-spruyt.github.io/xfg/platforms/) - GitHub, Azure DevOps, GitLab setup
- [CI/CD Integration](https://anthony-spruyt.github.io/xfg/ci-cd/) - GitHub Actions, Azure Pipelines
- [Troubleshooting](https://anthony-spruyt.github.io/xfg/troubleshooting/)
