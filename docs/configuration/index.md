# Configuration Overview

xfg uses a YAML configuration file to define which files to sync and to which repositories.

## Basic Structure

```yaml
id: my-config # Unique identifier for this config (required)
files:
  my.config.json: # Target file (.json outputs JSON, .yaml/.yml outputs YAML)
    mergeStrategy: replace # Array merge strategy for this file (optional)
    content: # Base config content
      key: value

repos: # List of repositories
  - git: git@github.com:org/repo.git
    files: # Per-repo file overrides (optional)
      my.config.json:
        content:
          key: override
```

## Root-Level Fields

| Field            | Description                                                                                 | Required |
| ---------------- | ------------------------------------------------------------------------------------------- | -------- |
| `id`             | Unique identifier for this config. Used to namespace managed files in `.xfg.json` manifest. | Yes      |
| `files`          | Map of target filenames to configs                                                          | *        |
| `repos`          | Array of repository configurations                                                          | Yes      |
| `settings`       | Global settings like `rulesets` (GitHub Rulesets). See [GitHub Rulesets](rulesets.md).      | *        |
| `prOptions`      | Global PR merge options (can be overridden per-repo)                                        | No       |
| `prTemplate`     | Custom PR body template (inline or `@path/to/file` reference)                               | No       |
| `deleteOrphaned` | Global default for orphan deletion. Files/rulesets removed from config are deleted.         | No       |
| `githubHosts`    | Array of GitHub Enterprise hostnames (e.g., `github.mycompany.com`)                         | No       |

!!! note "files/settings requirement"
    At least one of `files` or `settings` must be present:

    - **`xfg sync`** requires `files` with at least one file
    - **`xfg settings`** requires `settings` with actionable config (e.g., rulesets)

    A config can have both for use with both commands.

## Per-File Fields

| Field            | Description                                                                                                                                         | Required |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `content`        | Base config: object for JSON/YAML files, string or string[] for text files, or `@path/to/file` to load from external template (omit for empty file) | No       |
| `mergeStrategy`  | Merge strategy: `replace`, `append`, `prepend` (for arrays and text lines)                                                                          | No       |
| `createOnly`     | If `true`, only create file if it doesn't exist                                                                                                     | No       |
| `executable`     | Mark file as executable. `.sh` files are auto-executable unless set to `false`. Set to `true` for non-.sh files.                                    | No       |
| `header`         | Comment line(s) at top of YAML files (string or array)                                                                                              | No       |
| `schemaUrl`      | Adds `# yaml-language-server: $schema=<url>` to YAML files                                                                                          | No       |
| `template`       | If `true`, enable `${xfg:...}` variable substitution. See [Templating](templating.md).                                                              | No       |
| `vars`           | Custom template variables (object with string values). Accessible as `${xfg:varName}`.                                                              | No       |
| `deleteOrphaned` | If `true`, track file for orphan deletion. Removing it from config will delete it from repos.                                                       | No       |

## Per-Repo Fields

| Field       | Description                                                   | Required |
| ----------- | ------------------------------------------------------------- | -------- |
| `git`       | Git URL (string) or array of URLs                             | Yes      |
| `files`     | Per-repo file overrides (optional)                            | No       |
| `settings`  | Per-repo settings like `rulesets` (merged with root settings) | No       |
| `prOptions` | Per-repo PR merge options (overrides global)                  | No       |

## Per-Repo File Override Fields

| Field            | Description                                                              | Required |
| ---------------- | ------------------------------------------------------------------------ | -------- |
| `content`        | Content overlay merged onto file's base content                          | No       |
| `override`       | If `true`, ignore base content and use only this repo's                  | No       |
| `createOnly`     | Override root-level `createOnly` for this repo                           | No       |
| `executable`     | Override root-level `executable` for this repo                           | No       |
| `header`         | Override root-level `header` for this repo                               | No       |
| `schemaUrl`      | Override root-level `schemaUrl` for this repo                            | No       |
| `template`       | Override root-level `template` for this repo                             | No       |
| `vars`           | Per-repo template variables (merged with root vars, overrides conflicts) | No       |
| `deleteOrphaned` | Override file-level or global `deleteOrphaned` for this repo             | No       |

## File Exclusion

Set a file to `false` to exclude it from a specific repo:

```yaml
repos:
  - git: git@github.com:org/repo.git
    files:
      eslint.json: false # This repo won't receive eslint.json
```

## Delete Orphaned Files

Files with `deleteOrphaned: true` are tracked in a `.xfg.json` manifest file in each target repository. When a tracked file is removed from your xfg config, it will be automatically deleted from the target repos on the next sync.

```yaml
id: my-org-standards
files:
  .prettierrc.json:
    content: { semi: false }
    deleteOrphaned: true # Track this file - removing it from config deletes it from repos

repos:
  - git: git@github.com:org/repo.git
```

### Inheritance

`deleteOrphaned` follows the standard inheritance pattern:

1. **Global default** - Set at root level applies to all files
2. **Per-file** - Overrides global default for specific files
3. **Per-repo** - Overrides both global and per-file for specific repos

```yaml
deleteOrphaned: true # Global: track all files by default

files:
  .prettierrc.json:
    content: { semi: false }
  .eslintrc.json:
    content: { extends: "standard" }
    deleteOrphaned: false # This file won't be tracked

repos:
  - git: git@github.com:org/special-repo.git
    files:
      .prettierrc.json:
        deleteOrphaned: false # Don't track for this repo only
```

### Disabling at Runtime

Use the `--no-delete` CLI flag to skip deletion even if configured:

```bash
xfg --config config.yaml --no-delete
```
