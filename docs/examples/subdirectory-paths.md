# Subdirectory Paths

Sync files to any subdirectory path. Parent directories are created automatically.

## Example

```yaml
files:
  # GitHub Actions workflow
  ".github/workflows/ci.yaml":
    content:
      name: CI
      on: [push, pull_request]
      jobs:
        build:
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@v4

  # Nested config directory
  "config/settings/app.json":
    content:
      environment: production
      debug: false

repos:
  - git:
      - git@github.com:org/frontend.git
      - git@github.com:org/backend.git
```

## Result

Each repository gets:

```
.github/
  workflows/
    ci.yaml
config/
  settings/
    app.json
```

Parent directories (`.github/workflows/` and `config/settings/`) are created if they don't exist.

!!! note
Quote file paths containing `/` in YAML keys to ensure proper parsing.
