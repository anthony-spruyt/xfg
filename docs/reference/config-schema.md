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

| Field               | Type        | Required | Description                                         |
| ------------------- | ----------- | -------- | --------------------------------------------------- |
| `id`                | `string`    | Yes      | Unique config identifier (alphanumeric, `-`, `_`)   |
| `files`             | `object`    | \*       | Map of filenames to file configs                    |
| `groups`            | `object`    | \*       | Named config groups referenced by repos             |
| `conditionalGroups` | `array`     | \*       | Groups that activate based on repo group membership |
| `repos`             | `array`     | Yes      | List of repository configurations                   |
| `settings`          | `object`    | \*       | Repository settings (rulesets, labels, etc.)        |
| `prOptions`         | `PROptions` | No       | Global PR merge options                             |
| `prTemplate`        | `string`    | No       | Custom PR body template                             |
| `githubHosts`       | `array`     | No       | GitHub Enterprise Server hostnames                  |
| `deleteOrphaned`    | `boolean`   | No       | Global default for orphan file deletion             |

!!! note "files/settings/groups requirement"
    At least one of `files`, `settings`, `groups`, or `conditionalGroups` must be present. The `sync` command requires files defined in root `files`, in a group, or in a conditional group. The `settings` command requires `settings` at root, repo, group, or conditional group level.

### File Config

| Field            | Type                  | Required | Description                          |
| ---------------- | --------------------- | -------- | ------------------------------------ |
| `content`        | `object/string/array` | No       | File content or `@path/to/file` ref  |
| `mergeStrategy`  | `string`              | No       | `replace`, `append`, `prepend`       |
| `createOnly`     | `boolean`             | No       | Only create if doesn't exist         |
| `executable`     | `boolean`             | No       | Mark file as executable              |
| `header`         | `string/array`        | No       | YAML header comment(s)               |
| `schemaUrl`      | `string`              | No       | YAML schema directive URL            |
| `lineWidth`      | `number`              | No       | YAML line width (0 = no wrap)        |
| `template`       | `boolean`             | No       | Enable `${xfg:...}` variable support |
| `vars`           | `object`              | No       | Custom template variables            |
| `deleteOrphaned` | `boolean`             | No       | Track file for orphan deletion       |

### Group Config

| Field       | Type                 | Required | Description                                              |
| ----------- | -------------------- | -------- | -------------------------------------------------------- |
| `extends`   | `string \| string[]` | No       | Parent group name(s) to inherit from                     |
| `files`     | `object`             | No       | Files defined or overridden by this group                |
| `prOptions` | `PROptions`          | No       | PR options for repos using this group                    |
| `settings`  | `object`             | No       | Settings for repos using this group (supports `inherit`) |

Groups support `extends` (inherit from parent groups), `inherit: false` (discard accumulated files), `file: false` (remove a file), and full file config or override objects.

### Conditional Group Config

| Field       | Type        | Required | Description                                               |
| ----------- | ----------- | -------- | --------------------------------------------------------- |
| `when`      | `object`    | Yes      | Condition that determines when this group activates       |
| `files`     | `object`    | No       | Files defined or overridden (same capabilities as groups) |
| `prOptions` | `PROptions` | No       | PR options for matching repos                             |
| `settings`  | `object`    | No       | Settings for matching repos (supports `inherit`)          |

The `when` clause:

| Field   | Type       | Required | Description                                   |
| ------- | ---------- | -------- | --------------------------------------------- |
| `allOf` | `string[]` | \*       | All listed groups must be present on the repo |
| `anyOf` | `string[]` | \*       | At least one listed group must be present     |

At least one of `allOf` or `anyOf` is required. When both are specified, both conditions must be satisfied. See [Groups — Conditional Groups](../configuration/groups.md#conditional-groups).

### Repo Config

| Field       | Type           | Required | Description                                         |
| ----------- | -------------- | -------- | --------------------------------------------------- |
| `git`       | `string/array` | Yes      | Git URL(s)                                          |
| `files`     | `object`       | No       | Per-repo file overrides                             |
| `groups`    | `string[]`     | No       | Group names to apply (merged in order)              |
| `settings`  | `object`       | No       | Per-repo settings (rulesets, labels, repo settings) |
| `prOptions` | `PROptions`    | No       | Per-repo PR options                                 |
| `upstream`  | `string`       | No       | Fork from this URL if target doesn't exist          |
| `source`    | `string`       | No       | Migrate from this URL if target doesn't exist       |

!!! note "`upstream` and `source` are mutually exclusive"
    See [Repo Lifecycle](../configuration/lifecycle.md) for details.

### Per-Repo File Override

| Field            | Type                  | Required | Description                           |
| ---------------- | --------------------- | -------- | ------------------------------------- |
| `content`        | `object/string/array` | No       | Content overlay merged onto base      |
| `override`       | `boolean`             | No       | If true, ignore base content entirely |
| `createOnly`     | `boolean`             | No       | Override root-level createOnly        |
| `executable`     | `boolean`             | No       | Override root-level executable        |
| `header`         | `string/array`        | No       | Override root-level header            |
| `schemaUrl`      | `string`              | No       | Override root-level schemaUrl         |
| `lineWidth`      | `number`              | No       | Override root-level lineWidth         |
| `template`       | `boolean`             | No       | Override root-level template          |
| `vars`           | `object`              | No       | Per-repo template variables           |
| `deleteOrphaned` | `boolean`             | No       | Override file-level deleteOrphaned    |

### PR Options

| Field           | Type       | Default  | Description                                  |
| --------------- | ---------- | -------- | -------------------------------------------- |
| `merge`         | `string`   | `auto`   | `manual`, `auto`, `force`, `direct`          |
| `mergeStrategy` | `string`   | `squash` | `merge`, `squash`, `rebase`                  |
| `deleteBranch`  | `boolean`  | `true`   | Delete branch after merge                    |
| `bypassReason`  | `string`   | -        | Reason for bypass (Azure DevOps only)        |
| `labels`        | `string[]` | -        | Labels to apply to created PRs (GitHub only) |

## Validation

The schema validates:

- Required fields (`id`, `repos`, at least one of `files`, `settings`, or `groups`)
- Command-specific requirements (see below)
- Enum values (`mergeStrategy`, `merge`, etc.)
- Content types (object for JSON/YAML, string/array for text files)
- File path security (no path traversal in file references)

### Config Requirements

The `xfg sync` command accepts configs with files, settings, or both. At least one of `files`, `settings`, `groups`, or `conditionalGroups` must be present.
