# Create-Only Files

Some files should only be created once as defaults, allowing repos to maintain their own versions.

## Example

```yaml
files:
  .trivyignore.yaml:
    createOnly: true # Only create if doesn't exist
    content:
      vulnerabilities: []

  .prettierignore:
    createOnly: true
    content:
      patterns:
        - "dist/"
        - "node_modules/"

  eslint.config.json:
    content: # Always synced (no createOnly)
      extends: ["@company/base"]

repos:
  - git: git@github.com:org/repo.git
    # .trivyignore.yaml and .prettierignore only created if missing
    # eslint.config.json always updated

  - git: git@github.com:org/special-repo.git
    files:
      .trivyignore.yaml:
        createOnly: false # Override: always sync this file
```

## Behavior

| File                 | `createOnly` | Behavior                           |
| -------------------- | ------------ | ---------------------------------- |
| `.trivyignore.yaml`  | `true`       | Created only if it doesn't exist   |
| `.prettierignore`    | `true`       | Created only if it doesn't exist   |
| `eslint.config.json` | not set      | Always synced (created or updated) |

## Per-Repo Override

You can override `createOnly` per-repo:

```yaml
files:
  .trivyignore.yaml:
    createOnly: true
    content:
      vulnerabilities: []

repos:
  # Uses createOnly: true
  - git: git@github.com:org/normal-repo.git

  # Override to always sync
  - git: git@github.com:org/special-repo.git
    files:
      .trivyignore.yaml:
        createOnly: false
```
