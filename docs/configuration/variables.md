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
id: variables
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

`inherit: false` does not clear an inherited `settings.variables.deleteOrphaned`. With `settings.variables.deleteOrphaned: true` at root, a repo that sets `inherit: false` has the inherited variables deleted from it, because they are not in its config. A variable set to `false` is deleted the same way. Set `settings.variables.deleteOrphaned: false` on the repo to keep them.

## Deleting Orphaned Variables

When `settings.variables.deleteOrphaned: true` is set, xfg deletes every repository variable that is not in the config, including variables created by hand. The config is the full list of variables:

```yaml
settings:
  variables:
    deleteOrphaned: true
    NODE_VERSION: "20"
    REGION: us-east-1
```

!!! warning
    `settings.variables.deleteOrphaned` is independent from the settings-level `settings.deleteOrphaned`. Set it directly on the `variables` block to enable orphan deletion for variables.

## Dry Run Output

When running with `--dry-run`, xfg shows a plan of changes without applying them:

```text
    your-org/frontend - Variables:
      Create:
        + variable "NODE_VERSION"
            value: "20"

        + variable "REGION"
            value: "us-east-1"

      Update:
        ~ variable "DEPLOY_ENV"
            value: "dev" → "production"

      Delete:
        - variable "OLD_VAR"

      Plan: 4 variables (2 to create, 1 to update, 1 to delete)
```

## How It Works

The `xfg sync` command:

1. Fetches current variables from the GitHub API
2. Compares them against the desired state in config (case-insensitive matching)
3. Shows a plan of changes
4. Creates, updates, or deletes variables to reach the desired state

## GitHub API Reference

Variables are managed via the [GitHub Actions Variables API](https://docs.github.com/en/rest/actions/variables):

- `GET /repos/{owner}/{repo}/actions/variables` — List variables
- `POST /repos/{owner}/{repo}/actions/variables` — Create a variable
- `PATCH /repos/{owner}/{repo}/actions/variables/{name}` — Update a variable
- `DELETE /repos/{owner}/{repo}/actions/variables/{name}` — Delete a variable
