# Migrating from v3 to v4

v4 merges the `settings` command into `sync`, simplifying the CLI to a single command.

## Breaking Changes

### 1. `xfg settings` command removed

The `settings` command no longer exists. Use `xfg sync` instead — it handles both files and settings in a single run.

**Before (v3):**

```bash
xfg sync -c config.yaml
xfg settings -c config.yaml
```

**After (v4):**

```bash
xfg sync -c config.yaml
```

Settings-only configs (no `files` section) are now accepted by `xfg sync`.

### 2. GitHub Action `command` input removed

The `command` input has been removed from the GitHub Action. The action always runs `xfg sync`.

**Before (v3):**

```yaml
- uses: anthony-spruyt/xfg@v3
  with:
    command: settings
    config: ./config.yaml
```

**After (v4):**

```yaml
- uses: anthony-spruyt/xfg@v4
  with:
    config: ./config.yaml
```

### 3. `deleteOrphaned` behavior change for rulesets and labels

In v3, orphan detection for rulesets and labels used a manifest file to track which items were previously managed. In v4, orphan detection uses a **desired-state model** — any ruleset or label on the repo that isn't in your config is considered orphaned.

**Impact:** If you have `deleteOrphaned: true` and your repos have rulesets or labels that were created outside of xfg, they will be deleted on the first v4 run.

**Mitigation:** Add those rulesets/labels to your config, or use `--no-delete` on the first run to preview what would be deleted.

### 4. Manifest auto-migration (V3 → V4)

The manifest file (`.xfg-manifest.json`) format has been updated to V4. The migration happens automatically — v4 reads your existing V3 manifest and upgrades it in place. The V4 manifest only tracks files (not rulesets or labels).

## No Changes Required

- **Config file format** — Your YAML config files work as-is
- **Settings syntax** — The `settings` block in configs is unchanged
- **CLI flags** — `--dry-run`, `--no-delete`, `--config` all work the same way
