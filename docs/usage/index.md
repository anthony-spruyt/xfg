# Usage

xfg uses a single `sync` command to handle file synchronization, repository settings, rulesets, and labels.

## Basic Usage

```bash
# Sync files, settings, rulesets, and labels
xfg sync --config ./config.yaml

# Dry run — preview changes without applying
xfg sync --config ./config.yaml --dry-run
```

## Dry-Run Mode

The `--dry-run` flag lets you preview changes without actually making them.

**For files:**

- Files are compared but not written
- Commits and pushes are skipped
- PRs are not created

**For settings:**

- Rulesets are compared but not created/updated/deleted
- Labels are compared but not created/updated/deleted
- Repository settings are compared but not applied
- Shows planned changes (create, update, delete, unchanged)

```bash
xfg sync --config ./config.yaml --dry-run
```

### Content Diffs for JSON/YAML Files

For structured data files (`.json`, `.json5`, `.yaml`, `.yml`), xfg shows unified content diffs in both CLI output and GitHub Step Summary. This applies to all modes (dry-run and apply) and all actions (create, update, delete).

```text
~ org/repo
    ~ config.json
      @@ -1,3 +1,3 @@
       {
      -  "old": true
      +  "new": true
       }
    + new-config.yaml
      @@ -0,0 +1,2 @@
      +key: value
      +other: setting
```

Non-structured files (`.sh`, `.md`, `.txt`, etc.) show only the file path without content diffs.

## CLI Options

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
| `--no-delete`      |       | Skip deletion of orphaned files, rulesets, and labels                          | No       |

!!! note
    Settings management (rulesets, labels, repo settings) only works with GitHub repositories. Azure DevOps and GitLab repos are skipped for settings.

## Console Output

```text
[1/3] Processing example-org/repo1...
  ✓ Cloned repository
  ✓ Closed existing PR and deleted branch
  ✓ Created branch chore/sync-config
  ✓ Wrote .eslintrc.json
  ✓ Wrote .prettierrc.yaml
  ✓ Committed changes
  ✓ Pushed to remote
  ✓ Created PR: https://github.com/example-org/repo1/pull/42

[2/3] Processing example-org/repo2...
  ✓ Cloned repository
  ✓ Created branch chore/sync-config
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
  ✓ Created PR: https://github.com/example-org/repo3/pull/15

Summary: 2 succeeded, 1 skipped, 0 failed
```

## Created PRs

The tool creates PRs with:

- **Title:** `chore: sync config files` (or lists files if ≤3)
- **Branch:** `chore/sync-config` (or custom `--branch`)
- **Body:** Describes the sync action and lists changed files
