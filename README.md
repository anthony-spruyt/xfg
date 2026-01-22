# xfg

[![CI](https://github.com/anthony-spruyt/xfg/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/anthony-spruyt/xfg/actions/workflows/ci.yaml)
[![npm version](https://img.shields.io/npm/v/@aspruyt/xfg.svg)](https://www.npmjs.com/package/@aspruyt/xfg)
[![npm downloads](https://img.shields.io/npm/dw/@aspruyt/xfg.svg)](https://www.npmjs.com/package/@aspruyt/xfg)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A CLI tool that syncs JSON, JSON5, YAML, or text configuration files across multiple GitHub, Azure DevOps, and GitLab repositories by creating pull requests.

**[Full Documentation](https://anthony-spruyt.github.io/xfg/)**

## Quick Start

```bash
# Install
npm install -g @aspruyt/xfg

# Authenticate (GitHub)
gh auth login

# Create config.yaml
cat > config.yaml << 'EOF'
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
EOF

# Run
xfg --config ./config.yaml
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
- **Merge Strategies** - Control how arrays merge (replace, append, prepend)
- **Override Mode** - Skip merging entirely for specific repos
- **Empty Files** - Create files with no content (e.g., `.prettierignore`)
- **YAML Comments** - Add header comments and schema directives to YAML files
- **Multi-Platform** - Works with GitHub, Azure DevOps, and GitLab (including self-hosted)
- **Auto-Merge PRs** - Automatically merge PRs when checks pass, or force merge with admin privileges
- **Dry-Run Mode** - Preview changes without creating PRs
- **Error Resilience** - Continues processing if individual repos fail
- **Automatic Retries** - Retries transient network errors with exponential backoff

## Documentation

Visit **[anthony-spruyt.github.io/xfg](https://anthony-spruyt.github.io/xfg/)** for:

- [Getting Started](https://anthony-spruyt.github.io/xfg/getting-started/) - Installation and prerequisites
- [Configuration](https://anthony-spruyt.github.io/xfg/configuration/) - Full configuration reference
- [Examples](https://anthony-spruyt.github.io/xfg/examples/) - Real-world usage examples
- [Platforms](https://anthony-spruyt.github.io/xfg/platforms/) - GitHub, Azure DevOps, GitLab setup
- [CI/CD Integration](https://anthony-spruyt.github.io/xfg/ci-cd/) - GitHub Actions, Azure Pipelines
- [Troubleshooting](https://anthony-spruyt.github.io/xfg/troubleshooting/)

## IDE Integration

For VS Code autocomplete and validation, add this comment to your config file:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json
files:
  # ...
repos:
  # ...
```
