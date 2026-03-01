# Docs Deploy Verified Commits Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch GitHub Pages deployment from `mkdocs gh-deploy` (branch-based) to Actions artifact deploy, bypassing verified commits enforcement.

**Architecture:** Replace single-job workflow with two-job pipeline: `build` (mkdocs build + upload artifact) and `deploy` (actions/deploy-pages). Switch repo Pages source to `workflow` type via API.

**Tech Stack:** GitHub Actions, MkDocs, actions/upload-pages-artifact@v4, actions/deploy-pages@v4, actions/configure-pages@v5

---

### Task 1: Rewrite docs.yaml workflow

**Files:**

- Modify: `.github/workflows/docs.yaml` (full rewrite)

**Step 1: Replace the workflow file with the new two-job pipeline**

```yaml
---
# yaml-language-server: $schema=https://raw.githubusercontent.com/SchemaStore/schemastore/master/src/schemas/json/github-workflow.json
name: Deploy Docs

on:
  push:
    branches:
      - "main"
    paths:
      - "docs/**"
      - "mkdocs.yml"
  workflow_dispatch:

permissions:
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: actions/setup-python@v6
        with:
          python-version: "3.x"

      - name: Install MkDocs Material
        run: pip install mkdocs-material

      - name: Build docs
        run: mkdocs build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

**Step 2: Validate the YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/docs.yaml'))"`
Expected: No output (valid YAML)

**Step 3: Commit**

```bash
git add .github/workflows/docs.yaml
git commit -m "fix(ci): switch docs deploy to Actions artifact for verified commits"
```

---

### Task 2: Switch repo Pages source to workflow type

**Step 1: Update Pages build type via API**

Run: `gh api repos/anthony-spruyt/xfg/pages -X PUT -f build_type=workflow`
Expected: JSON response with `"build_type": "workflow"`

---

### Task 3: Push and verify deployment

**Step 1: Push the branch and create PR**

```bash
git push -u origin fix/docs-deploy-verified-commits
```

**Step 2: Create PR**

Title: `fix(ci): switch docs deploy to Actions artifact for verified commits`
Body: Reference the design doc and the failing run.

**Step 3: After PR merges, verify the deploy workflow runs successfully**

Run: `gh run list --workflow=docs.yaml --branch=main -L 1`
Expected: A successful run with two jobs (build, deploy)

**Step 4: Verify the site is live**

Check: https://anthony-spruyt.github.io/xfg/ loads correctly

---

### Task 4: Cleanup (after successful deploy)

**Step 1: Delete the gh-pages branch**

Run: `git push origin --delete gh-pages`

---
