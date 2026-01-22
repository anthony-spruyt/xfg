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

### Authentication

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
