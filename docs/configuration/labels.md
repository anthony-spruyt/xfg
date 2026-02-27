# GitHub Labels

xfg can manage GitHub labels declaratively using the `settings` command. Define labels in your config file, and xfg will create, update, rename, or delete them to match your desired state.

!!! note "GitHub-Only Feature"
    Labels are only available for GitHub repositories. Azure DevOps and GitLab repos will be skipped when running `xfg settings`.

## Quick Start

```yaml
id: my-config

settings:
  labels:
    bug:
      color: d73a4a
      description: "Something isn't working"
    enhancement:
      color: a2eeef
      description: "New feature or request"
    documentation:
      color: "0075ca"
      description: "Improvements or additions to documentation"

repos:
  - git: git@github.com:your-org/your-repo.git
```

```bash
# Preview changes (dry-run)
xfg settings -c config.yaml --dry-run

# Apply labels
xfg settings -c config.yaml
```

## Label Properties

| Property      | Required | Description                                                          |
| ------------- | -------- | -------------------------------------------------------------------- |
| `color`       | Yes      | Hex color code, with or without `#` (e.g., `d73a4a` or `#d73a4a`)    |
| `description` | No       | Label description (max 100 characters)                               |
| `new_name`    | No       | Rename the label to this value                                       |

## Color Format

Colors can be specified with or without the `#` prefix. Both are normalized to bare hex during processing:

```yaml
labels:
  bug:
    color: d73a4a        # Without #
  feature:
    color: "#0e8a16"     # With # (quote the value in YAML)
```

## Renaming Labels

Use `new_name` to rename an existing label:

```yaml
labels:
  old-label-name:
    color: d73a4a
    new_name: new-label-name
```

After renaming, update your config to use the new name for subsequent runs:

```yaml
labels:
  new-label-name:
    color: d73a4a
```

## Deleting Orphaned Labels

When `deleteOrphaned: true` is set, labels that were previously managed by xfg but are no longer in the config will be deleted:

```yaml
settings:
  deleteOrphaned: true
  labels:
    bug:
      color: d73a4a
```

!!! warning
    `deleteOrphaned` only deletes labels that xfg previously managed (tracked in the manifest). It will not delete labels that were created manually or by other tools.

## Inheritance

Labels support the same inheritance pattern as rulesets. Root-level labels are inherited by all repos:

```yaml
settings:
  labels:
    bug:
      color: d73a4a
      description: "Something isn't working"
    enhancement:
      color: a2eeef

repos:
  - git: git@github.com:your-org/repo-a.git
    # Inherits both labels

  - git: git@github.com:your-org/repo-b.git
    settings:
      labels:
        bug:
          color: ff0000          # Override color for this repo
        deploy:
          color: "0e8a16"       # Add a repo-specific label

  - git: git@github.com:your-org/repo-c.git
    settings:
      labels:
        inherit: false           # Skip all root labels
        custom-label:
          color: "000000"

  - git: git@github.com:your-org/repo-d.git
    settings:
      labels:
        enhancement: false       # Opt out of a single root label
```

## How It Works

The `settings` command:

1. Fetches current labels from the GitHub API
2. Compares them against the desired state in config (case-insensitive matching)
3. Shows a Terraform-style plan of changes
4. Applies changes in order: deletes, then updates/renames, then creates

Label name matching is **case-insensitive** (GitHub treats label names as case-insensitive).

## GitHub API Reference

Labels are managed via the [GitHub Labels API](https://docs.github.com/en/rest/issues/labels):

- `GET /repos/{owner}/{repo}/labels` - List labels
- `POST /repos/{owner}/{repo}/labels` - Create a label
- `PATCH /repos/{owner}/{repo}/labels/{name}` - Update a label
- `DELETE /repos/{owner}/{repo}/labels/{name}` - Delete a label
