# GitHub

## URL Formats

| Format | Example                             |
| ------ | ----------------------------------- |
| SSH    | `git@github.com:owner/repo.git`     |
| HTTPS  | `https://github.com/owner/repo.git` |

## Authentication

### Personal Access Token (PAT)

The default authentication method:

```bash
gh auth login
```

Your token needs the `repo` scope to create PRs in target repositories.

### GitHub App (Recommended for Enterprise)

For organizations that prefer GitHub Apps over PATs, see [GitHub App Authentication](./github-app.md) for:

- Verified commits (signed by GitHub)
- Fine-grained permissions
- Better audit trails

## GitHub Enterprise Server

xfg supports GitHub Enterprise Server (GHE) instances in addition to github.com.

### GHE URL Formats

| Format | Example                                       |
| ------ | --------------------------------------------- |
| SSH    | `git@github.mycompany.com:owner/repo.git`     |
| HTTPS  | `https://github.mycompany.com/owner/repo.git` |

### Configuration

To use GHE repositories, add the hostname(s) to the `githubHosts` array in your config:

```yaml
githubHosts:
  - github.mycompany.com
  - ghe.internal.net

files:
  config.json:
    content:
      key: value

repos:
  - git: git@github.mycompany.com:owner/repo.git
  - git: https://ghe.internal.net/org/project.git
```

### GHE Authentication

Authenticate with each GHE instance using the `--hostname` flag:

```bash
gh auth login --hostname github.mycompany.com
```

### Mixed Environments

You can use github.com and GHE repositories in the same config file:

```yaml
githubHosts:
  - github.mycompany.com

files:
  shared-config.json:
    content:
      version: "1.0"

repos:
  # github.com (no config needed)
  - git: git@github.com:myorg/public-repo.git
  # GitHub Enterprise
  - git: git@github.mycompany.com:myorg/private-repo.git
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

## Direct Push Mode

With `merge: direct`, xfg skips PR creation entirely and pushes directly to the default branch:

```yaml
prOptions:
  merge: direct

repos:
  - git: git@github.com:org/internal-tool.git
```

This is useful for repos without branch protection or when PR review isn't required. If the branch is protected, the push will fail with a helpful error suggesting to use `merge: force` instead.

**When to use `direct` vs `force`:**

- `direct`: Repo has no branch protection, or you want to skip PR workflow entirely
- `force`: Repo has branch protection, but you have admin privileges to bypass it (creates a PR and merges with `--admin`)

## GitHub Rulesets

The `xfg settings` command manages GitHub Rulesets declaratively. See [GitHub Rulesets](../configuration/rulesets.md) for full documentation.

```yaml
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include: [refs/heads/main]
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1
```

```bash
xfg settings --config ./config.yaml
```

### Required Permissions for Rulesets

Managing rulesets requires admin access to the repository. Your token needs:

- **PAT:** `admin:repo` scope
- **GitHub App:** "Administration" permission set to "Read and write"

### Rulesets vs Branch Protection

GitHub Rulesets are the modern replacement for branch protection rules. They offer:

- Pattern-based conditions (apply to multiple branches)
- Multiple rules per ruleset
- Bypass actors with fine-grained control
- Evaluate mode for testing
- Advanced rules (code scanning, workflows, file restrictions)

xfg uses the Rulesets API exclusively. If you need legacy branch protection rules, you'll need to manage those separately.
