# json-config-sync

A CLI tool that syncs JSON configuration files across multiple Git repositories by creating pull requests.

## Features

- Reads configuration from a YAML file
- Supports both GitHub and Azure DevOps repositories
- Creates PRs automatically using `gh` CLI (GitHub) or `az` CLI (Azure DevOps)
- Continues processing if individual repos fail
- Supports dry-run mode for testing
- Progress logging with summary report

## Installation

```bash
npm install
npm run build
```

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
npx json-config-sync --config ./config.yaml

# Dry run (no changes made)
npx json-config-sync --config ./config.yaml --dry-run

# Custom work directory
npx json-config-sync --config ./config.yaml --work-dir ./my-temp
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
fileName: appsec.config.json
repos:
  - git: git@github.com:org/repo1.git
    json:
      key1: value1
      nested:
        key2: value2
  - git: git@ssh.dev.azure.com:v3/org/project/repo2
    json:
      key1: differentValue
      anotherKey: value
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
fileName: appsec.config.json
repos:
  - git: git@github.com:myorg/service-a.git
    json:
      repoDefaultBranch: main
      snyk:
        orgId: abc-123
        environment: production
```

Running:

```bash
npx json-config-sync --config ./config.yaml
```

Will:
1. Clone `myorg/service-a`
2. Create branch `chore/sync-appsec-config`
3. Write `appsec.config.json` with the specified content
4. Create a PR titled "chore: sync appsec.config.json"

## Development

```bash
# Run in development mode
npm run dev -- --config ./tests/test-repos-input.yaml --dry-run

# Run tests
npm test

# Build
npm run build
```

## License

MIT
