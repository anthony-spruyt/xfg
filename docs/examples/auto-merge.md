# Auto-Merge PRs

By default, xfg enables auto-merge on PRs when checks pass. You can override this behavior per-repo or via CLI flags.

## Example

```yaml
id: my-org-config
files:
  .prettierrc.json:
    content:
      semi: false
      singleQuote: true

# Default behavior (auto-merge with squash, delete branch) - no prOptions needed
repos:
  # These repos use defaults (auto-merge with squash, delete branch)
  - git:
      - git@github.com:org/frontend.git
      - git@github.com:org/backend.git

  # This repo overrides to manual (leave PR open for review)
  - git: git@github.com:org/needs-review.git
    prOptions:
      merge: manual

  # This repo overrides to force merge (bypass required reviews)
  - git: git@github.com:org/internal-tool.git
    prOptions:
      merge: force
      bypassReason: "Automated config sync" # Azure DevOps only
```

## Merge Modes

| Mode     | GitHub Behavior                         | Azure DevOps Behavior    | GitLab Behavior              |
| -------- | --------------------------------------- | ------------------------ | ---------------------------- |
| `manual` | Leave PR open for review                | Leave PR open for review | Leave MR open for review     |
| `auto`   | Enable auto-merge (default)             | Enable auto-complete     | Merge when pipeline succeeds |
| `force`  | Merge with `--admin` (bypass checks)    | Bypass policies          | Merge immediately            |
| `direct` | Push directly to default branch (no PR) | Push directly (no PR)    | Push directly (no MR)        |

## GitHub Auto-Merge Note

The `auto` mode requires auto-merge to be enabled in the repository settings. If not enabled, the tool will warn and leave the PR open for manual review.

Enable it with:

```bash
gh repo edit org/repo --enable-auto-merge
```

## CLI Override

CLI flags override config file settings:

```bash
# Disable auto-merge, leave PRs open for review
xfg sync --config ./config.yaml --merge manual

# Force merge all PRs (useful for urgent updates)
xfg sync --config ./config.yaml --merge force

# Push directly to default branch (no PR created)
xfg sync --config ./config.yaml --merge direct
```

## Direct Push Mode

The `direct` mode pushes changes directly to the default branch without creating a PR/MR:

```yaml
id: my-org-config
files:
  .prettierrc.json:
    content:
      semi: false

prOptions:
  merge: direct

repos:
  - git: git@github.com:org/internal-tool.git
```

Use `direct` mode when:

- The repo has no branch protection
- You have bypass permissions configured
- PR review isn't required for the target repo

**Note:** If branch protection rejects the push, you'll get a helpful error suggesting to use `merge: force` instead.

## PR Options Reference

| Field           | Description                                                             | Default  |
| --------------- | ----------------------------------------------------------------------- | -------- |
| `merge`         | Merge mode: `manual`, `auto`, `force`, `direct`                         | `auto`   |
| `mergeStrategy` | How to merge: `merge`, `squash`, `rebase`                               | `squash` |
| `deleteBranch`  | Delete source branch after merge                                        | `true`   |
| `bypassReason`  | Reason for bypassing policies (Azure DevOps only, required for `force`) | -        |
