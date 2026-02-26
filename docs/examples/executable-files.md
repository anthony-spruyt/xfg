# Executable Files

Shell scripts (`.sh` files) are automatically marked as executable using `git update-index --add --chmod=+x`.

## Auto-Executable Shell Scripts

`.sh` files are automatically executable:

```yaml
id: my-org-config
files:
  deploy.sh:
    content: |-
      #!/bin/bash
      echo "Deploying..."

repos:
  - git: git@github.com:org/repo.git
```

## Disable Auto-Executable

Disable for a specific `.sh` file:

```yaml
id: my-org-config
files:
  template.sh:
    executable: false
    content: "# This is just a template"

repos:
  - git: git@github.com:org/repo.git
```

## Make Non-.sh Files Executable

Mark any file as executable:

```yaml
id: my-org-config
files:
  run:
    executable: true
    content: |-
      #!/usr/bin/env python3
      print("Hello")

repos:
  - git: git@github.com:org/repo.git
```

## Per-Repo Override

Override executable settings per-repo:

```yaml
id: my-org-config
files:
  deploy.sh:
    content: |-
      #!/bin/bash
      echo "Deploying..."

repos:
  - git: git@github.com:org/repo.git
    files:
      deploy.sh:
        executable: false # Disable for this repo only
```

## Summary

| File Type   | Default Behavior         | Override            |
| ----------- | ------------------------ | ------------------- |
| `.sh` files | Automatically executable | `executable: false` |
| Other files | Not executable           | `executable: true`  |

## GitHub App Limitation

When using GitHub App authentication, xfg uses the `createCommitOnBranch` GraphQL API to create verified (signed) commits. This API does not support setting file modes.

**Impact:**

- New executable files are created as `100644` (non-executable) on the remote
- Updating an existing file preserves whatever mode it already has -- if a file is `100755`, it stays `100755`

**Workaround:**

After the first sync creates the file, manually set it to executable:

```bash
git update-index --chmod=+x path/to/script.sh
git commit -m "fix: set executable mode"
git push
```

All future xfg syncs will preserve the `100755` mode.

**PAT authentication** is not affected -- it uses `git commit` which correctly records file modes.
