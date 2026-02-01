# GitHub Action: Protect Command Support

**Date:** 2026-02-01
**Status:** Approved

## Overview

Update the GitHub Action to support the new `xfg protect` command for managing GitHub Rulesets declaratively.

## Design

### Approach

Add a `command` input to the existing action with two values: `sync` (default) or `protect`. Users who need both call the action twice - no `both` option to keep it simple.

### Changes to action.yml

**Metadata update:**

```yaml
name: "xfg - Repo as Code"
description: "Sync files and manage repositories as code"
```

**New input:**

```yaml
command:
  description: "Command to run (sync or protect)"
  required: false
  default: "sync"
```

**Modified "Run xfg" step:**

- Build command as `xfg ${command}` instead of just `xfg`
- Protect command doesn't use: `branch`, `merge`, `merge-strategy`, `delete-branch`
- Both commands use: `config`, `dry-run`, `work-dir`, `retries`

### Backwards Compatibility

- Default `command: sync` means existing workflows continue working unchanged
- All existing inputs remain valid for sync command

## Usage Examples

### Sync only (default, backwards compatible)

```yaml
- uses: anthony-spruyt/xfg@v3
  with:
    config: ./config.yaml
```

### Protect only

```yaml
- uses: anthony-spruyt/xfg@v3
  with:
    command: protect
    config: ./config.yaml
```

### Both sync and protect

```yaml
- uses: anthony-spruyt/xfg@v3
  with:
    command: sync
    config: ./config.yaml

- uses: anthony-spruyt/xfg@v3
  with:
    command: protect
    config: ./config.yaml
```

## Implementation Tasks

1. Update action.yml metadata (name, description)
2. Add `command` input with default `sync`
3. Modify "Run xfg" step to use `xfg ${command}`
4. Update integration tests for protect via action
5. Update action documentation
