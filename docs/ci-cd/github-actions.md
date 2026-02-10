# GitHub Actions

## Using the GitHub Action

The simplest way to use xfg in GitHub Actions is with the official action:

```yaml
- uses: actions/checkout@v4

- uses: anthony-spruyt/xfg@v3
  with:
    config: ./sync-config.yml
    github-token: ${{ secrets.GH_PAT }} # PAT with repo scope for cross-repo access
```

### Action Inputs

| Input                    | Required | Default               | Description                                                |
| ------------------------ | -------- | --------------------- | ---------------------------------------------------------- |
| `command`                | No       | `sync`                | Command to run (`sync` or `settings`)                      |
| `config`                 | Yes      | -                     | Path to YAML config file                                   |
| `dry-run`                | No       | `false`               | Preview mode - show what would change without creating PRs |
| `work-dir`               | No       | `./tmp`               | Directory for cloning repositories                         |
| `retries`                | No       | `3`                   | Number of network retries                                  |
| `branch`                 | No       | -                     | Override sync branch name                                  |
| `merge`                  | No       | -                     | PR merge mode (`manual`/`auto`/`force`/`direct`)           |
| `merge-strategy`         | No       | -                     | Merge strategy (`merge`/`squash`/`rebase`)                 |
| `delete-branch`          | No       | `false`               | Delete branch after merge                                  |
| `github-token`           | No       | `${{ github.token }}` | GitHub token for authentication                            |
| `github-app-id`          | No       | -                     | GitHub App ID for installation token generation            |
| `github-app-private-key` | No       | -                     | GitHub App private key (PEM) for JWT signing               |
| `azure-devops-token`     | No       | -                     | Azure DevOps Personal Access Token                         |
| `gitlab-token`           | No       | -                     | GitLab token for authentication                            |

### Multi-Platform Example

Sync configs across GitHub, Azure DevOps, and GitLab repositories:

```yaml
- uses: anthony-spruyt/xfg@v3
  with:
    config: ./sync-config.yml
    github-token: ${{ secrets.GH_PAT }}
    azure-devops-token: ${{ secrets.AZURE_DEVOPS_PAT }}
    gitlab-token: ${{ secrets.GITLAB_TOKEN }}
    merge: auto
    merge-strategy: squash
    delete-branch: true
```

### Auto-Merge Example

Automatically merge PRs when CI passes:

```yaml
- uses: anthony-spruyt/xfg@v3
  with:
    config: ./sync-config.yml
    github-token: ${{ secrets.GH_PAT }}
    merge: auto
```

### Direct Push Example

Push directly to the default branch without creating PRs:

```yaml
- uses: anthony-spruyt/xfg@v3
  with:
    config: ./sync-config.yml
    github-token: ${{ secrets.GH_PAT }}
    merge: direct
```

### Settings Command Example

Apply branch protection rulesets to repositories:

```yaml
- uses: anthony-spruyt/xfg@v3
  with:
    command: settings
    config: ./settings-config.yml
    github-token: ${{ secrets.GH_PAT }}
```

See [Rulesets](../configuration/rulesets.md) for configuration details.

### GitHub App Authentication (Verified Commits)

For verified commits, use a GitHub App:

```yaml
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: anthony-spruyt/xfg@v3
        with:
          config: ./sync-config.yml
          github-app-id: ${{ vars.APP_ID }}
          github-app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
```

This approach automatically:

- Discovers all installations of your GitHub App
- Generates short-lived installation tokens per-installation
- Caches tokens to minimize API calls
- Skips repositories without app access

See [GitHub App Authentication](../platforms/github-app.md) for full setup instructions.

### Token Requirements by Platform

**GitHub:**

- Requires a Personal Access Token (PAT) with `repo` scope
- The default `${{ github.token }}` only has access to the current repository
- For cross-repo syncing, create a PAT and store it as a secret

**Azure DevOps:**

- Requires a Personal Access Token with `Code (Read & Write)` and `Pull Request Threads (Read & Write)` permissions
- Must also have access to the target project

**GitLab:**

- Requires a Personal Access Token with `api` scope
- Or a Project Access Token with `api` scope for single-project access

---

## Workflow Example

If you prefer manual setup over the action, you can install and run xfg directly:

```yaml
name: Sync Configs
on:
  push:
    branches: [main]
    paths: ["config.yaml"]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: npm install -g @aspruyt/xfg
      - run: xfg sync --config ./config.yaml
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
```

## Token Requirements

!!! warning "Personal Access Token Required"
`GH_PAT` must be a Personal Access Token with `repo` scope to create PRs in target repositories. The default `GITHUB_TOKEN` only has access to the current repository.

## Creating a PAT

1. Go to **Settings** > **Developer settings** > **Personal access tokens** > **Tokens (classic)**
2. Click **Generate new token (classic)**
3. Select the `repo` scope
4. Copy the token and add it as a repository secret named `GH_PAT`

## Multiple Config Files

```yaml
name: Sync All Configs
on:
  push:
    branches: [main]
    paths:
      - "configs/*.yaml"

jobs:
  sync:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        config:
          - eslint-config.yaml
          - prettier-config.yaml
          - tsconfig-config.yaml
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: npm install -g @aspruyt/xfg
      - run: xfg sync --config ./configs/${{ matrix.config }}
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
```

## Dry Run on PR

Preview changes without creating PRs:

```yaml
name: Preview Config Changes
on:
  pull_request:
    paths: ["config.yaml"]

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: npm install -g @aspruyt/xfg
      - run: xfg sync --config ./config.yaml --dry-run
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
```
