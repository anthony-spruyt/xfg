# Usage

xfg uses subcommands to separate file sync from ruleset management.

## Commands

| Command        | Description                                  |
| -------------- | -------------------------------------------- |
| `xfg sync`     | Sync configuration files across repositories |
| `xfg settings` | Manage GitHub Rulesets for repositories      |

## Basic Usage

```bash
# Sync files
xfg sync --config ./config.yaml

# Apply rulesets
xfg settings --config ./config.yaml

# Dry run
xfg sync --config ./config.yaml --dry-run
xfg settings --config ./config.yaml --dry-run

# Combined workflow
xfg sync -c config.yaml && xfg settings -c config.yaml
```

## Dry-Run Mode

The `--dry-run` flag lets you preview changes without actually making them.

**For sync:**

- Files are compared but not written
- Commits and pushes are skipped
- PRs are not created

**For settings:**

- Rulesets are compared but not created/updated/deleted
- Shows planned changes (create, update, delete, unchanged)

```bash
xfg sync --config ./config.yaml --dry-run
xfg settings --config ./config.yaml --dry-run
```

## Sync CLI Options

| Option             | Alias | Description                                                                    | Required |
| ------------------ | ----- | ------------------------------------------------------------------------------ | -------- |
| `--config`         | `-c`  | Path to YAML config file                                                       | Yes      |
| `--dry-run`        | `-d`  | Show what would be done without making changes                                 | No       |
| `--work-dir`       | `-w`  | Temporary directory for cloning (default: `./tmp`)                             | No       |
| `--retries`        | `-r`  | Number of retries for network operations (default: 3)                          | No       |
| `--branch`         | `-b`  | Override branch name (default: `chore/sync-{filename}` or `chore/sync-config`) | No       |
| `--merge`          | `-m`  | PR merge mode: `manual`, `auto` (default), `force` (bypass checks), `direct`   | No       |
| `--merge-strategy` |       | Merge strategy: `merge`, `squash` (default), `rebase`                          | No       |
| `--delete-branch`  |       | Delete source branch after merge                                               | No       |
| `--no-delete`      |       | Skip deletion of orphaned files                                                | No       |

## Settings CLI Options

| Option        | Alias | Description                                    | Required |
| ------------- | ----- | ---------------------------------------------- | -------- |
| `--config`    | `-c`  | Path to YAML config file                       | Yes      |
| `--dry-run`   | `-d`  | Show what would be done without making changes | No       |
| `--retries`   | `-r`  | Number of retries for network operations       | No       |
| `--no-delete` |       | Skip deletion of orphaned rulesets             | No       |

!!! note
The settings command only works with GitHub repositories. Azure DevOps and GitLab repos are skipped.

## Console Output

```text
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
