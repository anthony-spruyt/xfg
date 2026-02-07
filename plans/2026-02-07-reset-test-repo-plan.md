# Global Test Repo Reset Script — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all per-job GitHub integration test cleanup with a single `reset-test-repo.sh` script that nukes the test repo to a clean state.

**Architecture:** One bash script with 4 ordered cleanup steps (rulesets → PRs → branches → nuclear reset of default branch). All 7 GitHub integration test jobs call it before and after their test, with `if: always()` on the after step.

**Tech Stack:** Bash, GitHub CLI (`gh`), GitHub REST API (Git Data API for tree/commit/ref operations)

---

### Task 1: Create `reset-test-repo.sh`

**Files:**

- Create: `.github/scripts/reset-test-repo.sh`

**Step 1: Write the script**

Create `.github/scripts/reset-test-repo.sh` with the following content:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Global reset script for GitHub integration tests.
# Resets a test repo to a clean state: no rulesets, no PRs, no extra branches,
# default branch contains only README.md.
#
# Usage: reset-test-repo.sh <owner/repo>
# Requires: GH_TOKEN environment variable

REPO="${1:?Usage: reset-test-repo.sh <owner/repo>}"

echo "=== Resetting ${REPO} to clean state ==="

# Auto-detect default branch
DEFAULT_BRANCH=$(gh api "repos/${REPO}" --jq '.default_branch')
echo "Default branch: ${DEFAULT_BRANCH}"

# Step 1 — Delete all rulesets
# Must run first: rulesets enforce branch protection that blocks other cleanup.
echo "Step 1: Deleting all rulesets..."
RULESET_IDS=$(gh api "repos/${REPO}/rulesets" --paginate --jq '.[].id' 2>/dev/null || true)
for id in ${RULESET_IDS}; do
  gh api --method DELETE "repos/${REPO}/rulesets/${id}" 2>/dev/null || true
  echo "  Deleted ruleset ${id}"
done

# Step 2 — Close all open PRs (with --delete-branch)
echo "Step 2: Closing all open PRs..."
PR_NUMBERS=$(gh pr list --repo "${REPO}" --state open --json number --jq '.[].number' 2>/dev/null || true)
for pr in ${PR_NUMBERS}; do
  gh pr close "${pr}" --repo "${REPO}" --delete-branch 2>/dev/null || true
  echo "  Closed PR #${pr}"
done

# Brief pause — GitHub needs time to finish deleting branch refs from PR closures
if [ -n "${PR_NUMBERS}" ]; then
  echo "  Waiting for branch deletions to propagate..."
  sleep 3
fi

# Step 3 — Delete all branches except default
echo "Step 3: Deleting all branches except ${DEFAULT_BRANCH}..."
BRANCHES=$(gh api "repos/${REPO}/branches" --paginate --jq ".[].name" 2>/dev/null || true)
for branch in ${BRANCHES}; do
  if [ "${branch}" != "${DEFAULT_BRANCH}" ]; then
    gh api --method DELETE "repos/${REPO}/git/refs/heads/${branch}" 2>/dev/null || true
    echo "  Deleted branch ${branch}"
  fi
done

# Step 4 — Reset default branch to README-only via Git Data API
echo "Step 4: Resetting ${DEFAULT_BRANCH} to README-only..."

README_CONTENT=$(printf '# xfg-test\n\nIntegration test repository for xfg.\n' | base64 -w 0)

# Create blob
BLOB_SHA=$(gh api "repos/${REPO}/git/blobs" \
  -f content="${README_CONTENT}" \
  -f encoding="base64" \
  --jq '.sha')

# Create tree with only README.md
TREE_SHA=$(gh api "repos/${REPO}/git/trees" \
  --input - <<TREE_JSON --jq '.sha'
{
  "tree": [
    {
      "path": "README.md",
      "mode": "100644",
      "type": "blob",
      "sha": "${BLOB_SHA}"
    }
  ]
}
TREE_JSON
)

# Create orphan commit (no parents)
COMMIT_SHA=$(gh api "repos/${REPO}/git/commits" \
  --input - <<COMMIT_JSON --jq '.sha'
{
  "message": "test: reset to clean state",
  "tree": "${TREE_SHA}",
  "parents": []
}
COMMIT_JSON
)

# Force-update default branch ref
gh api --method PATCH "repos/${REPO}/git/refs/heads/${DEFAULT_BRANCH}" \
  -f sha="${COMMIT_SHA}" \
  -F force=true > /dev/null

echo "  Reset ${DEFAULT_BRANCH} to commit ${COMMIT_SHA}"

echo "=== Reset complete ==="
```

**Step 2: Make script executable**

Run: `chmod +x .github/scripts/reset-test-repo.sh`

**Step 3: Commit**

```bash
git add .github/scripts/reset-test-repo.sh
git commit -m "feat(ci): add global reset-test-repo.sh script (#393)"
```

---

### Task 2: Update `integration-test-cli-sync-github-pat` — add cleanup

**Files:**

- Modify: `.github/workflows/ci.yaml:200-208`

**Step 1: Add cleanup before and after the test step**

Replace lines 200-208 (from `Configure git` through `Run GitHub integration tests`) with:

```yaml
- name: Configure git
  run: |
    git config --global user.name "github-actions[bot]"
    git config --global user.email "github-actions[bot]@users.noreply.github.com"

# Cleanup before — reset test repo to clean state
- name: Cleanup — reset test repo
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh anthony-spruyt/xfg-test

- name: Run GitHub integration tests (PAT)
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: npm run test:integration:github

# Cleanup — always runs regardless of pass/fail
- name: Cleanup — reset test repo
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh anthony-spruyt/xfg-test
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): add cleanup to integration-test-cli-sync-github-pat (#393)"
```

---

### Task 3: Update `integration-test-cli-sync-github-app` — replace cleanup

**Files:**

- Modify: `.github/workflows/ci.yaml:243-267`

**Step 1: Replace cleanup steps**

Replace the cleanup-before step (lines 243-247):

```yaml
# Cleanup before — teardown leftover state from previous runs
- name: Cleanup — teardown leftover state
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/cleanup-github-app-tests.sh
```

With:

```yaml
# Cleanup before — reset test repo to clean state
- name: Cleanup — reset test repo
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh anthony-spruyt/xfg-test
```

Replace the cleanup-after step (lines 262-267):

```yaml
# Cleanup — always runs regardless of pass/fail
- name: Cleanup — teardown test state
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/cleanup-github-app-tests.sh
```

With:

```yaml
# Cleanup — always runs regardless of pass/fail
- name: Cleanup — reset test repo
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh anthony-spruyt/xfg-test
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): replace cleanup in integration-test-cli-sync-github-app (#393)"
```

---

### Task 4: Update `integration-test-cli-settings-rulesets-pat` — add cleanup

**Files:**

- Modify: `.github/workflows/ci.yaml:297-305`

**Step 1: Add cleanup before and after the test step**

Replace lines 297-305 (from `Configure git` through `Run GitHub settings integration tests`) with:

```yaml
- name: Configure git
  run: |
    git config --global user.name "github-actions[bot]"
    git config --global user.email "github-actions[bot]@users.noreply.github.com"

# Cleanup before — reset test repo to clean state
- name: Cleanup — reset test repo
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh anthony-spruyt/xfg-test

- name: Run GitHub settings integration tests
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: npm run test:integration:github-rulesets

# Cleanup — always runs regardless of pass/fail
- name: Cleanup — reset test repo
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh anthony-spruyt/xfg-test
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): add cleanup to integration-test-cli-settings-rulesets-pat (#393)"
```

---

### Task 5: Update `integration-test-cli-settings-repo-pat` — add cleanup

**Files:**

- Modify: `.github/workflows/ci.yaml:335-343`

**Step 1: Add cleanup before and after the test step**

Replace lines 335-343 (from `Configure git` through `Run GitHub repo settings integration tests`) with:

```yaml
- name: Configure git
  run: |
    git config --global user.name "github-actions[bot]"
    git config --global user.email "github-actions[bot]@users.noreply.github.com"

# Cleanup before — reset test repo to clean state
- name: Cleanup — reset test repo
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh anthony-spruyt/xfg-test

- name: Run GitHub repo settings integration tests
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: npm run test:integration:github-repo-settings

# Cleanup — always runs regardless of pass/fail
- name: Cleanup — reset test repo
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh anthony-spruyt/xfg-test
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): add cleanup to integration-test-cli-settings-repo-pat (#393)"
```

---

### Task 6: Update `integration-test-action-sync-pat` — replace cleanup

**Files:**

- Modify: `.github/workflows/ci.yaml:385-454`

**Step 1: Replace cleanup-before step**

Replace lines 385-391:

```yaml
# Cleanup before — teardown leftover state from previous runs
- name: Cleanup — teardown leftover state
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: |
    .github/scripts/cleanup-test-pr.sh "${TEST_REPO}" "${PAT_BRANCH}"
    .github/scripts/delete-manifest.sh "${TEST_REPO}"
```

With:

```yaml
# Cleanup before — reset test repo to clean state
- name: Cleanup — reset test repo
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh "${TEST_REPO}"
```

**Step 2: Replace cleanup-after step**

Replace lines 447-454:

```yaml
# Cleanup — always runs regardless of pass/fail
- name: Cleanup — teardown test state
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: |
    .github/scripts/cleanup-test-pr.sh "${TEST_REPO}" "${PAT_BRANCH}"
    .github/scripts/delete-manifest.sh "${TEST_REPO}"
```

With:

```yaml
# Cleanup — always runs regardless of pass/fail
- name: Cleanup — reset test repo
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh "${TEST_REPO}"
```

**Step 3: Remove unused `PAT_BRANCH` env var**

The `PAT_BRANCH` env var at line 357 is only used in cleanup steps (now replaced) and in the Act/Assert steps via `${{ env.PAT_BRANCH }}`. Check if it's still needed — it is, because line 409 uses `branch: ${{ env.PAT_BRANCH }}` and line 420 uses it in assertions. Keep it.

**Step 4: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): replace cleanup in integration-test-action-sync-pat (#393)"
```

---

### Task 7: Update `integration-test-action-sync-app` — replace cleanup

**Files:**

- Modify: `.github/workflows/ci.yaml:496-567`

**Step 1: Replace cleanup-before step**

Replace lines 496-502:

```yaml
# Cleanup before — teardown leftover state from previous runs
- name: Cleanup — teardown leftover state
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: |
    .github/scripts/cleanup-test-pr.sh "${TEST_REPO}" "${APP_BRANCH}"
    .github/scripts/delete-manifest.sh "${TEST_REPO}"
```

With:

```yaml
# Cleanup before — reset test repo to clean state
- name: Cleanup — reset test repo
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh "${TEST_REPO}"
```

**Step 2: Replace cleanup-after step**

Replace lines 560-567:

```yaml
# Cleanup — always runs regardless of pass/fail
- name: Cleanup — teardown test state
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: |
    .github/scripts/cleanup-test-pr.sh "${TEST_REPO}" "${APP_BRANCH}"
    .github/scripts/delete-manifest.sh "${TEST_REPO}"
```

With:

```yaml
# Cleanup — always runs regardless of pass/fail
- name: Cleanup — reset test repo
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh "${TEST_REPO}"
```

**Step 3: Same as Task 6 Step 3 — `APP_BRANCH` is still used in Act/Assert steps. Keep it.**

**Step 4: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): replace cleanup in integration-test-action-sync-app (#393)"
```

---

### Task 8: Update `integration-test-action-settings-app` — replace cleanup

**Files:**

- Modify: `.github/workflows/ci.yaml:608-650`

**Step 1: Replace cleanup-before step**

Replace lines 608-617:

```yaml
# Cleanup before — teardown leftover rulesets from previous runs
- name: Cleanup — teardown leftover rulesets
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: |
    RULESET_ID=$(gh api repos/${TEST_REPO}/rulesets --jq '.[] | select(.name == "xfg-test-ruleset") | .id')
    if [ -n "$RULESET_ID" ]; then
      gh api --method DELETE repos/${TEST_REPO}/rulesets/${RULESET_ID}
      echo "Cleaned up leftover test ruleset"
    fi
```

With:

```yaml
# Cleanup before — reset test repo to clean state
- name: Cleanup — reset test repo
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh "${TEST_REPO}"
```

**Step 2: Replace cleanup-after step**

Replace lines 640-650:

```yaml
# Cleanup — always runs regardless of pass/fail
- name: Cleanup — teardown test ruleset
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: |
    RULESET_ID=$(gh api repos/${TEST_REPO}/rulesets --jq '.[] | select(.name == "xfg-test-ruleset") | .id')
    if [ -n "$RULESET_ID" ]; then
      gh api --method DELETE repos/${TEST_REPO}/rulesets/${RULESET_ID}
      echo "Cleaned up test ruleset"
    fi
```

With:

```yaml
# Cleanup — always runs regardless of pass/fail
- name: Cleanup — reset test repo
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh "${TEST_REPO}"
```

**Step 3: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): replace cleanup in integration-test-action-settings-app (#393)"
```

---

### Task 9: Delete old cleanup scripts

**Files:**

- Delete: `.github/scripts/cleanup-test-pr.sh`
- Delete: `.github/scripts/cleanup-github-app-tests.sh`
- Delete: `.github/scripts/delete-manifest.sh`

**Step 1: Verify no remaining references to the old scripts**

Run:

```bash
grep -r 'cleanup-test-pr\|cleanup-github-app-tests\|delete-manifest' .github/
```

Expected: No matches (all references were replaced in Tasks 2-8).

**Step 2: Delete the scripts**

```bash
git rm .github/scripts/cleanup-test-pr.sh
git rm .github/scripts/cleanup-github-app-tests.sh
git rm .github/scripts/delete-manifest.sh
```

**Step 3: Commit**

```bash
git add -A .github/scripts/
git commit -m "refactor(ci): delete old per-job cleanup scripts (#393)"
```

---

### Task 10: Final verification

**Step 1: Lint the workflow**

Run: `./lint.sh`
Expected: PASS

**Step 2: Verify the workflow YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yaml'))"`
Expected: No errors

**Step 3: Verify script is executable**

Run: `ls -la .github/scripts/reset-test-repo.sh`
Expected: `-rwxr-xr-x` permissions

**Step 4: Verify no dangling references**

Run: `grep -r 'cleanup-test-pr\|cleanup-github-app-tests\|delete-manifest' .github/`
Expected: No matches

**Step 5: Squash into single commit (optional, per user preference)**

If the user wants a single commit:

```bash
git reset --soft HEAD~9
git commit -m "refactor(ci): global test repo reset script for GitHub integration tests (#393)"
```
