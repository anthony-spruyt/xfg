# Content Inheritance

xfg uses a 3-level inheritance system that lets you define base configurations once and customize them per-repository.

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

### Level 2: Per-Repo Overlay

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

### Level 3: Per-Repo Override

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
            values:
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
