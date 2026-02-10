# CLI Options Reference

xfg uses subcommands to separate file sync (`sync`) from ruleset management (`settings`).

## Subcommands

| Command        | Description                                  |
| -------------- | -------------------------------------------- |
| `xfg sync`     | Sync configuration files across repositories |
| `xfg settings` | Manage GitHub Rulesets for repositories      |

## Sync Command

Sync configuration files across repositories.

```bash
xfg sync --config <path> [options]
```

!!! warning "Config Requirement"
    The sync command requires a `files` section with at least one file defined. If your config only has `settings`, use `xfg settings` instead.

### Sync Options

| Option             | Alias | Description                                        | Default                                        |
| ------------------ | ----- | -------------------------------------------------- | ---------------------------------------------- |
| `--config`         | `-c`  | Path to YAML config file                           | **Required**                                   |
| `--dry-run`        | `-d`  | Show what would be done without making changes     | `false`                                        |
| `--work-dir`       | `-w`  | Temporary directory for cloning                    | `./tmp`                                        |
| `--retries`        | `-r`  | Number of retries for network operations           | `3`                                            |
| `--branch`         | `-b`  | Override branch name                               | `chore/sync-{filename}` or `chore/sync-config` |
| `--merge`          | `-m`  | PR merge mode: `manual`, `auto`, `force`, `direct` | `auto`                                         |
| `--merge-strategy` |       | Merge strategy: `merge`, `squash`, `rebase`        | `squash`                                       |
| `--delete-branch`  |       | Delete source branch after merge                   | `true`                                         |
| `--no-delete`      |       | Skip deletion of orphaned files even if configured | `false`                                        |

### Sync Examples

```bash
# Basic sync
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

## Settings Command

Manage GitHub Rulesets for repositories. Creates, updates, or deletes rulesets to match your config.

```bash
xfg settings --config <path> [options]
```

!!! warning "Config Requirement"
    The settings command requires a `settings` section with actionable configuration (e.g., rulesets). If your config only has `files`, use `xfg sync` instead.

!!! note "GitHub-Only"
    The settings command only works with GitHub repositories. Azure DevOps and GitLab repos are skipped.

### Settings Options

| Option        | Alias | Description                                             | Default      |
| ------------- | ----- | ------------------------------------------------------- | ------------ |
| `--config`    | `-c`  | Path to YAML config file                                | **Required** |
| `--dry-run`   | `-d`  | Show what would be done without making changes          | `false`      |
| `--work-dir`  | `-w`  | Temporary directory (not used for settings, but shared) | `./tmp`      |
| `--retries`   | `-r`  | Number of retries for network operations                | `3`          |
| `--no-delete` |       | Skip deletion of orphaned rulesets                      | `false`      |

### Settings Examples

```bash
# Apply rulesets
xfg settings --config ./config.yaml

# Preview changes
xfg settings --config ./config.yaml --dry-run

# Apply without deleting orphans
xfg settings --config ./config.yaml --no-delete
```

### Settings Output

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

## Combined Workflow

Run both commands together:

```bash
# Sync files and apply rulesets
xfg sync -c config.yaml && xfg settings -c config.yaml

# Preview both
xfg sync -c config.yaml --dry-run
xfg settings -c config.yaml --dry-run
```

## Priority Order

CLI flags override config file settings:

1. CLI flags (highest priority)
2. Per-repo settings (e.g., `prOptions`, `settings.rulesets`)
3. Global settings
4. Built-in defaults (lowest priority)

## Exit Codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| `0`  | Success - all operations completed      |
| `1`  | Failure - one or more operations failed |
