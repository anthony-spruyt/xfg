# Split integration-test-action Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the monolithic `integration-test-action` CI job into 3 isolated jobs (PAT, App, Settings) to prevent env var leakage between test groups.

**Architecture:** Replace one job with 3 independent jobs sharing artifacts from the build step. Each job follows Cleanup-before / Arrange / Act / Assert / Cleanup-after pattern. Concurrency group serializes access to the shared test repo.

**Tech Stack:** GitHub Actions YAML, shell scripts

**Issue:** [#381](https://github.com/anthony-spruyt/xfg/issues/381)

---

### Task 1: Add package artifact to build job

**Files:**

- Modify: `.github/workflows/ci.yaml:61-67` (after existing Upload build artifact step)

**Step 1: Add npm pack and upload steps to the build job**

Add these two steps after the existing "Upload build artifact" step (line 67), with the same `if: github.event_name == 'push'` condition:

```yaml
- name: Create package for action tests
  if: github.event_name == 'push'
  run: npm pack

- name: Upload package artifact
  if: github.event_name == 'push'
  uses: actions/upload-artifact@v6
  with:
    name: package
    path: "*.tgz"
    retention-days: 1
```

**Step 2: Validate YAML syntax**

Run: `npx yaml-lint .github/workflows/ci.yaml 2>&1 || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yaml'))"`
Expected: No errors

**Step 3: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): add package artifact to build job (#381)"
```

---

### Task 2: Add integration-test-action-pat job

**Files:**

- Modify: `.github/workflows/ci.yaml` (replace lines 336-540, the `integration-test-action` job)

**Step 1: Replace the integration-test-action job with the PAT job**

Delete the entire `integration-test-action` job (lines 336-539). In its place, add the PAT job. The full YAML for this job:

```yaml
# GitHub Action test — PAT credentials
integration-test-action-pat:
  needs:
    - "build"
    - "integration-test-github"
    - "integration-test-github-app"
  if: ${{ !failure() && !cancelled() && github.event_name == 'push' }}
  runs-on: ubuntu-latest

  concurrency:
    group: integration-github
    cancel-in-progress: false

  env:
    TEST_REPO: anthony-spruyt/xfg-test
    PAT_BRANCH: chore/sync-my-config

  steps:
    - uses: actions/checkout@v6

    - name: Setup Node.js
      uses: actions/setup-node@v6
      with:
        node-version: "24"
        cache: "npm"

    - name: Install dependencies
      run: npm ci

    - name: Download build artifact
      uses: actions/download-artifact@v7
      with:
        name: dist
        path: dist/

    - name: Download package artifact
      uses: actions/download-artifact@v7
      with:
        name: package

    - name: Set package path
      run: echo "XFG_PACKAGE=$(ls aspruyt-xfg-*.tgz)" >> "$GITHUB_ENV"

    # Cleanup before — teardown leftover state from previous runs
    - name: Cleanup — teardown leftover state
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: |
        .github/scripts/cleanup-test-pr.sh "${TEST_REPO}" "${PAT_BRANCH}"
        .github/scripts/delete-manifest.sh "${TEST_REPO}"

    # Arrange — seed manifest and configure git identity
    - name: Arrange — seed manifest
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: .github/scripts/seed-manifest.sh "${TEST_REPO}"

    - name: Arrange — configure custom git identity
      run: |
        git config --global user.name "test-user"
        git config --global user.email "test@example.com"

    # Act — run xfg action with PAT
    - name: Act — run xfg action
      uses: ./
      with:
        config: ./test/fixtures/integration-test-action-github.yaml
        branch: ${{ env.PAT_BRANCH }}
        github-token: ${{ secrets.GH_PAT }}
        xfg-package: "./${{ env.XFG_PACKAGE }}"

    # Assert — verify PR created and git identity preserved
    - name: Assert — verify PR created and git identity preserved
      id: pat-validate
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: |
        echo "Verifying PR was created..."
        PR_INFO=$(gh pr list --repo ${TEST_REPO} --head ${PAT_BRANCH} --json number,title,url --jq '.[0]')
        if [ -z "$PR_INFO" ]; then
          echo "ERROR: No PR was created"
          exit 1
        fi
        echo "PR created successfully:"
        echo "$PR_INFO" | jq .

        # Verify commit author is preserved (not overwritten to github-actions[bot])
        PR_NUMBER=$(echo "$PR_INFO" | jq -r '.number')
        COMMIT_SHA=$(gh pr view "$PR_NUMBER" --repo ${TEST_REPO} --json commits --jq '.commits[-1].oid')
        COMMIT_AUTHOR=$(gh pr view $PR_NUMBER --repo ${TEST_REPO} --json commits --jq '.commits[-1].authors[0].name')
        echo "Commit author: $COMMIT_AUTHOR"
        if [ "$COMMIT_AUTHOR" = "github-actions[bot]" ]; then
          echo "ERROR: Git identity was overwritten to github-actions[bot]"
          exit 1
        fi
        echo "Git identity preserved correctly"

        # Export commit SHA for next step
        echo "commit_sha=${COMMIT_SHA}" >> "$GITHUB_OUTPUT"

    - name: Assert — verify file count in commit message
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: .github/scripts/verify-commit-file-count.sh "${TEST_REPO}" "${{ steps.pat-validate.outputs.commit_sha }}"

    # Cleanup — always runs regardless of pass/fail
    - name: Cleanup — teardown test state
      if: always()
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: |
        .github/scripts/cleanup-test-pr.sh "${TEST_REPO}" "${PAT_BRANCH}"
        .github/scripts/delete-manifest.sh "${TEST_REPO}"
```

**Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yaml')); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): extract integration-test-action-pat job (#381)"
```

---

### Task 3: Add integration-test-action-app job

**Files:**

- Modify: `.github/workflows/ci.yaml` (add after the PAT job from Task 2)

**Step 1: Add the App job after the PAT job**

```yaml
# GitHub Action test — GitHub App credentials (isolated, no GH_TOKEN in Act step)
integration-test-action-app:
  needs:
    - "build"
    - "integration-test-github"
    - "integration-test-github-app"
  if: ${{ !failure() && !cancelled() && github.event_name == 'push' }}
  runs-on: ubuntu-latest

  concurrency:
    group: integration-github
    cancel-in-progress: false

  env:
    TEST_REPO: anthony-spruyt/xfg-test
    APP_BRANCH: chore/sync-app-test

  steps:
    - uses: actions/checkout@v6

    - name: Setup Node.js
      uses: actions/setup-node@v6
      with:
        node-version: "24"
        cache: "npm"

    - name: Install dependencies
      run: npm ci

    - name: Download build artifact
      uses: actions/download-artifact@v7
      with:
        name: dist
        path: dist/

    - name: Download package artifact
      uses: actions/download-artifact@v7
      with:
        name: package

    - name: Set package path
      run: echo "XFG_PACKAGE=$(ls aspruyt-xfg-*.tgz)" >> "$GITHUB_ENV"

    # Cleanup before — teardown leftover state from previous runs
    - name: Cleanup — teardown leftover state
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: |
        .github/scripts/cleanup-test-pr.sh "${TEST_REPO}" "${APP_BRANCH}"
        .github/scripts/delete-manifest.sh "${TEST_REPO}"

    # Arrange — seed manifest
    - name: Arrange — seed manifest
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: .github/scripts/seed-manifest.sh "${TEST_REPO}"

    # Act — run xfg action with GitHub App credentials (NO GH_TOKEN)
    - name: Act — run xfg action with GitHub App credentials
      uses: ./
      with:
        config: ./test/fixtures/integration-test-action-github.yaml
        branch: ${{ env.APP_BRANCH }}
        # Include github-token to simulate real usage where both are set
        # This tests that GitHub App credentials take precedence over PAT
        github-token: ${{ github.token }}
        github-app-id: ${{ vars.TEST_APP_ID }}
        github-app-private-key: ${{ secrets.TEST_APP_PRIVATE_KEY }}
        xfg-package: "./${{ env.XFG_PACKAGE }}"

    # Assert — verify commit author is GitHub App
    - name: Assert — verify commit author is GitHub App
      id: app-validate
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: |
        echo "Verifying PR was created..."
        PR_INFO=$(gh pr list --repo ${TEST_REPO} --head ${APP_BRANCH} --json number,title,url --jq '.[0]')
        if [ -z "$PR_INFO" ]; then
          echo "ERROR: No PR was created"
          exit 1
        fi
        echo "PR created successfully:"
        echo "$PR_INFO" | jq .

        # Get commit author - should be GitHub App, NOT github-actions[bot]
        PR_NUMBER=$(echo "$PR_INFO" | jq -r '.number')
        COMMIT_SHA=$(gh pr view "$PR_NUMBER" --repo ${TEST_REPO} --json commits --jq '.commits[-1].oid')
        COMMIT_AUTHOR=$(gh api "repos/${TEST_REPO}/commits/${COMMIT_SHA}" --jq '.commit.author.name')
        echo "Commit author: $COMMIT_AUTHOR"

        # Verify commit author is GitHub App, not github-actions[bot] (issue #268)
        if [ "$COMMIT_AUTHOR" = "github-actions[bot]" ]; then
          echo "ERROR: Commit author is github-actions[bot] but should be the GitHub App"
          echo "This indicates the GitHub App token is not being used for GraphQL commits"
          exit 1
        fi
        echo "Commit author is correct (GitHub App)"

        # Export commit SHA for next step
        echo "commit_sha=${COMMIT_SHA}" >> "$GITHUB_OUTPUT"

    - name: Assert — verify file count in commit message
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: .github/scripts/verify-commit-file-count.sh "${TEST_REPO}" "${{ steps.app-validate.outputs.commit_sha }}"

    # Cleanup — always runs regardless of pass/fail
    - name: Cleanup — teardown test state
      if: always()
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: |
        .github/scripts/cleanup-test-pr.sh "${TEST_REPO}" "${APP_BRANCH}"
        .github/scripts/delete-manifest.sh "${TEST_REPO}"
```

**Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yaml')); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): extract integration-test-action-app job (#381)"
```

---

### Task 4: Add integration-test-action-settings job

**Files:**

- Modify: `.github/workflows/ci.yaml` (add after the App job from Task 3)

**Step 1: Add the Settings job after the App job**

```yaml
# GitHub Action test — settings command
integration-test-action-settings:
  needs:
    - "build"
    - "integration-test-github"
    - "integration-test-github-app"
  if: ${{ !failure() && !cancelled() && github.event_name == 'push' }}
  runs-on: ubuntu-latest

  concurrency:
    group: integration-github
    cancel-in-progress: false

  env:
    TEST_REPO: anthony-spruyt/xfg-test

  steps:
    - uses: actions/checkout@v6

    - name: Setup Node.js
      uses: actions/setup-node@v6
      with:
        node-version: "24"
        cache: "npm"

    - name: Install dependencies
      run: npm ci

    - name: Download build artifact
      uses: actions/download-artifact@v7
      with:
        name: dist
        path: dist/

    - name: Download package artifact
      uses: actions/download-artifact@v7
      with:
        name: package

    - name: Set package path
      run: echo "XFG_PACKAGE=$(ls aspruyt-xfg-*.tgz)" >> "$GITHUB_ENV"

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

    # Act — run xfg action with settings command
    - name: Act — run xfg action with settings command
      uses: ./
      with:
        command: settings
        config: ./test/fixtures/integration-test-config-github-rulesets.yaml
        github-token: ${{ secrets.GH_PAT }}
        xfg-package: "./${{ env.XFG_PACKAGE }}"

    # Assert — verify ruleset was created
    - name: Assert — verify ruleset was created
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: |
        RULESET=$(gh api repos/${TEST_REPO}/rulesets --jq '.[] | select(.name == "xfg-test-ruleset")')
        if [ -z "$RULESET" ]; then
          echo "ERROR: Ruleset was not created"
          exit 1
        fi
        echo "Ruleset created successfully"

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

**Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yaml')); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): extract integration-test-action-settings job (#381)"
```

---

### Task 5: Update summary job dependencies

**Files:**

- Modify: `.github/workflows/ci.yaml:541-554` (the `summary` job)

**Step 1: Replace `integration-test-action` with the 3 new job names in summary.needs**

Change the summary job's `needs` array from:

```yaml
needs:
  - "lint"
  - "build"
  - "integration-test-github"
  - "integration-test-github-app"
  - "integration-test-ado"
  - "integration-test-gitlab"
  - "integration-test-github-rulesets"
  - "integration-test-github-repo-settings"
  - "integration-test-action"
```

To:

```yaml
needs:
  - "lint"
  - "build"
  - "integration-test-github"
  - "integration-test-github-app"
  - "integration-test-ado"
  - "integration-test-gitlab"
  - "integration-test-github-rulesets"
  - "integration-test-github-repo-settings"
  - "integration-test-action-pat"
  - "integration-test-action-app"
  - "integration-test-action-settings"
```

**Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yaml')); print('OK')"`
Expected: `OK`

**Step 3: Verify no references to old job name remain**

Run: `grep -n "integration-test-action" .github/workflows/ci.yaml`
Expected: Only the 3 new job names (`integration-test-action-pat`, `integration-test-action-app`, `integration-test-action-settings`), and the comment lines. No bare `integration-test-action` without a suffix.

**Step 4: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): update summary job for split action tests (#381)"
```

---

### Task 6: Final validation and PR

**Step 1: Run linting**

Run: `./lint.sh`
Expected: PASS (CI YAML changes don't affect TS lint, but verify nothing is broken)

**Step 2: Run unit tests**

Run: `npm test`
Expected: PASS (no test files changed)

**Step 3: Review the full diff**

Run: `git diff main --stat`
Expected: Only `.github/workflows/ci.yaml` changed

Run: `git diff main .github/workflows/ci.yaml`
Review: Verify old `integration-test-action` job is fully removed and the 3 new jobs are present.

**Step 4: Push and create PR**

```bash
git push -u origin refactor/381-split-integration-test-action
```

Create PR with title: `refactor(ci): split integration-test-action into separate PAT, App, and Settings jobs (#381)`

PR body should reference:

- Closes #381
- Follows the Arrange/Act/Assert pattern from #378
- Follow-up issues: #388, #389, #390, #391
