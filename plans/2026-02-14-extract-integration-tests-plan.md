# Extract Integration Tests to Reusable Workflow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract 13 inline integration test jobs from `ci.yaml` into a reusable workflow, and DRY up common setup steps with a composite action.

**Architecture:** Local reusable workflow (`_integration-tests.yaml`) called from `ci.yaml` via `workflow_call`. Common setup steps (checkout, node, npm ci, artifact download) extracted into a composite action (`integration-test-setup`). No behavioral change.

**Tech Stack:** GitHub Actions (reusable workflows, composite actions)

---

### Task 1: Create the composite action

**Files:**

- Create: `.github/actions/integration-test-setup/action.yaml`

**Step 1: Create the composite action file**

```yaml
---
name: Integration Test Setup
description: Common setup steps for integration test jobs

inputs:
  download-package:
    description: "Download the package artifact and set XFG_PACKAGE env var"
    required: false
    default: "false"

runs:
  using: composite
  steps:
    - uses: actions/checkout@v6

    - name: Setup Node.js
      uses: actions/setup-node@v6
      with:
        node-version: "24"
        cache: "npm"

    - name: Install dependencies
      shell: bash
      run: npm ci

    - name: Download build artifact
      uses: actions/download-artifact@v7
      with:
        name: dist
        path: dist/

    - name: Download package artifact
      if: inputs.download-package == 'true'
      uses: actions/download-artifact@v7
      with:
        name: package

    - name: Set package path
      if: inputs.download-package == 'true'
      shell: bash
      run: echo "XFG_PACKAGE=$(ls aspruyt-xfg-*.tgz)" >> "$GITHUB_ENV"
```

**Step 2: Commit**

```bash
git add .github/actions/integration-test-setup/action.yaml
git commit -m "ci: add composite action for integration test setup (#473)"
```

---

### Task 2: Create the reusable workflow

**Files:**

- Create: `.github/workflows/_integration-tests.yaml`

**Step 1: Create the reusable workflow file**

The file contains all 13 integration test jobs moved from `ci.yaml`. Each job has `needs`/`if` removed (caller handles those), and common setup steps replaced with the composite action.

```yaml
---
# yaml-language-server: $schema=https://raw.githubusercontent.com/SchemaStore/schemastore/master/src/schemas/json/github-workflow.json
name: Integration Tests

on:
  workflow_call:

jobs:
  integration-test-cli-sync-ado-pat:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-ado
      cancel-in-progress: false

    steps:
      - uses: ./.github/actions/integration-test-setup

      - name: Install Azure CLI DevOps Extension
        run: az extension add --name azure-devops --yes

      - name: Configure git credential helper for Azure DevOps
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          # Use credential helper that reads from env var (more secure than URL-embedded PAT)
          chmod +x .github/scripts/git-credential-ado.sh
          git config --global credential."https://dev.azure.com".helper "$(pwd)/.github/scripts/git-credential-ado.sh"
          git config --global credential."https://dev.azure.com".useHttpPath true

      - name: Run Azure DevOps integration tests
        env:
          AZURE_DEVOPS_EXT_PAT: ${{ secrets.AZURE_DEVOPS_EXT_PAT }}
        run: npm run test:integration:ado

  integration-test-cli-sync-gitlab-pat:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-gitlab
      cancel-in-progress: false

    steps:
      - uses: ./.github/actions/integration-test-setup

      - name: Install GitLab CLI
        run: |
          curl -sSL "https://raw.githubusercontent.com/upciti/wakemeops/main/assets/install_repository" | sudo bash
          sudo apt-get install -y glab

      - name: Configure git credential helper for GitLab
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          chmod +x .github/scripts/git-credential-gitlab.sh
          git config --global credential."https://gitlab.com".helper "$(pwd)/.github/scripts/git-credential-gitlab.sh"
          git config --global credential."https://gitlab.com".useHttpPath true

      - name: Run GitLab integration tests
        env:
          GITLAB_TOKEN: ${{ secrets.GITLAB_TOKEN }}
        run: npm run test:integration:gitlab

  integration-test-cli-sync-github-pat:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-github-1
      cancel-in-progress: false

    steps:
      - uses: ./.github/actions/integration-test-setup

      - name: Configure git
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"

      - name: Run GitHub integration tests (PAT)
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
        run: npm run test:integration:github

  integration-test-cli-sync-github-app:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-github-2
      cancel-in-progress: false

    steps:
      - uses: ./.github/actions/integration-test-setup

      - name: Configure git
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"

      # GH_TOKEN needed for resetTestRepo() in tests (cross-repo access).
      # xfg commands strip GH_TOKEN via xfgEnv — only App credentials are used.
      - name: Act — run GitHub App integration tests
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
          XFG_GITHUB_APP_ID: ${{ vars.TEST_APP_ID }}
          XFG_GITHUB_APP_PRIVATE_KEY: ${{ secrets.TEST_APP_PRIVATE_KEY }}
        run: npm run test:integration:github-app

      # Assert — PAT for validation
      - name: Assert — validate results
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
        run: .github/scripts/assert-github-app-tests.sh

  integration-test-cli-settings-rulesets-pat:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-github-3
      cancel-in-progress: false

    steps:
      - uses: ./.github/actions/integration-test-setup

      - name: Configure git
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"

      - name: Run GitHub settings integration tests
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
        run: npm run test:integration:github-rulesets

  integration-test-cli-settings-repo-pat:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-github-4
      cancel-in-progress: false

    steps:
      - uses: ./.github/actions/integration-test-setup

      - name: Configure git
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"

      - name: Run GitHub repo settings integration tests
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
        run: npm run test:integration:github-repo-settings

  integration-test-action-sync-pat:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-github-5
      cancel-in-progress: false

    env:
      TEST_REPO: anthony-spruyt/xfg-test-4
      PAT_BRANCH: chore/sync-my-config

    steps:
      - uses: ./.github/actions/integration-test-setup
        with:
          download-package: "true"

      # Cleanup before — reset test repo to clean state
      - name: Cleanup — reset test repo
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
        run: .github/scripts/reset-test-repo.sh "${TEST_REPO}"

      # Arrange — seed manifest and configure git identity
      - name: Arrange — seed manifest
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
        run: .github/scripts/seed-manifest.sh "${TEST_REPO}" "integration-test-action-github-pat"

      - name: Arrange — configure custom git identity
        run: |
          git config --global user.name "test-user"
          git config --global user.email "test@example.com"

      # Act — run xfg action with PAT
      - name: Act — run xfg action
        uses: ./
        with:
          config: ./test/fixtures/integration-test-action-github-pat.yaml
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

  integration-test-action-sync-app:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-github-6
      cancel-in-progress: false

    env:
      TEST_REPO: anthony-spruyt/xfg-test-5
      APP_BRANCH: chore/sync-app-test

    steps:
      - uses: ./.github/actions/integration-test-setup
        with:
          download-package: "true"

      # Cleanup before — reset test repo to clean state
      - name: Cleanup — reset test repo
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
        run: .github/scripts/reset-test-repo.sh "${TEST_REPO}"

      # Arrange — seed manifest
      - name: Arrange — seed manifest
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
        run: .github/scripts/seed-manifest.sh "${TEST_REPO}" "integration-test-action-github-app"

      # Act — run xfg action with GitHub App credentials (NO GH_TOKEN)
      - name: Act — run xfg action with GitHub App credentials
        uses: ./
        with:
          config: ./test/fixtures/integration-test-action-github-app.yaml
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

  integration-test-action-settings-app:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-github-7
      cancel-in-progress: false

    env:
      TEST_REPO: anthony-spruyt/xfg-test-6

    steps:
      - uses: ./.github/actions/integration-test-setup
        with:
          download-package: "true"

      # Cleanup before — reset test repo to clean state
      - name: Cleanup — reset test repo
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
        run: .github/scripts/reset-test-repo.sh "${TEST_REPO}"

      # Act — run xfg action with settings command
      - name: Act — run xfg action with settings command
        uses: ./
        with:
          command: settings
          config: ./test/fixtures/integration-test-action-settings-app.yaml
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

  integration-test-cli-lifecycle-github-pat:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-github-8
      cancel-in-progress: false

    steps:
      - uses: ./.github/actions/integration-test-setup

      - name: Configure git
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          chmod +x .github/scripts/git-credential-ado.sh
          git config --global credential."https://dev.azure.com".helper "$(pwd)/.github/scripts/git-credential-ado.sh"
          git config --global credential."https://dev.azure.com".useHttpPath true

      - name: Run lifecycle integration tests (PAT)
        env:
          GH_TOKEN: ${{ secrets.GH_PAT_ORG }}
          AZURE_DEVOPS_EXT_PAT: ${{ secrets.AZURE_DEVOPS_EXT_PAT }}
        run: npm run test:integration:github-lifecycle

  integration-test-cli-lifecycle-github-app:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-github-9
      cancel-in-progress: false

    steps:
      - uses: ./.github/actions/integration-test-setup

      - name: Configure git
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          chmod +x .github/scripts/git-credential-ado.sh
          git config --global credential."https://dev.azure.com".helper "$(pwd)/.github/scripts/git-credential-ado.sh"
          git config --global credential."https://dev.azure.com".useHttpPath true

      - name: Run lifecycle integration tests (GitHub App)
        env:
          GH_TOKEN: ${{ secrets.GH_PAT_ORG }}
          XFG_GITHUB_APP_ID: ${{ vars.TEST_APP_ID }}
          XFG_GITHUB_APP_PRIVATE_KEY: ${{ secrets.TEST_APP_PRIVATE_KEY }}
          AZURE_DEVOPS_EXT_PAT: ${{ secrets.AZURE_DEVOPS_EXT_PAT }}
        run: npm run test:integration:github-lifecycle-app

  integration-test-action-lifecycle-pat:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-github-10
      cancel-in-progress: false

    env:
      OWNER: spruyt-labs

    steps:
      - uses: ./.github/actions/integration-test-setup
        with:
          download-package: "true"

      - name: Arrange — generate unique repo name and config
        id: arrange
        run: >-
          .github/scripts/create-ephemeral-repo-config.sh
          "action-pat" "${{ env.OWNER }}"
          "/tmp/lifecycle-action-pat-config.yaml"
          "lifecycle-action-pat-test"
          "lifecycle-action-test.json"
          '{"createdByAction": true}'

      - name: Act — run xfg action (create repo via lifecycle)
        uses: ./
        with:
          config: /tmp/lifecycle-action-pat-config.yaml
          merge: direct
          github-token: ${{ secrets.GH_PAT_ORG }}
          xfg-package: "./${{ env.XFG_PACKAGE }}"

      - name: Assert — verify repo was created
        env:
          GH_TOKEN: ${{ secrets.GH_PAT_ORG }}
          REPO_NAME: ${{ steps.arrange.outputs.repo_name }}
        run: >-
          .github/scripts/assert-ephemeral-repo.sh
          "${OWNER}/${REPO_NAME}"
          "lifecycle-action-test.json"
          '.createdByAction == true'

      - name: Cleanup — delete ephemeral repo
        if: always()
        env:
          GH_TOKEN: ${{ secrets.GH_PAT_ORG }}
          REPO_NAME: ${{ steps.arrange.outputs.repo_name }}
        run: .github/scripts/delete-ephemeral-repo.sh "${OWNER}/${REPO_NAME}"

  integration-test-action-lifecycle-app:
    runs-on: ubuntu-latest

    concurrency:
      group: integration-github-11
      cancel-in-progress: false

    env:
      OWNER: spruyt-labs

    steps:
      - uses: ./.github/actions/integration-test-setup
        with:
          download-package: "true"

      - name: Arrange — generate unique repo name and config
        id: arrange
        run: >-
          .github/scripts/create-ephemeral-repo-config.sh
          "action-app" "${{ env.OWNER }}"
          "/tmp/lifecycle-action-app-config.yaml"
          "lifecycle-action-app-test"
          "lifecycle-action-test.json"
          '{"createdByAction": true}'

      - name: Act — run xfg action (create repo via lifecycle, App auth)
        uses: ./
        with:
          config: /tmp/lifecycle-action-app-config.yaml
          merge: direct
          github-token: ${{ github.token }}
          github-app-id: ${{ vars.TEST_APP_ID }}
          github-app-private-key: ${{ secrets.TEST_APP_PRIVATE_KEY }}
          xfg-package: "./${{ env.XFG_PACKAGE }}"

      - name: Assert — verify repo was created
        env:
          GH_TOKEN: ${{ secrets.GH_PAT_ORG }}
          REPO_NAME: ${{ steps.arrange.outputs.repo_name }}
        run: >-
          .github/scripts/assert-ephemeral-repo.sh
          "${OWNER}/${REPO_NAME}"
          "lifecycle-action-test.json"
          '.createdByAction == true'

      - name: Cleanup — delete ephemeral repo
        if: always()
        env:
          GH_TOKEN: ${{ secrets.GH_PAT_ORG }}
          REPO_NAME: ${{ steps.arrange.outputs.repo_name }}
        run: .github/scripts/delete-ephemeral-repo.sh "${OWNER}/${REPO_NAME}"
```

**Step 2: Commit**

```bash
git add .github/workflows/_integration-tests.yaml
git commit -m "ci: add reusable workflow for integration tests (#473)"
```

---

### Task 3: Refactor ci.yaml

**Files:**

- Modify: `.github/workflows/ci.yaml:81-858` — remove all 13 integration test jobs and summary `needs` list

**Step 1: Replace lines 81–858 in `ci.yaml`**

Remove everything from `integration-test-cli-sync-ado-pat:` (line 81) through end of file and replace with:

Note: when inserting, indent the YAML below by 2 spaces so it sits under the existing `jobs:` key (Prettier strips leading whitespace from code blocks).

```yaml
integration-tests:
  needs:
    - "build"
  if: ${{ !failure() && !cancelled() && github.event_name == 'push' }}
  uses: ./.github/workflows/_integration-tests.yaml
  secrets: "inherit"

# Summary job for branch protection - references reusable workflow job
summary:
  needs:
    - "lint"
    - "build"
    - "integration-tests"
  if: "always()"
  uses: "anthony-spruyt/repo-operator/.github/workflows/_summary.yaml@main"
```

The final `ci.yaml` should be ~95 lines (header + lint + build + integration-tests caller + summary).

**Step 2: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "ci: extract integration tests to reusable workflow (#473)"
```

---

### Task 4: Lint and validate

**Step 1: Run the project linter**

Run: `./lint.sh`
Expected: PASS — all YAML files valid

**Step 2: Verify ci.yaml line count**

Run: `wc -l .github/workflows/ci.yaml`
Expected: ~95 lines (down from ~858)

**Step 3: Verify all 13 jobs exist in the reusable workflow**

Run: `grep -c 'integration-test-' .github/workflows/_integration-tests.yaml`
Expected: 13

**Step 4: Verify composite action exists and is valid YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/actions/integration-test-setup/action.yaml'))"`
Expected: No error

---

### Task 5: Final commit (if lint required changes)

Only needed if Task 4 lint step required fixes. If lint passed clean, skip this task.

```bash
git add -A
git commit -m "ci: fix lint issues from integration test extraction (#473)"
```
