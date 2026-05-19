# Delete Orphaned Files

Track managed files and automatically delete them when removed from your config.

## How It Works

When you set `deleteOrphaned: true` on a file, xfg tracks it in a `.xfg.json` manifest file in each target repository. If you later remove that file from your config, xfg will delete it from the repos on the next sync.

## Basic Usage

```yaml
id: my-org-standards
files:
  .prettierrc.json:
    content:
      semi: false
      singleQuote: true
    deleteOrphaned: true # Track this file

repos:
  - git: git@github.com:org/repo.git
```

When you remove `.prettierrc.json` from this config and run xfg again, the file will be deleted from the target repo.

## Inheritance

`deleteOrphaned` follows the standard inheritance pattern:

1. **Global default** - Set at root level applies to all files
2. **Per-file** - Overrides global default for specific files
3. **Per-repo** - Overrides both global and per-file for specific repos

### Global Default

```yaml
id: my-org-standards
deleteOrphaned: true # Track all files by default

files:
  .prettierrc.json:
    content: { semi: false }
  .eslintrc.json:
    content: { extends: "standard" }
    deleteOrphaned: false # This file won't be tracked

repos:
  - git: git@github.com:org/repo.git
```

### Per-Repo Override

```yaml
id: my-org-standards
files:
  .prettierrc.json:
    content: { semi: false }
    deleteOrphaned: true

repos:
  - git: git@github.com:org/special-repo.git
    files:
      .prettierrc.json:
        deleteOrphaned: false # Don't track for this repo only
```

## Disabling at Runtime

Use the `--no-delete` CLI flag to skip deletion even if configured:

```bash
xfg sync --config config.yaml --no-delete
```

This is useful for:

- Testing changes before committing to deletions
- Running in environments where you want to sync but not delete

## The Manifest File

xfg creates a `.xfg.json` file in each target repository to track managed files. The manifest is namespaced by config ID, allowing multiple xfg configs to manage the same repo without conflicts:

```json
{
  "version": 2,
  "configs": {
    "my-org-standards": [".prettierrc.json", ".eslintrc.json"],
    "team-a-config": ["team-a-specific.json"]
  }
}
```

This file is committed alongside your synced files. Only files listed under a config's namespace can be deleted by that config.

## Multiple Configs

The `id` field enables multiple xfg configs to manage the same repository without interfering with each other. Each config only manages files in its own namespace:

- **Config A** (`id: team-a-standards`) manages `foo.json`, `bar.yaml`
- **Config B** (`id: team-b-standards`) manages `baz.json`

When Config A removes `foo.json` from its config, only `foo.json` is deleted - Config B's files are untouched.

## Dry Run

When using `--dry-run`, xfg shows which files would be deleted without making changes:

```bash
xfg sync --config config.yaml --dry-run
```

Output shows `[DELETED]` badges for files that would be removed.

## Safety Features

- **Opt-in by default**: Files are not tracked unless you explicitly set `deleteOrphaned: true`
- **Manifest-based**: Only files previously synced with `deleteOrphaned: true` can be deleted
- **Namespaced**: Each config ID has its own namespace - configs can't delete each other's files
- **Runtime override**: Use `--no-delete` to skip deletions at any time
- **Clear visibility**: Deleted files are shown prominently in dry-run output and PR descriptions
