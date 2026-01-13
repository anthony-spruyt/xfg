# json-config-sync

[![CI](https://github.com/anthony-spruyt/json-config-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/anthony-spruyt/json-config-sync/actions/workflows/ci.yml)
[![Integration Test](https://github.com/anthony-spruyt/json-config-sync/actions/workflows/integration.yml/badge.svg)](https://github.com/anthony-spruyt/json-config-sync/actions/workflows/integration.yml)

A CLI tool that syncs JSON configuration files across multiple Git repositories by creating pull requests.

## Features

- Reads configuration from a YAML file
- Supports both GitHub and Azure DevOps repositories
- Creates PRs automatically using `gh` CLI (GitHub) or `az` CLI (Azure DevOps)
- Continues processing if individual repos fail
- Supports dry-run mode for testing
- Progress logging with summary report

## Installation

### From npm

```bash
npm install -g json-config-sync
```

### From Source

```bash
git clone https://github.com/anthony-spruyt/json-config-sync.git
cd json-config-sync
npm install
npm run build
```

### Using Dev Container

Open this repository in VS Code with the Dev Containers extension. The container includes all dependencies pre-installed and the project pre-built.

## Prerequisites

### GitHub Authentication

Before using with GitHub repositories, authenticate with the GitHub CLI:

```bash
gh auth login
```

### Azure DevOps Authentication

Before using with Azure DevOps repositories, authenticate with the Azure CLI:

```bash
az login
az devops configure --defaults organization=https://dev.azure.com/YOUR_ORG project=YOUR_PROJECT
```

## Usage

```bash
# Basic usage
json-config-sync --config ./config.yaml

# Dry run (no changes made)
json-config-sync --config ./config.yaml --dry-run

# Custom work directory
json-config-sync --config ./config.yaml --work-dir ./my-temp
```

### Options

| Option | Alias | Description | Required |
|--------|-------|-------------|----------|
| `--config` | `-c` | Path to YAML config file | Yes |
| `--dry-run` | `-d` | Show what would be done without making changes | No |
| `--work-dir` | `-w` | Temporary directory for cloning (default: `./tmp`) | No |

## Configuration Format

Create a YAML file with the following structure:

```yaml
fileName: my.config.json
repos:
  - git: git@github.com:example-org/repo1.git
    json:
      setting1: value1
      nested:
        setting2: value2
  - git: git@ssh.dev.azure.com:v3/example-org/project/repo2
    json:
      setting1: differentValue
      setting3: value
```

### Fields

| Field | Description |
|-------|-------------|
| `fileName` | The name of the JSON file to create/update in each repo |
| `repos` | Array of repository configurations |
| `repos[].git` | Git URL of the repository (SSH or HTTPS) |
| `repos[].json` | The JSON content to write to the file |

## Supported Git URL Formats

### GitHub
- SSH: `git@github.com:owner/repo.git`
- HTTPS: `https://github.com/owner/repo.git`

### Azure DevOps
- SSH: `git@ssh.dev.azure.com:v3/organization/project/repo`
- HTTPS: `https://dev.azure.com/organization/project/_git/repo`

## Workflow

For each repository in the config, the tool:

1. Cleans the temporary workspace
2. Detects if repo is GitHub or Azure DevOps
3. Clones the repository
4. Creates/checks out branch `chore/sync-{sanitized-filename}`
5. Generates the JSON file from config
6. Checks for changes (skips if no changes)
7. Commits and pushes changes
8. Creates a pull request

## Example

Given this config file (`config.yaml`):

```yaml
fileName: my.config.json
repos:
  - git: git@github.com:example-org/my-service.git
    json:
      environment: production
      settings:
        feature1: true
        feature2: false
```

Running:

```bash
json-config-sync --config ./config.yaml
```

Will:
1. Clone `example-org/my-service`
2. Create branch `chore/sync-my-config`
3. Write `my.config.json` with the specified content
4. Create a PR titled "chore: sync my.config.json"

## Development

```bash
# Run in development mode
npm run dev -- --config ./fixtures/test-repos-input.yaml --dry-run

# Run tests
npm test

# Build
npm run build
```

## License

MIT
