# Harden Release Workflow - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the monolithic release workflow into two phases for resilience, idempotency, and self-deadlock elimination.

**Architecture:** Phase 1 (`release.yaml`, manual dispatch) creates the verified version-bump commit. Phase 2 (`release-publish.yaml`, auto on push to main) detects release commits, waits for CI, then tags/publishes with idempotency at each step.

**Tech Stack:** GitHub Actions YAML, GitHub CLI, npm

---

### Task 1: Strip `release.yaml` down to Phase 1

**Files:**

- Modify: `.github/workflows/release.yaml`

**Step 1: Replace release.yaml with Phase 1 only**

Replace the entire contents of `.github/workflows/release.yaml` with:

```yaml
---
# yaml-language-server: $schema=https://raw.githubusercontent.com/SchemaStore/schemastore/master/src/schemas/json/github-workflow.json
name: Release

on:
  workflow_dispatch:
    inputs:
      version:
        description: "Version bump type"
        required: true
        type: choice
        options:
          - patch
          - minor
          - major

permissions:
  contents: read

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Generate app token
        id: app-token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ vars.RELEASE_APP_ID }}
          private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}

      - name: Idempotency guard
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
        run: |
          COMMIT_MSG=$(gh api "repos/$REPO/commits/main" --jq '.commit.message')
          if [[ "$COMMIT_MSG" == chore:\ release\ v* ]]; then
            echo "::error::HEAD on main is already a release commit: $COMMIT_MSG"
            echo "::error::If release-publish failed, re-run it from the Actions tab."
            echo "::error::If you need a new release, push a commit to main first."
            exit 1
          fi
          echo "HEAD is not a release commit, proceeding"

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: "24"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Bump version locally
        id: version
        run: |
          npm version ${{ inputs.version }} --no-git-tag-version
          VERSION=$(node -p "require('./package.json').version")
          echo "version=$VERSION" >> $GITHUB_OUTPUT

      - name: Build
        run: npm run build

      - name: Create verified commit
        uses: iarekylew00t/verified-bot-commit@v2
        with:
          token: ${{ steps.app-token.outputs.token }}
          message: "chore: release v${{ steps.version.outputs.version }}"
          files: |
            package.json
            package-lock.json
```

**Removed from original:**

- `id-token: write` permission (no longer publishing here)
- `environment: npm` (no longer publishing here)
- "Verify CI passed on main" pre-flight step (Phase 2 handles CI gating)
- "Wait for CI to pass" polling loop
- "Create lightweight tag" step
- "Update floating major version tag" step
- "Publish to npm" step
- "Create GitHub Release" step

**Added:**

- Idempotency guard: checks if HEAD on main is already a release commit to prevent double-bumping

**Step 2: Verify YAML is valid**

Run: `npx yaml-lint .github/workflows/release.yaml`
Expected: No errors

**Step 3: Commit**

```bash
git add .github/workflows/release.yaml
git commit -m "ci(release): strip release.yaml to Phase 1 (version bump + verified commit only)"
```

---

### Task 2: Create `release-publish.yaml` for Phase 2

**Files:**

- Create: `.github/workflows/release-publish.yaml`

**Step 1: Create the Phase 2 workflow**

Create `.github/workflows/release-publish.yaml` with:

```yaml
---
# yaml-language-server: $schema=https://raw.githubusercontent.com/SchemaStore/schemastore/master/src/schemas/json/github-workflow.json
name: Release Publish

on:
  push:
    branches:
      - main

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    # Only run for release commits created by Phase 1
    if: startsWith(github.event.head_commit.message, 'chore: release v')
    runs-on: ubuntu-latest
    environment: npm
    steps:
      - uses: actions/checkout@v6

      - name: Extract version from commit message
        id: version
        run: |
          COMMIT_MSG="${{ github.event.head_commit.message }}"
          VERSION="${COMMIT_MSG#chore: release v}"
          if [ -z "$VERSION" ]; then
            echo "::error::Could not extract version from: $COMMIT_MSG"
            exit 1
          fi
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          echo "Detected release version: $VERSION"

      - name: Generate app token
        id: app-token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ vars.RELEASE_APP_ID }}
          private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}

      - name: Wait for CI to pass
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
          REPO: ${{ github.repository }}
          COMMIT_SHA: ${{ github.sha }}
        run: |
          echo "Waiting for CI on commit $COMMIT_SHA..."

          TIMEOUT=600
          ELAPSED=0
          while [ $ELAPSED -lt $TIMEOUT ]; do
            # Exclude this workflow's own check run ("publish")
            CHECK_RUNS=$(gh api "repos/$REPO/commits/$COMMIT_SHA/check-runs" \
              --jq '[.check_runs[] | select(.name != "publish")]')

            TOTAL=$(echo "$CHECK_RUNS" | jq 'length')
            COMPLETED=$(echo "$CHECK_RUNS" | jq '[.[] | select(.status == "completed")] | length')
            SUCCESSFUL=$(echo "$CHECK_RUNS" | jq '[.[] | select(.status == "completed" and (.conclusion == "success" or .conclusion == "skipped" or .conclusion == "neutral"))] | length')
            FAILED=$(echo "$CHECK_RUNS" | jq '[.[] | select(.status == "completed" and (.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out"))] | length')

            echo "Check runs: $COMPLETED/$TOTAL completed, $SUCCESSFUL successful, $FAILED failed (${ELAPSED}s)"

            if [ "$FAILED" -gt 0 ]; then
              echo "::error::CI failed on release commit"
              echo "$CHECK_RUNS" | jq -r '.[] | select(.status == "completed" and (.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")) | "  - \(.name): \(.conclusion)"'
              exit 1
            fi

            if [ "$TOTAL" -gt 0 ] && [ "$COMPLETED" -eq "$TOTAL" ]; then
              echo "All $TOTAL check runs passed"
              break
            fi

            if [ $ELAPSED -gt 0 ]; then
              echo "Pending:"
              echo "$CHECK_RUNS" | jq -r '.[] | select(.status != "completed") | "  - \(.name): \(.status)"'
            fi

            sleep 15
            ELAPSED=$((ELAPSED + 15))
          done

          if [ $ELAPSED -ge $TIMEOUT ]; then
            echo "::error::Timeout waiting for CI after ${TIMEOUT}s"
            exit 1
          fi

      - name: Create lightweight tag
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
          VERSION: ${{ steps.version.outputs.version }}
          REPO: ${{ github.repository }}
        run: |
          # Idempotency: skip if tag already exists
          if gh api "repos/$REPO/git/ref/tags/v${VERSION}" &>/dev/null; then
            echo "Tag v${VERSION} already exists, skipping"
          else
            gh api "repos/$REPO/git/refs" \
              -f ref="refs/tags/v${VERSION}" \
              -f sha="${{ github.sha }}"
            echo "Created tag v${VERSION}"
          fi

      - name: Update floating major version tag
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
          VERSION: ${{ steps.version.outputs.version }}
          REPO: ${{ github.repository }}
        run: |
          MAJOR=$(echo "${VERSION}" | cut -d. -f1)
          CURRENT_SHA=$(gh api "repos/$REPO/git/ref/tags/v${MAJOR}" --jq '.object.sha' 2>/dev/null || echo "")

          if [ "$CURRENT_SHA" = "${{ github.sha }}" ]; then
            echo "v${MAJOR} already points to ${{ github.sha }}, skipping"
          else
            # Use git/ref (singular) for exact match
            if [ -n "$CURRENT_SHA" ]; then
              gh api --method DELETE "repos/$REPO/git/refs/tags/v${MAJOR}"
              echo "Deleted existing v${MAJOR} tag"
            fi
            gh api "repos/$REPO/git/refs" \
              -f ref="refs/tags/v${MAJOR}" \
              -f sha="${{ github.sha }}"
            echo "Updated v${MAJOR} tag to ${{ github.sha }}"
          fi

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: "24"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Publish to npm
        env:
          VERSION: ${{ steps.version.outputs.version }}
        run: |
          PACKAGE_NAME=$(node -p "require('./package.json').name")

          # Idempotency: skip if already published
          if npm view "${PACKAGE_NAME}@${VERSION}" version &>/dev/null 2>&1; then
            echo "${PACKAGE_NAME}@${VERSION} already published, skipping"
          else
            npm publish --provenance --access public
            echo "Published ${PACKAGE_NAME}@${VERSION}"
          fi

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
          VERSION: ${{ steps.version.outputs.version }}
        run: |
          # Idempotency: skip if release already exists
          if gh release view "v${VERSION}" --repo "${{ github.repository }}" &>/dev/null 2>&1; then
            echo "Release v${VERSION} already exists, skipping"
          else
            gh release create "v${VERSION}" \
              --repo "${{ github.repository }}" \
              --generate-notes \
              --title "v${VERSION}"
            echo "Created GitHub Release v${VERSION}"
          fi
```

**Key design decisions:**

- `if: startsWith(...)` on the job means the entire workflow is skipped for non-release commits (no wasted runner time)
- CI wait excludes `publish` (this job's own check run) to prevent self-deadlock
- Every mutating step (tag, publish, release) checks for prior completion before acting
- `environment: npm` is on this job (needed for OIDC provenance)
- Build is repeated here (simpler than artifact passing between workflows)

**Step 2: Verify YAML is valid**

Run: `npx yaml-lint .github/workflows/release-publish.yaml`
Expected: No errors

**Step 3: Commit**

```bash
git add .github/workflows/release-publish.yaml
git commit -m "ci(release): add release-publish.yaml for Phase 2 (tag, publish, release after CI)"
```

---

### Task 3: Lint and verify

**Step 1: Run lint**

Run: `./lint.sh`
Expected: All green

**Step 2: Commit lint fixes if any**

```bash
git add -A
git commit -m "fix(ci): lint fixes for release workflow"
```

(Only if lint required fixes)
