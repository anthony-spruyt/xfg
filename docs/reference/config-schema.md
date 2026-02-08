# Config Schema Reference

The full JSON Schema for xfg configuration files is available at:

```text
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

| Field            | Type        | Required | Description                                       |
| ---------------- | ----------- | -------- | ------------------------------------------------- |
| `id`             | `string`    | Yes      | Unique config identifier (alphanumeric, `-`, `_`) |
| `files`          | `object`    | \*       | Map of filenames to file configs                  |
| `repos`          | `array`     | Yes      | List of repository configurations                 |
| `settings`       | `object`    | \*       | Repository settings (rulesets, etc.)              |
| `prOptions`      | `PROptions` | No       | Global PR merge options                           |
| `prTemplate`     | `string`    | No       | Custom PR body template                           |
| `githubHosts`    | `array`     | No       | GitHub Enterprise Server hostnames                |
| `deleteOrphaned` | `boolean`   | No       | Global default for orphan file deletion           |

!!! note "files/settings requirement"
At least one of `files` or `settings` must be present. The `sync` command requires `files`, while the `settings` command requires `settings`.

### File Config

| Field            | Type                  | Required | Description                          |
| ---------------- | --------------------- | -------- | ------------------------------------ |
| `content`        | `object/string/array` | No       | File content or `@path/to/file` ref  |
| `mergeStrategy`  | `string`              | No       | `replace`, `append`, `prepend`       |
| `createOnly`     | `boolean`             | No       | Only create if doesn't exist         |
| `executable`     | `boolean`             | No       | Mark file as executable              |
| `header`         | `string/array`        | No       | YAML header comment(s)               |
| `schemaUrl`      | `string`              | No       | YAML schema directive URL            |
| `template`       | `boolean`             | No       | Enable `${xfg:...}` variable support |
| `vars`           | `object`              | No       | Custom template variables            |
| `deleteOrphaned` | `boolean`             | No       | Track file for orphan deletion       |

### Repo Config

| Field       | Type           | Required | Description             |
| ----------- | -------------- | -------- | ----------------------- |
| `git`       | `string/array` | Yes      | Git URL(s)              |
| `files`     | `object`       | No       | Per-repo file overrides |
| `prOptions` | `PROptions`    | No       | Per-repo PR options     |

### Per-Repo File Override

| Field            | Type                  | Required | Description                           |
| ---------------- | --------------------- | -------- | ------------------------------------- |
| `content`        | `object/string/array` | No       | Content overlay merged onto base      |
| `override`       | `boolean`             | No       | If true, ignore base content entirely |
| `createOnly`     | `boolean`             | No       | Override root-level createOnly        |
| `executable`     | `boolean`             | No       | Override root-level executable        |
| `header`         | `string/array`        | No       | Override root-level header            |
| `schemaUrl`      | `string`              | No       | Override root-level schemaUrl         |
| `template`       | `boolean`             | No       | Override root-level template          |
| `vars`           | `object`              | No       | Per-repo template variables           |
| `deleteOrphaned` | `boolean`             | No       | Override file-level deleteOrphaned    |

### PR Options

| Field           | Type      | Default  | Description                           |
| --------------- | --------- | -------- | ------------------------------------- |
| `merge`         | `string`  | `auto`   | `manual`, `auto`, `force`             |
| `mergeStrategy` | `string`  | `squash` | `merge`, `squash`, `rebase`           |
| `deleteBranch`  | `boolean` | `true`   | Delete branch after merge             |
| `bypassReason`  | `string`  | -        | Reason for bypass (Azure DevOps only) |

## Validation

The schema validates:

- Required fields (`id`, `repos`, at least one of `files` or `settings`)
- Command-specific requirements (see below)
- Enum values (`mergeStrategy`, `merge`, etc.)
- Content types (object for JSON/YAML, string/array for text files)
- File path security (no path traversal in file references)

### Command-Specific Requirements

| Command        | Required Fields                                    |
| -------------- | -------------------------------------------------- |
| `xfg sync`     | `files` with at least one file defined             |
| `xfg settings` | `settings` with actionable config (e.g., rulesets) |

If you run the wrong command for your config, you'll see a helpful error:

```text
# Running sync with a settings-only config:
The 'sync' command requires a 'files' section with at least one file defined.
To manage repository settings instead, use 'xfg settings'.

# Running settings with a files-only config:
The 'settings' command requires a 'settings' section at root level or in at least one repo.
To sync files instead, use 'xfg sync'.
```
