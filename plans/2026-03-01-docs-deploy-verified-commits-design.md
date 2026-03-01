# Design: Switch GitHub Pages to Actions Artifact Deploy

## Problem

`mkdocs gh-deploy --force` creates unsigned commits on the `gh-pages` branch and force-pushes them. With verified commits enforcement enabled repo-wide, the push is rejected:

```
remote: error: GH013: Repository rule violations found for refs/heads/gh-pages.
remote: - Commits must have verified signatures.
```

Observed in: https://github.com/anthony-spruyt/xfg/actions/runs/22536556964/job/65285091944

## Solution

Replace `mkdocs gh-deploy` with the standard GitHub Actions Pages deployment pipeline. This sidesteps the signing requirement entirely — no commits are made to any branch.

## Workflow Design

Split into two jobs:

### Job 1: `build`

1. Checkout repo
2. Setup Python, install mkdocs-material
3. Run `mkdocs build` (outputs to `site/`)
4. Upload `site/` with `actions/upload-pages-artifact`

### Job 2: `deploy`

1. Depends on `build`
2. Uses `actions/deploy-pages` to deploy the uploaded artifact
3. Runs in `environment: github-pages` (required by GitHub)

### Permissions

- Remove `contents: write` (no longer pushing to a branch)
- Add `pages: write` and `id-token: write` (required for OIDC-based Pages deployment)

### Concurrency

Add a concurrency group to prevent overlapping deploys:

```yaml
concurrency:
  group: pages
  cancel-in-progress: false
```

## Repo Settings Change

Switch Pages source from "Deploy from a branch" (`legacy`) to "GitHub Actions" (`workflow`):

```bash
gh api repos/anthony-spruyt/xfg/pages -X PUT -f build_type=workflow
```

## Cleanup

After confirming the new workflow works, delete the `gh-pages` branch.

## Out of Scope

MkDocs 2.0 / Material for MkDocs incompatibility warning — tracked in #568.
