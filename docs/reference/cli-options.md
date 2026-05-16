# CLI Options Reference

xfg uses a `sync` command to handle file synchronization, repository settings, rulesets, labels, and variables. A separate `secrets sync` command handles secret management.

## Sync Command

Sync configuration files, repository settings, rulesets, labels, and variables across repositories.

```bash
xfg sync --config <path> [options]
```

### Options

| Option             | Alias | Description                                                               | Default                                        |
| ------------------ | ----- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| `--config`         | `-c`  | Path to YAML config file                                                  | **Required**                                   |
| `--dry-run`        | `-d`  | Show what would be done without making changes                            | `false`                                        |
| `--work-dir`       | `-w`  | Temporary directory for cloning                                           | `./tmp`                                        |
| `--retries`        | `-r`  | Number of retries for network operations                                  | `3`                                            |
| `--branch`         | `-b`  | Override branch name                                                      | `chore/sync-{filename}` or `chore/sync-config` |
| `--merge`          | `-m`  | PR merge mode: `manual`, `auto`, `force`, `direct`                        | `auto`                                         |
| `--merge-strategy` |       | Merge strategy: `merge`, `squash`, `rebase`                               | `squash`                                       |
| `--delete-branch`  |       | Delete source branch after merge                                          | `true`                                         |
| `--no-delete`      |       | Skip deletion of orphaned files, rulesets, labels, variables, and secrets | `false`                                        |

!!! note "GitHub-Only Settings"
    Repository settings, rulesets, labels, and variables management only works with GitHub repositories. Azure DevOps and GitLab repos are skipped for settings.

### Examples

```bash
# Basic sync (files + settings)
xfg sync --config ./config.yaml

# Dry run
xfg sync --config ./config.yaml --dry-run

# Custom branch
xfg sync --config ./config.yaml --branch feature/update-eslint

# Override merge behavior
xfg sync --config ./config.yaml --merge manual   # Leave PRs open
xfg sync --config ./config.yaml --merge force    # Force merge
xfg sync --config ./config.yaml --merge direct   # Push directly

# Skip orphan deletion
xfg sync --config ./config.yaml --no-delete
```

### Output

```text
Loading config from: ./config.yaml
Found 3 repositories with rulesets

[1/3] your-org/frontend: Processing rulesets...
[1/3] ✓ your-org/frontend: 1 created, 0 updated, 0 unchanged

[2/3] your-org/backend: Processing rulesets...
[2/3] ✓ your-org/backend: 0 created, 1 updated, 0 unchanged

[3/3] your-org/shared-lib: Processing rulesets...
[3/3] ✓ your-org/shared-lib: 0 created, 0 updated, 1 unchanged

==================================================
Completed: 3 succeeded, 0 skipped, 0 failed
```

## Secrets Sync Command

Sync GitHub Actions secrets to target repositories. Secret values are read from environment variables at runtime and encrypted with libsodium before upload.

```bash
xfg secrets sync --config <path> [options]
```

### Secrets Options

| Option        | Alias | Description                                                              | Default      |
| ------------- | ----- | ------------------------------------------------------------------------ | ------------ |
| `--config`    | `-c`  | Path to YAML config file                                                 | **Required** |
| `--dry-run`   | `-d`  | Show what would be done without making changes                           | `false`      |
| `--retries`   | `-r`  | Number of retries for network operations                                 | `3`          |
| `--no-delete` |       | Skip deletion of orphaned secrets even if `deleteOrphaned` is configured | `false`      |

!!! note "GitHub-Only"
    Secrets management only works with GitHub repositories. Non-GitHub repos are skipped.

### Secrets Examples

```bash
# Dry run (preview changes)
MY_SECRET=value xfg secrets sync --config ./config.yaml --dry-run

# Apply secrets
MY_SECRET=value xfg secrets sync --config ./config.yaml

# Skip orphan deletion
MY_SECRET=value xfg secrets sync --config ./config.yaml --no-delete
```

### Secrets Output

```text
[1/2] your-org/frontend: Secrets
  + MY_API_KEY
  + DATABASE_URL

[1/2] ✓ your-org/frontend: Secrets: 2 created, 0 updated, 0 deleted

[2/2] your-org/backend: Secrets
  ~ DEPLOY_TOKEN (update)

[2/2] ✓ your-org/backend: Secrets: 0 created, 1 updated, 0 deleted

==================================================
Completed: 2 succeeded, 0 skipped, 0 failed
```

## Priority Order

CLI flags override config file settings:

1. CLI flags (highest priority)
1. Per-repo settings (e.g., `prOptions`, `settings.rulesets`)
1. Conditional group settings (applied in array order)
1. Group settings (applied in order, later groups override earlier ones)
1. Global settings
1. Built-in defaults (lowest priority)

## Exit Codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| `0`  | Success - all operations completed      |
| `1`  | Failure - one or more operations failed |
