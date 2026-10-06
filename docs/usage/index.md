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

### Rendering Planned Files

`--render-dir <path>` (with `--dry-run`) also writes each planned file to disk, so other tools can test a change before it is synced. For example, a CI job can copy a repo's rendered files over a checkout of that repo and run its linters.

```bash
xfg sync --config ./config.yaml --dry-run --render-dir ./rendered
```

- Files that would be created or updated are written to `<path>/<repo>/<file>` with their planned content, where `<repo>` is the display name (`owner/repo` on GitHub). Files are readable by the owner only (`0600`, or `0700` for executable files).
- Unchanged files, skipped `createOnly` files and mode-only changes are not written.
- `<path>/render.json` lists, per repo, the files written and the files that would be deleted (orphans under `deleteOrphaned`):

```json
{
  "repos": {
    "org/repo": {
      "files": [".xfg.json", "lint.sh"],
      "deleted": [".pylintrc"]
    }
  }
}
```

A repo appears in `render.json` even when nothing would change, so an empty entry means "processed, no file changes". Repos that do not exist yet are not rendered. The directory must be empty or missing, so a rerun never mixes with stale output.

## CLI Options

See [CLI Options Reference](../reference/cli-options.md) for the full option list, aliases, and defaults.

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
