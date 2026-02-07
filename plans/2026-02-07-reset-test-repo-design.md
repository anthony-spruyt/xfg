# Global Test Repo Reset Script for GitHub Integration Tests

Issue: #393

## Problem

After splitting `integration-test-action` into 3 isolated jobs (#381, PR #392) and chaining all GitHub integration tests sequentially (PR #394), each job has its own targeted cleanup logic — close specific PRs, delete specific branches, delete manifest, delete rulesets. This is fragile: if a job creates new artifacts, cleanup must be updated in multiple places.

## Design

### The Script

**Location:** `.github/scripts/reset-test-repo.sh`

**Usage:** `reset-test-repo.sh <repo>`

**Behavior:** Four steps, always in this order:

#### Step 1 — Delete all rulesets

Query `gh api repos/${REPO}/rulesets --paginate`, iterate the IDs, delete each with `gh api -X DELETE repos/${REPO}/rulesets/{id}`. Must run first because rulesets enforce branch protection that blocks subsequent cleanup. Skip gracefully if none exist.

#### Step 2 — Close all open PRs

List with `gh pr list --repo ${REPO} --state open --json number`, close each with `gh pr close ${number} --repo ${REPO} --delete-branch`. The `--delete-branch` flag handles the associated head branches.

Add a short `sleep` (2-3 seconds) after this step to avoid a race condition where GitHub hasn't finished deleting branch refs before step 3 lists branches.

#### Step 3 — Delete all branches except default

Auto-detect default branch via `gh api repos/${REPO} --jq .default_branch`. List all branches via `gh api repos/${REPO}/branches --paginate`, filter out the default, delete each via `gh api -X DELETE repos/${REPO}/git/refs/heads/{name}`.

#### Step 4 — Reset default branch to README-only

Using the Git Data API (one atomic operation):

1. Create a blob for `README.md` with minimal content (`# xfg-test\n\nIntegration test repository for xfg.`)
2. Create a tree containing only that blob
3. Create a commit pointing to that tree (no parent — orphan commit)
4. Update `refs/heads/${default_branch}` to point to the new commit

The script requires `GH_TOKEN` to be set and validates the repo argument. Each step logs what it's doing for CI visibility.

### CI Workflow Changes

All 7 GitHub integration test jobs get the same cleanup pattern: run `reset-test-repo.sh` before and after the test, with the "after" step guarded by `if: always()`.

**Jobs that gain cleanup (currently have none):**

- `integration-test-cli-sync-github-pat`
- `integration-test-cli-settings-rulesets-pat`
- `integration-test-cli-settings-repo-pat`

**Jobs that replace existing cleanup:**

- `integration-test-cli-sync-github-app` — replaces `cleanup-github-app-tests.sh`
- `integration-test-action-sync-pat` — replaces `cleanup-test-pr.sh` + `delete-manifest.sh`
- `integration-test-action-sync-app` — same replacement
- `integration-test-action-settings-app` — replaces inline ruleset deletion

**What stays the same per job:**

- Arrange steps (seed-manifest, git identity config) remain job-specific
- Assert steps remain job-specific
- Job chaining order and concurrency group unchanged
- All cleanup steps use `GH_TOKEN: ${{ secrets.GH_PAT }}`

**Step pattern:**

```yaml
- name: Cleanup — reset test repo
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh anthony-spruyt/xfg-test

# ... Arrange / Act / Assert steps ...

- name: Cleanup — reset test repo
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh anthony-spruyt/xfg-test
```

### Script Deletions

Three scripts become dead code and get deleted:

- `.github/scripts/cleanup-test-pr.sh` — PR closing + branch deletion now handled by steps 2-3
- `.github/scripts/cleanup-github-app-tests.sh` — full App test cleanup now handled entirely by reset script
- `.github/scripts/delete-manifest.sh` — manifest deletion now handled by step 4's nuclear reset

**Scripts that remain unchanged:**

- `seed-manifest.sh` — setup, not cleanup
- `assert-github-app-tests.sh` — assertion, not cleanup
- `verify-commit-file-count.sh` — assertion, not cleanup
- `git-credential-ado.sh` / `git-credential-gitlab.sh` — credential helpers, unrelated
