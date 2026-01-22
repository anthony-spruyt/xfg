# File References

Load content from external template files instead of inline content.

## Example

```yaml
files:
  .prettierrc.json:
    content: "@templates/prettierrc.json"
  .eslintrc.yaml:
    content: "@templates/eslintrc.yaml"
    header: "Auto-generated - do not edit"
    schemaUrl: "https://json.schemastore.org/eslintrc"
  .gitignore:
    content: "@templates/gitignore.txt"

repos:
  - git: git@github.com:org/repo.git
```

## Directory Structure

```
config/
  sync-config.yaml         # content: "@templates/prettier.json"
  templates/
    prettierrc.json        # Actual Prettier config
    eslintrc.yaml          # Actual ESLint config
    gitignore.txt          # Template .gitignore content
```

## How It Works

- File references start with `@` followed by a relative path
- Paths are resolved relative to the config file's directory
- JSON/JSON5/YAML files are parsed as objects
- Other files are returned as strings
- Metadata fields (`header`, `schemaUrl`, `createOnly`, `mergeStrategy`) remain in the config

## Per-Repo Overlays Still Work

Per-repo content overlays merge onto the resolved file content:

```yaml
files:
  .eslintrc.json:
    content: "@templates/eslintrc.json" # Base config from file

repos:
  - git: git@github.com:org/frontend.git
    files:
      .eslintrc.json:
        content:
          extends: ["plugin:react/recommended"] # Merged with template
```

## Security

File references are restricted to the config file's directory tree:

| Reference                | Status  |
| ------------------------ | ------- |
| `@templates/config.json` | Valid   |
| `@../../../etc/passwd`   | Blocked |
| `@/etc/passwd`           | Blocked |

Attempts to escape the config directory will result in a validation error.
