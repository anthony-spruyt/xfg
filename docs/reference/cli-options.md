# CLI Options Reference

## Usage

```bash
xfg --config <path> [options]
```

## Options

| Option             | Alias | Description                                    | Default                                        |
| ------------------ | ----- | ---------------------------------------------- | ---------------------------------------------- |
| `--config`         | `-c`  | Path to YAML config file                       | **Required**                                   |
| `--dry-run`        | `-d`  | Show what would be done without making changes | `false`                                        |
| `--work-dir`       | `-w`  | Temporary directory for cloning                | `./tmp`                                        |
| `--retries`        | `-r`  | Number of retries for network operations       | `3`                                            |
| `--branch`         | `-b`  | Override branch name                           | `chore/sync-{filename}` or `chore/sync-config` |
| `--merge`          | `-m`  | PR merge mode: `manual`, `auto`, `force`       | `auto`                                         |
| `--merge-strategy` |       | Merge strategy: `merge`, `squash`, `rebase`    | `squash`                                       |
| `--delete-branch`  |       | Delete source branch after merge               | `true`                                         |

## Examples

### Basic Run

```bash
xfg --config ./config.yaml
```

### Dry Run

Preview changes without making them:

```bash
xfg --config ./config.yaml --dry-run
```

### Custom Branch

```bash
xfg --config ./config.yaml --branch feature/update-eslint
```

### Override Merge Behavior

```bash
# Leave PRs open for review
xfg --config ./config.yaml --merge manual

# Force merge (bypass checks)
xfg --config ./config.yaml --merge force
```

### Increase Retries

```bash
xfg --config ./config.yaml --retries 5
```

### Custom Work Directory

```bash
xfg --config ./config.yaml --work-dir ./my-temp
```

## Priority Order

CLI flags override config file settings:

1. CLI flags (highest priority)
2. Per-repo `prOptions`
3. Global `prOptions`
4. Built-in defaults (lowest priority)
