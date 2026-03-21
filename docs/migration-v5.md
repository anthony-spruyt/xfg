# Migrating from v4 to v5

v5 simplifies the `$arrayMerge` syntax to a single, per-field directive style.

## Breaking Changes

### 1. `values` renamed to `$values`

The `values` key inside `$arrayMerge` directives has been renamed to `$values` for consistency — both directive keys now use the `$` prefix.

**Before (v4):**

```yaml
features:
  $arrayMerge: append
  values: ["custom-feature"]
```

**After (v5):**

```yaml
features:
  $arrayMerge: append
  $values: ["custom-feature"]
```

### 2. Sibling `$arrayMerge` syntax removed

In v4, you could place `$arrayMerge` as a sibling key that applied one strategy to ALL child arrays in that object. This syntax has been removed. Use per-field `$arrayMerge` + `$values` instead.

**Before (v4):**

```yaml
repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          $arrayMerge: append
          features: ["custom-feature"]
          tags: ["team-a"]
```

**After (v5):**

```yaml
repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          features:
            $arrayMerge: append
            $values: ["custom-feature"]
          tags:
            $arrayMerge: append
            $values: ["team-a"]
```

Each array field now declares its own strategy, giving you per-array control (e.g. `append` for one, `prepend` for another).

### 3. GitHub Action version

Update your workflow files from `@v4` to `@v5`:

**Before (v4):**

```yaml
- uses: anthony-spruyt/xfg@v4
  with:
    config: ./config.yaml
```

**After (v5):**

```yaml
- uses: anthony-spruyt/xfg@v5
  with:
    config: ./config.yaml
```

## No Changes Required

- **Config file format** — Your YAML config files work as-is (unless you use `$arrayMerge` directives)
- **Settings syntax** — The `settings` block (rulesets, labels, repo settings) is unchanged
- **CLI flags** — `--dry-run`, `--no-delete`, `--config` all work the same way
- **File-level `mergeStrategy`** — Still works exactly as before
