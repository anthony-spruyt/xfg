# Executable Files

Shell scripts (`.sh` files) are automatically marked as executable using `git update-index --add --chmod=+x`.

## Auto-Executable Shell Scripts

`.sh` files are automatically executable:

```yaml
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
