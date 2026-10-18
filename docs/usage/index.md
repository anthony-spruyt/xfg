# Usage

xfg uses a single `sync` command to handle file synchronization, repository settings, rulesets, labels, code scanning, variables, collaborators, and environments. The `secrets sync` command manages secrets. See the [CLI Options Reference](../reference/cli-options.md#secrets-sync-command).

## Basic Usage

```bash
# Sync files and settings
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

- Rulesets and labels are compared but not created/updated/deleted
- Repository settings, code scanning, variables, collaborators and environments are compared but not applied
- Shows planned changes (create, update, delete, unchanged)

```bash
xfg sync --config ./config.yaml --dry-run
```

### Content Diffs

For every text file, xfg shows unified content diffs in both CLI output and GitHub Step Summary. This applies to all modes (dry-run and apply) and all actions (create, update, delete).

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

Files with a binary extension (images, fonts, archives, etc.) show only the file path without content diffs.

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
    Settings management only works with GitHub repositories. Azure DevOps and GitLab repos are skipped for settings.

## Console Output

```text
Loading config from: /work/config.yaml
Found 3 repositories to process
Target files: .eslintrc.json, .prettierrc.yaml
Branch: chore/sync-config

[1/3] example-org/repo1: Processing...
    Default branch: main (detected via remote HEAD)
    Closed existing PR and deleted branch for fresh sync
    Writing .eslintrc.json...
    Writing .prettierrc.yaml...
    Staging changes...
    Committed: 8c3f1e0a5b7d94e2c6a1f0b3d8e5a7c9b2f4d610 (verified: false)
    Creating pull request...
    Handling merge (mode: auto)...
    Auto-merge enabled. PR will merge when checks pass.
[1/3] ✓ example-org/repo1: PR created successfully
[2/3] example-org/repo2: Processing...
    Default branch: main (detected via remote HEAD)
    Writing .eslintrc.json...
    Writing .prettierrc.yaml...
[2/3] ⊘ example-org/repo2: Skipped - No changes detected
[3/3] example-org/repo3: Processing...
    Default branch: main (detected via remote HEAD)
    Writing .eslintrc.json...
    Writing .prettierrc.yaml...
    Staging changes...
    Committed: 1d9a47c2e8f05b36a4c7d1e9f2b8a0c5d3e6f741 (verified: false)
    Creating pull request...
    Handling merge (mode: auto)...
    Auto-merge enabled. PR will merge when checks pass.
[3/3] ✓ example-org/repo3: PR created successfully

~ example-org/repo1
    ~ .eslintrc.json
    + .prettierrc.yaml
    ~ .xfg.json

~ example-org/repo3
    + .eslintrc.json
    + .prettierrc.yaml
    + .xfg.json

Plan: 6 files (4 to create, 2 to update)
```

The sample is abridged: the report also prints each file's diff lines. `.xfg.json` appears when a file has `deleteOrphaned: true`.

## Created PRs

The tool creates PRs with:

- **Title:** `chore: sync <file>` for one file, `chore: sync <file>, <file>` for two or three, and `chore: sync N config files` for four or more. The `.xfg.json` manifest counts as a file
- **Branch:** `chore/sync-<file>` when the config has one unique file, otherwise `chore/sync-config` (or custom `--branch`)
- **Body:** Describes the sync action and lists the created, updated and deleted files
