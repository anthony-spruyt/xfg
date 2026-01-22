# GitHub Actions

## Workflow Example

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
          node-version: "20"
      - run: npm install -g @aspruyt/xfg
      - run: xfg --config ./config.yaml
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
          node-version: "20"
      - run: npm install -g @aspruyt/xfg
      - run: xfg --config ./configs/${{ matrix.config }}
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
          node-version: "20"
      - run: npm install -g @aspruyt/xfg
      - run: xfg --config ./config.yaml --dry-run
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
```
