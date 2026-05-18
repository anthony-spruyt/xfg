# PR Options

Configure how PRs are handled after creation.

## PR Options Fields

| Field           | Description                                                                                                    | Default  |
| --------------- | -------------------------------------------------------------------------------------------------------------- | -------- |
| `merge`         | Merge mode: `manual` (leave open), `auto` (merge when checks pass), `force`, `direct`                          | `auto`   |
| `mergeStrategy` | How to merge: `merge`, `squash`, `rebase`                                                                      | `squash` |
| `deleteBranch`  | Delete source branch after merge                                                                               | `true`   |
| `bypassReason`  | Reason for bypassing policies (Azure DevOps only, required for `force`)                                        | -        |
| `labels`        | Labels to apply to created PRs (GitHub only, more platforms coming)                                            | -        |
| `branch`        | Branch name for sync PRs. Per-repo overrides group, group overrides global. CLI `--branch` flag overrides all. | -        |

## Merge Modes

| Mode     | GitHub Behavior                                      | Azure DevOps Behavior                   | GitLab Behavior                            |
| -------- | ---------------------------------------------------- | --------------------------------------- | ------------------------------------------ |
| `manual` | Leave PR open for review                             | Leave PR open for review                | Leave MR open for review                   |
| `auto`   | Enable auto-merge (requires repo setup, **default**) | Enable auto-complete (**default**)      | Merge when pipeline succeeds (**default**) |
| `force`  | Merge with `--admin` (bypass checks)                 | Bypass policies with `--bypass-policy`  | Merge immediately                          |
| `direct` | Push directly to default branch (no PR)              | Push directly to default branch (no PR) | Push directly to default branch (no MR)    |

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

## PR Labels

Apply labels to PRs automatically:

```yaml
prOptions:
  labels: ["config-sync", "automated"]

repos:
  # Uses global labels
  - git: git@github.com:org/frontend.git

  # Override with repo-specific labels (replaces global)
  - git: git@github.com:org/critical.git
    prOptions:
      labels: ["critical-config", "urgent"]

  # Clear labels for this repo
  - git: git@github.com:org/no-labels.git
    prOptions:
      labels: []
```

**Note:** Labels must already exist on the target repository. If a label doesn't exist, the PR creation will fail. Currently supported on GitHub only.

## PR Branch Name

Set a custom branch name for sync PRs:

```yaml
# Global branch name
prOptions:
  branch: chore/sync-config

repos:
  # Uses global branch name
  - git: git@github.com:org/frontend.git

  # Per-repo override
  - git: git@github.com:org/special.git
    prOptions:
      branch: chore/sync-repo-specific
```

When `branch` is not set, the branch name is auto-generated from the synced file names (e.g., `chore/sync-prettierrc`). The CLI `--branch` flag overrides all config values.

## CLI Override

CLI flags take highest priority:

```bash
# Disable auto-merge, leave PRs open for review
xfg sync --config ./config.yaml --merge manual

# Force merge all PRs (useful for urgent updates)
xfg sync --config ./config.yaml --merge force

# Push directly to default branch without creating PRs
xfg sync --config ./config.yaml --merge direct
```

## Direct Push Mode

The `direct` mode pushes changes directly to the default branch without creating a PR. This is useful for:

- Repos without branch protection
- Internal tools where PR review isn't required
- Quick config updates where you have direct push permissions

```yaml
prOptions:
  merge: direct

repos:
  - git: git@github.com:org/internal-tool.git
```

**Note:** If the target branch has branch protection enabled, the push will fail with a helpful error message suggesting to use `merge: force` instead.

## GitHub Auto-Merge Note

The `auto` mode requires auto-merge to be enabled in the repository settings. If not enabled, the tool will warn and leave the PR open for manual review.

Enable it with:

```bash
gh repo edit org/repo --enable-auto-merge
```

## Priority Order

1. CLI flags (highest)
1. Per-repo `prOptions`
1. Conditional group `prOptions` (applied in array order)
1. Group `prOptions` (applied in order, later groups override earlier ones)
1. Global `prOptions`
1. Built-in defaults (lowest)
