# Multi-File Configuration

For large configurations, you can split your config across multiple files in a directory. Pass the directory path to `-c` instead of a file:

```bash
xfg sync -c ./xfg-config
xfg sync -c ./xfg-config/   # trailing slash is optional
```

## Directory Structure

All `.yaml` and `.yml` files in the directory are loaded and merged. Subdirectories are scanned recursively (depth-first, alphabetical per level). Files are processed in alphabetical order within each directory level before descending into subdirectories.

**Flat layout:**

```text
xfg-config/
  base.yaml          # id, files, settings, prOptions (shared config)
  team-alpha.yaml     # team-specific groups and repos
  team-beta.yaml      # team-specific groups and repos
```

**Nested layout:**

```text
xfg-config/
  base.yaml                 # id, prOptions (shared config)
  platform/
    github.yaml             # GitHub-specific settings
    gitlab.yaml             # GitLab-specific settings
  teams/
    alpha/
      repos.yaml            # alpha team repos
    beta/
      repos.yaml            # beta team repos
```

Processing order: `base.yaml` → `platform/github.yaml` → `platform/gitlab.yaml` → `teams/alpha/repos.yaml` → `teams/beta/repos.yaml`

## Merge Rules

| Key                 | Behavior                                                 |
| ------------------- | -------------------------------------------------------- |
| `groups`            | Merged by name — group names must be unique across files |
| `conditionalGroups` | Concatenated in alphabetical file order                  |
| `repos`             | Concatenated in alphabetical file order                  |
| All other keys      | Must appear in exactly one file                          |

### Single-file keys

These keys can each only appear in **one** file across the directory:

`id`, `files`, `settings`, `prOptions`, `prTemplate`, `githubHosts`, `deleteOrphaned`

If any of these appears in more than one file, xfg exits with an error naming both files.

## Example

```yaml
# base.yaml
id: my-org-config
files:
  .editorconfig:
    content: |
      root = true

groups:
  shared-ci:
    files:
      .github/workflows/ci.yml:
        content: { ... }

prOptions:
  merge: auto
  mergeStrategy: squash
```

```yaml
# team-alpha.yaml
groups:
  alpha-standard:
    extends: shared-ci
    files:
      .github/CODEOWNERS:
        content: "* @org/alpha"

repos:
  - git: git@github.com:org/alpha-api.git
    groups: [alpha-standard]
```

## Constraints

- Exactly one file must define `id`
- At least one file must define `repos`
- Group names must be unique across files — use [`extends`](groups.md#group-inheritance) for group composition
- Subdirectories are scanned recursively (depth-first, alphabetical per level)
- Hidden files and directories (names starting with `.`) are skipped
- Symlinked YAML files are followed; symlinked directories are skipped (cycle safety)
- Maximum nesting depth of 10 levels
- [`@path` file references](file-references.md) resolve relative to the fragment file's own directory, not the root config directory

## Error Messages

Common errors when using directory-based config:

| Error                                                            | Cause                                       |
| ---------------------------------------------------------------- | ------------------------------------------- |
| `'id' is defined in both base.yaml and team.yaml`                | A single-file key appears in multiple files |
| `group 'X' is defined in both base.yaml and team.yaml`           | Duplicate group name across files           |
| `no 'id' found in any file in directory ./xfg-config/`           | No file defines `id`                        |
| `no .yaml or .yml files found in directory ./xfg-config/`        | Directory is empty or has no YAML files     |
| `Config directory nesting exceeds maximum depth of 10 at <path>` | Too many nested subdirectories              |
| `Failed to read config directory <path>: <error>`                | Subdirectory is unreadable                  |
