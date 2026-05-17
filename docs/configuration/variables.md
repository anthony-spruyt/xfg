# GitHub Variables

xfg can manage GitHub Actions variables declaratively using the `sync` command. Define variables in your config file under `settings:`, and xfg will create, update, or delete them to match your desired state.

!!! note "GitHub-Only Feature"
    Variables are only available for GitHub repositories. Azure DevOps and GitLab repos will be skipped when syncing variables.

## Quick Start

```yaml
id: my-config

settings:
  variables:
    NODE_VERSION: "20"
    DEPLOY_ENV: production
    REGION: us-east-1

repos:
  - git: git@github.com:your-org/your-repo.git
```

```bash
# Preview changes (dry-run)
xfg sync -c config.yaml --dry-run

# Apply variables
xfg sync -c config.yaml
```

## Variable Naming Rules

Variable names must match `[A-Za-z_][A-Za-z0-9_]*` and may not start with `GITHUB_` (reserved by GitHub).

Valid examples:

```yaml
variables:
  NODE_VERSION: "20"
  _INTERNAL_FLAG: "true"
  deployRegion: us-west-2
```

Invalid examples (will be rejected):

```yaml
variables:
  GITHUB_TOKEN: "..."    # Reserved prefix
  123_VAR: "value"       # Cannot start with digit
  MY-VAR: "value"        # Hyphens not allowed
```

## Case-Insensitive Matching

Variable name matching is **case-insensitive** (GitHub treats variable names as case-insensitive). xfg normalizes names to uppercase when comparing against remote state.

## Inheritance

Variables support the same inheritance pattern as labels and rulesets. Root-level variables are inherited by all repos:

```yaml
settings:
  variables:
    NODE_VERSION: "20"
    DEPLOY_ENV: production

repos:
  - git: git@github.com:your-org/repo-a.git
    # Inherits both variables

  - git: git@github.com:your-org/repo-b.git
    settings:
      variables:
        DEPLOY_ENV: staging     # Override for this repo
        REGION: eu-west-1       # Add a repo-specific variable

  - git: git@github.com:your-org/repo-c.git
    settings:
      variables:
        inherit: false          # Skip all root variables
        CUSTOM_VAR: "value"

  - git: git@github.com:your-org/repo-d.git
    settings:
      variables:
        NODE_VERSION: false     # Opt out of a single root variable
```

### Opting Out

- `inherit: false` — discard all inherited variables (root + groups)
- `VAR_NAME: false` — exclude a single inherited variable for this repo

## Deleting Orphaned Variables

When `deleteOrphaned: true` is set on the `variables` block, variables that were previously managed by xfg but are no longer in the config will be deleted:

```yaml
settings:
  variables:
    deleteOrphaned: true
    NODE_VERSION: "20"
    REGION: us-east-1
```

!!! warning
    `deleteOrphaned` for variables is independent from the settings-level `deleteOrphaned`. Set it directly on the `variables` block to enable orphan deletion for variables.

## Dry Run Output

When running with `--dry-run`, xfg shows a plan of changes without applying them:

```text
[1/2] your-org/frontend: Variables (dry-run)
  + NODE_VERSION = "20"
  + REGION = "us-east-1"
  ~ DEPLOY_ENV: "dev" → "production"
  - OLD_VAR

[1/2] ✓ your-org/frontend: 2 created, 1 updated, 1 deleted (dry-run)
```

## How It Works

The `xfg sync` command:

1. Fetches current variables from the GitHub API
1. Compares them against the desired state in config (case-insensitive matching)
1. Shows a plan of changes
1. Creates, updates, or deletes variables to reach the desired state

## GitHub API Reference

Variables are managed via the [GitHub Actions Variables API](https://docs.github.com/en/rest/actions/variables):

- `GET /repos/{owner}/{repo}/actions/variables` — List variables
- `POST /repos/{owner}/{repo}/actions/variables` — Create a variable
- `PATCH /repos/{owner}/{repo}/actions/variables/{name}` — Update a variable
- `DELETE /repos/{owner}/{repo}/actions/variables/{name}` — Delete a variable
