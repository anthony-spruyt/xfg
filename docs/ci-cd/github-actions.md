# GitHub Actions

## Using the GitHub Action

The simplest way to use xfg in GitHub Actions is with the official action:

```yaml
- uses: actions/checkout@v7

- uses: anthony-spruyt/xfg@v8 # x-release-please-major
  with:
    config: ./sync-config.yml
    github-token: ${{ secrets.GH_PAT }} # PAT with repo scope for cross-repo access
```

### Action Inputs

<!-- xfg:generated action:inputs -->

| Input                    | Required | Default               | Description                                                                                                                                                |
| ------------------------ | -------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`                | No       | `sync`                | xfg command to run (sync/secrets-sync). secrets-sync ignores branch, merge, merge-strategy, and delete-branch                                              |
| `config`                 | Yes      | -                     | Path to YAML config file                                                                                                                                   |
| `dry-run`                | No       | `false`               | Preview mode - show what would change without creating PRs                                                                                                 |
| `work-dir`               | No       | `./tmp`               | Directory for cloning repositories                                                                                                                         |
| `retries`                | No       | `3`                   | Number of network retries                                                                                                                                  |
| `branch`                 | No       | -                     | Override sync branch name                                                                                                                                  |
| `merge`                  | No       | -                     | PR merge mode (manual/auto/force/direct)                                                                                                                   |
| `merge-strategy`         | No       | -                     | Merge strategy (merge/squash/rebase)                                                                                                                       |
| `delete-branch`          | No       | `false`               | Delete branch after merge                                                                                                                                  |
| `github-token`           | No       | `${{ github.token }}` | GitHub token for authentication                                                                                                                            |
| `azure-devops-token`     | No       | -                     | Azure DevOps Personal Access Token                                                                                                                         |
| `gitlab-token`           | No       | -                     | GitLab token for authentication                                                                                                                            |
| `github-client-id`       | No       | -                     | GitHub App Client ID (generates installation tokens automatically)                                                                                         |
| `github-app-private-key` | No       | -                     | GitHub App private key (PEM format) for JWT signing                                                                                                        |
| `allowed-github-hosts`   | No       | -                     | Comma-separated GitHub Enterprise Server hostnames trusted with GitHub credentials. Repos on unlisted GitHub hosts other than github.com fail              |
| `no-delete`              | No       | `false`               | Skip deletion of orphaned resources even if deleteOrphaned is configured                                                                                   |
| `no-ai`                  | No       | `false`               | Disable AI-generated commit messages and PR descriptions even if prOptions.ai is configured (sync only)                                                    |
| `render-dir`             | No       | -                     | With dry-run, write each repo's planned file changes to this directory (sync only). See the --render-dir CLI option                                        |
| `xfg-package`            | No       | -                     | Override xfg package to install (npm package name, local .tgz path, or 'skip' to use pre-installed). Defaults to the version matching this action release. |

<!-- xfg:generated:end -->

Each input is passed to xfg as exactly one argument. Put extra flags in their own inputs, not inside another input's value.

### Multi-Platform Example

Sync configs across GitHub, Azure DevOps, and GitLab repositories:

```yaml
- uses: anthony-spruyt/xfg@v8 # x-release-please-major
  with:
    config: ./sync-config.yml
    github-token: ${{ secrets.GH_PAT }}
    azure-devops-token: ${{ secrets.AZURE_DEVOPS_PAT }}
    gitlab-token: ${{ secrets.GITLAB_TOKEN }}
    merge: auto
    merge-strategy: squash
    delete-branch: true
```

xfg passes tokens to `git` only for GitHub repositories. The action configures a git credential helper for `https://dev.azure.com` (from `azure-devops-token`) and for `https://gitlab.com` (from `gitlab-token`); it configures no other host. A repository on a self-hosted GitLab host, or one addressed by an SSH URL, gets no credential from the action; `git` uses the credentials already on the runner.
The action also exports `azure-devops-token` as `AZURE_DEVOPS_EXT_PAT` and `gitlab-token` as `GITLAB_TOKEN` for the `az` and `glab` CLIs.

### Auto-Merge Example

Automatically merge PRs when CI passes:

```yaml
- uses: anthony-spruyt/xfg@v8 # x-release-please-major
  with:
    config: ./sync-config.yml
    github-token: ${{ secrets.GH_PAT }}
    merge: auto
```

### Direct Push Example

Push directly to the default branch without creating PRs:

```yaml
- uses: anthony-spruyt/xfg@v8 # x-release-please-major
  with:
    config: ./sync-config.yml
    github-token: ${{ secrets.GH_PAT }}
    merge: direct
```

### Settings-Only Example

Apply branch protection rulesets and labels to repositories (no files section needed):

```yaml
- uses: anthony-spruyt/xfg@v8 # x-release-please-major
  with:
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
      - uses: actions/checkout@v7

      - uses: anthony-spruyt/xfg@v8 # x-release-please-major
        with:
          config: ./sync-config.yml
          github-client-id: ${{ vars.CLIENT_ID }}
          github-app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
```

This approach automatically:

- Discovers all installations of your GitHub App
- Generates short-lived installation tokens per-installation
- Caches tokens to minimize API calls
- Skips repositories whose owner has no installation of the app

See [GitHub App Authentication](../platforms/github-app.md) for full setup instructions.

### Token Requirements by Platform

**GitHub:**

- Requires a Personal Access Token (PAT) with `repo` scope, plus `workflow` scope to push changes to `.github/workflows/` files
- The default `${{ github.token }}` only has access to the current repository
- For cross-repo syncing, create a PAT and store it as a secret

**Azure DevOps:**

- Requires a Personal Access Token with `Code (Read & Write)` and `Pull Request Threads (Read & Write)` permissions
- Must also have access to the target project

**GitLab:**

- Requires a Personal Access Token with `api` scope
- Or a Project Access Token with `api` scope for single-project access

______________________________________________________________________

## Workflow Example

If you prefer manual setup over the action, you can install and run xfg directly. With a PAT, xfg commits with `git commit` and sets no author identity, so the workflow configures one (the action does this for you unless git already has one):

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
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "24"
      - run: npm install -g @aspruyt/xfg
      - run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
      - run: xfg sync --config ./config.yaml
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
```

## Creating a PAT

1. Go to **Settings** > **Developer settings** > **Personal access tokens** > **Tokens (classic)**
2. Click **Generate new token (classic)**
3. Select the `repo` scope, plus the `workflow` scope if you sync files under `.github/workflows/`
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
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "24"
      - run: npm install -g @aspruyt/xfg
      - run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
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
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "24"
      - run: npm install -g @aspruyt/xfg
      - run: xfg sync --config ./config.yaml --dry-run
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
```
