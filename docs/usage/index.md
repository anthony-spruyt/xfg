# Usage

## Basic Usage

```bash
# Basic usage
xfg --config ./config.yaml

# Dry run (no changes made)
xfg --config ./config.yaml --dry-run

# Custom work directory
xfg --config ./config.yaml --work-dir ./my-temp

# Custom branch name
xfg --config ./config.yaml --branch feature/update-eslint
```

## Dry-Run Mode

The `--dry-run` flag lets you preview changes without actually making them. In dry-run mode:

- Files are compared but not written
- Commits and pushes are skipped
- PRs are not created
- You can see exactly what would change

```bash
xfg --config ./config.yaml --dry-run
```

## CLI Options

| Option             | Alias | Description                                                                    | Required |
| ------------------ | ----- | ------------------------------------------------------------------------------ | -------- |
| `--config`         | `-c`  | Path to YAML config file                                                       | Yes      |
| `--dry-run`        | `-d`  | Show what would be done without making changes                                 | No       |
| `--work-dir`       | `-w`  | Temporary directory for cloning (default: `./tmp`)                             | No       |
| `--retries`        | `-r`  | Number of retries for network operations (default: 3)                          | No       |
| `--branch`         | `-b`  | Override branch name (default: `chore/sync-{filename}` or `chore/sync-config`) | No       |
| `--merge`          | `-m`  | PR merge mode: `manual`, `auto` (default), `force` (bypass checks)             | No       |
| `--merge-strategy` |       | Merge strategy: `merge`, `squash` (default), `rebase`                          | No       |
| `--delete-branch`  |       | Delete source branch after merge                                               | No       |

## Console Output

```
[1/3] Processing example-org/repo1...
  ✓ Cloned repository
  ✓ Created branch chore/sync-config
  ✓ Wrote .eslintrc.json
  ✓ Wrote .prettierrc.yaml
  ✓ Committed changes
  ✓ Pushed to remote
  ✓ Created PR: https://github.com/example-org/repo1/pull/42

[2/3] Processing example-org/repo2...
  ✓ Cloned repository
  ✓ Checked out existing branch chore/sync-config
  ✓ Wrote .eslintrc.json
  ✓ Wrote .prettierrc.yaml
  ⊘ No changes detected, skipping

[3/3] Processing example-org/repo3...
  ✓ Cloned repository
  ✓ Created branch chore/sync-config
  ✓ Wrote .eslintrc.json
  ✓ Wrote .prettierrc.yaml
  ✓ Committed changes
  ✓ Pushed to remote
  ✓ PR already exists: https://github.com/example-org/repo3/pull/15

Summary: 2 succeeded, 1 skipped, 0 failed
```

## Created PRs

The tool creates PRs with:

- **Title:** `chore: sync config files` (or lists files if ≤3)
- **Branch:** `chore/sync-config` (or custom `--branch`)
- **Body:** Describes the sync action and lists changed files
