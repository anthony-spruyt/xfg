# Multi-File Configuration

For large configurations, you can split your config across multiple files in a directory. Pass the directory path to `-c` instead of a file:

```bash
xfg sync -c ./xfg-config
xfg sync -c ./xfg-config/   # trailing slash is optional
```

## Directory Structure

All `.yaml` and `.yml` files in the directory are loaded and merged. Files are processed in alphabetical order.

```text
xfg-config/
  base.yaml          # id, files, settings, prOptions (shared config)
  team-alpha.yaml     # team-specific groups and repos
  team-beta.yaml      # team-specific groups and repos
```

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
- Only flat directory scanning (no subdirectories)
- [`@path` file references](file-references.md) resolve relative to the fragment file that contains them

## Error Messages

Common errors when using directory-based config:

| Error                                                     | Cause                                       |
| --------------------------------------------------------- | ------------------------------------------- |
| `'id' is defined in both base.yaml and team.yaml`         | A single-file key appears in multiple files |
| `group 'X' is defined in both base.yaml and team.yaml`    | Duplicate group name across files           |
| `no 'id' found in any file in directory ./xfg-config/`    | No file defines `id`                        |
| `no .yaml or .yml files found in directory ./xfg-config/` | Directory is empty or has no YAML files     |
