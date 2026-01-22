# Configuration Overview

xfg uses a YAML configuration file to define which files to sync and to which repositories.

## Basic Structure

```yaml
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

| Field        | Description                                                   | Required |
| ------------ | ------------------------------------------------------------- | -------- |
| `files`      | Map of target filenames to configs                            | Yes      |
| `repos`      | Array of repository configurations                            | Yes      |
| `prOptions`  | Global PR merge options (can be overridden per-repo)          | No       |
| `prTemplate` | Custom PR body template (inline or `@path/to/file` reference) | No       |

## Per-File Fields

| Field           | Description                                                                                                                                         | Required |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `content`       | Base config: object for JSON/YAML files, string or string[] for text files, or `@path/to/file` to load from external template (omit for empty file) | No       |
| `mergeStrategy` | Merge strategy: `replace`, `append`, `prepend` (for arrays and text lines)                                                                          | No       |
| `createOnly`    | If `true`, only create file if it doesn't exist                                                                                                     | No       |
| `executable`    | Mark file as executable. `.sh` files are auto-executable unless set to `false`. Set to `true` for non-.sh files.                                    | No       |
| `header`        | Comment line(s) at top of YAML files (string or array)                                                                                              | No       |
| `schemaUrl`     | Adds `# yaml-language-server: $schema=<url>` to YAML files                                                                                          | No       |

## Per-Repo Fields

| Field       | Description                                  | Required |
| ----------- | -------------------------------------------- | -------- |
| `git`       | Git URL (string) or array of URLs            | Yes      |
| `files`     | Per-repo file overrides (optional)           | No       |
| `prOptions` | Per-repo PR merge options (overrides global) | No       |

## Per-Repo File Override Fields

| Field        | Description                                             | Required |
| ------------ | ------------------------------------------------------- | -------- |
| `content`    | Content overlay merged onto file's base content         | No       |
| `override`   | If `true`, ignore base content and use only this repo's | No       |
| `createOnly` | Override root-level `createOnly` for this repo          | No       |
| `executable` | Override root-level `executable` for this repo          | No       |
| `header`     | Override root-level `header` for this repo              | No       |
| `schemaUrl`  | Override root-level `schemaUrl` for this repo           | No       |

## File Exclusion

Set a file to `false` to exclude it from a specific repo:

```yaml
repos:
  - git: git@github.com:org/repo.git
    files:
      eslint.json: false # This repo won't receive eslint.json
```
