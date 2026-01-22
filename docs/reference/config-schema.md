# Config Schema Reference

The full JSON Schema for xfg configuration files is available at:

```
https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json
```

## Using the Schema

### In VS Code

Add a comment at the top of your config file:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json
files:
  # ...
repos:
  # ...
```

Or configure in `.vscode/settings.json`:

```json
{
  "yaml.schemas": {
    "https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json": [
      "**/sync-config.yaml",
      "**/config-sync.yaml"
    ]
  }
}
```

## Schema Structure

### Root Object

| Field        | Type        | Required | Description                       |
| ------------ | ----------- | -------- | --------------------------------- |
| `files`      | `object`    | Yes      | Map of filenames to file configs  |
| `repos`      | `array`     | Yes      | List of repository configurations |
| `prOptions`  | `PROptions` | No       | Global PR merge options           |
| `prTemplate` | `string`    | No       | Custom PR body template           |

### File Config

| Field           | Type                  | Required | Description                         |
| --------------- | --------------------- | -------- | ----------------------------------- |
| `content`       | `object/string/array` | No       | File content or `@path/to/file` ref |
| `mergeStrategy` | `string`              | No       | `replace`, `append`, `prepend`      |
| `createOnly`    | `boolean`             | No       | Only create if doesn't exist        |
| `executable`    | `boolean`             | No       | Mark file as executable             |
| `header`        | `string/array`        | No       | YAML header comment(s)              |
| `schemaUrl`     | `string`              | No       | YAML schema directive URL           |

### Repo Config

| Field       | Type           | Required | Description             |
| ----------- | -------------- | -------- | ----------------------- |
| `git`       | `string/array` | Yes      | Git URL(s)              |
| `files`     | `object`       | No       | Per-repo file overrides |
| `prOptions` | `PROptions`    | No       | Per-repo PR options     |

### PR Options

| Field           | Type      | Default  | Description                           |
| --------------- | --------- | -------- | ------------------------------------- |
| `merge`         | `string`  | `auto`   | `manual`, `auto`, `force`             |
| `mergeStrategy` | `string`  | `squash` | `merge`, `squash`, `rebase`           |
| `deleteBranch`  | `boolean` | `true`   | Delete branch after merge             |
| `bypassReason`  | `string`  | -        | Reason for bypass (Azure DevOps only) |

## Validation

The schema validates:

- Required fields (`files`, `repos`, `git`)
- Enum values (`mergeStrategy`, `merge`, etc.)
- Content types (object for JSON/YAML, string/array for text files)
- File path security (no path traversal in file references)
