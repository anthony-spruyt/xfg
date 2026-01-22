# PR Options

Configure how PRs are handled after creation.

## PR Options Fields

| Field           | Description                                                                 | Default  |
| --------------- | --------------------------------------------------------------------------- | -------- |
| `merge`         | Merge mode: `manual` (leave open), `auto` (merge when checks pass), `force` | `auto`   |
| `mergeStrategy` | How to merge: `merge`, `squash`, `rebase`                                   | `squash` |
| `deleteBranch`  | Delete source branch after merge                                            | `true`   |
| `bypassReason`  | Reason for bypassing policies (Azure DevOps only, required for `force`)     | -        |

## Merge Modes

| Mode     | GitHub Behavior                                      | Azure DevOps Behavior                  | GitLab Behavior                            |
| -------- | ---------------------------------------------------- | -------------------------------------- | ------------------------------------------ |
| `manual` | Leave PR open for review                             | Leave PR open for review               | Leave MR open for review                   |
| `auto`   | Enable auto-merge (requires repo setup, **default**) | Enable auto-complete (**default**)     | Merge when pipeline succeeds (**default**) |
| `force`  | Merge with `--admin` (bypass checks)                 | Bypass policies with `--bypass-policy` | Merge immediately                          |

## Global vs Per-Repo Options

Set global defaults, then override per-repo as needed:

```yaml
files:
  .prettierrc.json:
    content:
      semi: false

prOptions:
  merge: auto
  mergeStrategy: squash
  deleteBranch: true

repos:
  # Uses global defaults
  - git: git@github.com:org/frontend.git

  # Override to manual
  - git: git@github.com:org/needs-review.git
    prOptions:
      merge: manual

  # Override to force merge
  - git: git@github.com:org/internal-tool.git
    prOptions:
      merge: force
```

## CLI Override

CLI flags take highest priority:

```bash
# Disable auto-merge, leave PRs open for review
xfg --config ./config.yaml --merge manual

# Force merge all PRs (useful for urgent updates)
xfg --config ./config.yaml --merge force
```

## GitHub Auto-Merge Note

The `auto` mode requires auto-merge to be enabled in the repository settings. If not enabled, the tool will warn and leave the PR open for manual review.

Enable it with:

```bash
gh repo edit org/repo --enable-auto-merge
```

## Priority Order

1. CLI flags (highest)
2. Per-repo `prOptions`
3. Global `prOptions`
4. Built-in defaults (lowest)
