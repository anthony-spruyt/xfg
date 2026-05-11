# Content Inheritance

xfg uses a multi-level inheritance system that lets you define base configurations once and customize them per-repository. The basic chain is **root → repo overrides**. With [groups](groups.md), the chain becomes **root → group1 → group2 → repo overrides**. With [conditional groups](groups.md#conditional-groups), matching conditional groups merge after explicit groups: **root → groups →
conditional groups → repo overrides**. When groups use [`extends`](groups.md#group-inheritance), parent groups are automatically included in the chain before the child group.

## Inheritance Levels

### Level 1: Global File Content

Define base content at the file level that applies to all repos:

```yaml
files:
  service.config.json:
    content:
      version: "2.0"
      logging:
        level: info
        format: json
      features:
        - health-check
        - metrics
```

### Level 2: Group Layers (Optional)

Groups add intermediate layers between root and per-repo overrides. When a repo references groups via `groups: [...]`, each group's files are deep-merged onto the accumulated result in array order. See [Groups](groups.md) for full details.

### Level 3: Per-Repo Overlay

Add or override specific fields for certain repos:

```yaml
repos:
  - git: git@github.com:org/api-gateway.git
    files:
      service.config.json:
        content:
          team: platform # Added to base
          logging:
            level: debug # Overrides base
```

The result is a deep merge of base + overlay:

```json
{
  "version": "2.0",
  "logging": {
    "level": "debug",
    "format": "json"
  },
  "features": ["health-check", "metrics"],
  "team": "platform"
}
```

### Level 4: Per-Repo Override

Use `override: true` to completely replace the base content:

```yaml
repos:
  - git: git@github.com:org/legacy-api.git
    files:
      service.config.json:
        override: true
        content:
          version: "1.0"
          legacy: true
```

The base content is ignored entirely, only the override content is used.

## How Deep Merge Works

- **Objects**: Fields are merged recursively; overlay fields overwrite base fields
- **Arrays**: By default, overlay arrays replace base arrays (see [Merge Strategies](merge-strategies.md) to change this)
- **Settings arrays**: By default, overlay arrays replace base arrays in settings too (rulesets, bypass actors, rules, conditions). Use the [`$arrayMerge` directive](merge-strategies.md#settings-array-merge) to append or prepend instead — same syntax as file content.
- **Scalars**: Overlay values replace base values

## File Exclusion

Set a file to `false` to exclude it from a specific repo:

```yaml
files:
  .eslintrc.json:
    content:
      extends: ["@company/base"]

repos:
  - git: git@github.com:org/frontend.git
    # Gets .eslintrc.json

  - git: git@github.com:org/legacy-repo.git
    files:
      .eslintrc.json: false # Excluded from this repo
```

## Skipping All Inherited Files

Use `inherit: false` to skip all root-level files for a specific repo. You can optionally add repo-specific files:

```yaml
files:
  .eslintrc.json:
    content:
      extends: ["@company/base"]
  .prettierrc.json:
    content:
      semi: true

repos:
  # Standard repo - gets all files
  - git: git@github.com:org/frontend.git

  # Settings-only repo - skip all files
  - git: git@github.com:org/settings-only.git
    files:
      inherit: false

  # Custom files repo - skip inherited, add custom
  - git: git@github.com:org/custom-repo.git
    files:
      inherit: false
      .custom-config.json:
        content:
          custom: true
```

When `inherit: false`:

- All files defined in root `files` are skipped
- Only files explicitly defined in the repo's `files` object are included
- `inherit: true` (or omitting `inherit`) means inherit all root files (default behavior)

## Example: Team-Specific Configurations

```yaml
files:
  service.config.json:
    content:
      version: "2.0"
      logging:
        level: info
        format: json
      features:
        - health-check
        - metrics

repos:
  # Platform team - add extra features
  - git:
      - git@github.com:org/api-gateway.git
      - git@github.com:org/auth-service.git
    files:
      service.config.json:
        content:
          team: platform
          features:
            $arrayMerge: append
            $values:
              - tracing
              - rate-limiting

  # Data team - different logging
  - git:
      - git@github.com:org/data-pipeline.git
      - git@github.com:org/analytics.git
    files:
      service.config.json:
        content:
          team: data
          logging:
            level: debug

  # Legacy service - completely different config
  - git: git@github.com:org/legacy-api.git
    files:
      service.config.json:
        override: true
        content:
          version: "1.0"
          legacy: true
```
