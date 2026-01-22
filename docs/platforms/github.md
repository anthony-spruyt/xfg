# GitHub

## URL Formats

| Format | Example                             |
| ------ | ----------------------------------- |
| SSH    | `git@github.com:owner/repo.git`     |
| HTTPS  | `https://github.com/owner/repo.git` |

## Authentication

```bash
gh auth login
```

## Required Permissions

Your token needs the `repo` scope to create PRs in target repositories.

## Auto-Merge

GitHub's auto-merge feature requires it to be enabled in the repository settings.

Check if enabled:

```bash
gh api repos/owner/repo --jq '.allow_auto_merge'
```

Enable it:

```bash
gh repo edit owner/repo --enable-auto-merge
```

If auto-merge is not enabled, xfg will warn and leave the PR open for manual review.

## PR Creation

xfg uses the `gh` CLI to:

1. Create the PR with `gh pr create`
2. Enable auto-merge with `gh pr merge --auto` (if configured)
3. Force merge with `gh pr merge --admin` (if `merge: force`)
