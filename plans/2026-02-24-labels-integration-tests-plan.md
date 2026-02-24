# Labels Integration Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add end-to-end integration tests for the GitHub labels feature covering create, update, rename, idempotent, dry-run, and delete-orphaned flows.

**Architecture:** Six test scenarios in a single test file following the existing rulesets test pattern. Each test resets xfg-test-8 via the shared reset script (extended with label cleanup), runs the settings CLI command, and verifies results via gh api. Tests that need modified configs write them dynamically with writeFileSync.

**Tech Stack:** Node.js test runner, node:assert, gh CLI for API verification, YAML config fixtures.

---

### Task 1: Add label cleanup to reset-test-repo.sh

**Files:**

- Modify: `.github/scripts/reset-test-repo.sh`

**Step 1: Add label deletion step before existing Step 1 (rulesets)**

Insert after the `echo "=== Resetting ${REPO} to clean state ==="` line (line 13), before `# Step 1 - Delete all rulesets`. Uses jq for URL-encoding label names (handles spaces, special characters). Uses while-read loop to handle label names with spaces correctly.

**Step 2: Verify the script is valid bash**

Run: `bash -n .github/scripts/reset-test-repo.sh`
Expected: no output (valid syntax)

**Step 3: Commit**

`feat(test): add label cleanup to reset-test-repo.sh`

---

### Task 2: Create config fixture and npm script

**Files:**

- Create: `test/fixtures/integration-test-config-github-labels.yaml`
- Modify: `package.json`

**Step 1: Create the base config fixture**

Config with id `integration-test-github-labels`, two labels (`xfg-test-bug` with color d73a4a and `xfg-test-feature` with color a2eeef), pointing at `anthony-spruyt/xfg-test-8`.

**Step 2: Add npm script to package.json**

Add `test:integration:github-labels` script after `test:integration:github-repo-settings`, following the same pattern: `npm run build && node --import tsx --test test/integration/github-labels.test.ts`

**Step 3: Commit**

`feat(test): add labels integration test fixture and npm script`

---

### Task 3: Create the test file with create test

**Files:**

- Create: `test/integration/github-labels.test.ts`

**Step 1: Write the test file scaffolding and create test**

Follow `github-rulesets.test.ts` pattern:

- Import from `node:test`, `node:assert`, `node:path`, `node:fs`
- Import `exec` and `projectRoot` from `./test-helpers.js`
- Constants: `TEST_REPO = "anthony-spruyt/xfg-test-8"`, `RESET_SCRIPT` path, `fixturesDir`
- Helper: `resetTestRepo()` calls the reset script
- Helper: `getLabels()` calls `gh api repos/${TEST_REPO}/labels --paginate` and parses JSON
- Helper: `findLabel(labels, name)` case-insensitive lookup
- Helper: `runSettings(configPath, extraArgs)` runs `node dist/cli.js settings --config`
- `beforeEach` calls `resetTestRepo()`
- First test: "settings creates labels in the test repository"
  - Verify no labels exist before
  - Run settings
  - Verify both labels exist with correct name, color, description

**Step 2: Build and verify**

Run: `npm run build`
Expected: compiles successfully

**Step 3: Commit**

`feat(test): add labels integration test with create scenario`

---

### Task 4: Add update labels test

**Files:**

- Modify: `test/integration/github-labels.test.ts`

**Step 1: Add update test**

- Create labels first with base fixture
- Write dynamic config with different color (ff0000, 00ff00) and descriptions
- Run settings again
- Verify labels have updated color and description

**Step 2: Build and verify**

Run: `npm run build`

**Step 3: Commit**

`feat(test): add update labels integration test`

---

### Task 5: Add rename label test

**Files:**

- Modify: `test/integration/github-labels.test.ts`

**Step 1: Add rename test**

- Create labels with base fixture
- Write config with `new_name: "xfg-test-defect"` on the bug label
- Run settings
- Verify old name gone, new name exists with correct properties, feature label unchanged

**Step 2: Build and verify**

Run: `npm run build`

**Step 3: Commit**

`feat(test): add rename label integration test`

---

### Task 6: Add idempotent test

**Files:**

- Modify: `test/integration/github-labels.test.ts`

**Step 1: Add idempotent test**

- Create labels with base fixture
- Run settings again with same fixture
- Verify output contains "No changes needed" or "no changes"

**Step 2: Build and verify**

Run: `npm run build`

**Step 3: Commit**

`feat(test): add idempotent labels integration test`

---

### Task 7: Add dry-run test

**Files:**

- Modify: `test/integration/github-labels.test.ts`

**Step 1: Add dry-run test**

- Verify no labels exist
- Run settings with `--dry-run`
- Verify output contains "DRY RUN"
- Verify no labels were created

**Step 2: Build and verify**

Run: `npm run build`

**Step 3: Commit**

`feat(test): add dry-run labels integration test`

---

### Task 8: Add delete orphaned labels test

**Files:**

- Modify: `test/integration/github-labels.test.ts`

**Step 1: Add delete orphaned test**

This tests the full manifest-tracked deletion flow:

1. Write config with `deleteOrphaned: true` under settings and two labels
2. Run settings - both labels created, manifest committed to repo
3. Write second config with same id but only one label (xfg-test-feature removed)
4. Run settings again
5. Verify xfg-test-bug still exists and xfg-test-feature was deleted

Both configs must use id `integration-test-github-labels` so the manifest tracks them together.

**Step 2: Build and verify**

Run: `npm run build`

**Step 3: Commit**

`feat(test): add delete orphaned labels integration test`

---

### Task 9: Add CI job and update docs

**Files:**

- Modify: `.github/workflows/_integration-tests.yaml`
- Modify: `.claude/rules/integration-tests.md`

**Step 1: Add CI job**

Add `integration-test-cli-settings-labels-pat` job at the end of the file (before any summary reference). Follow the `integration-test-cli-settings-rulesets-pat` pattern:

- `runs-on: ubuntu-latest`
- `concurrency.group: integration-github-12`
- Steps: checkout, integration-test-setup, configure git, run `npm run test:integration:github-labels` with `GH_TOKEN: ${{ secrets.GH_PAT }}`

**Step 2: Update repo table in `.claude/rules/integration-tests.md`**

Add row: `cli-settings-labels-pat` -> `xfg-test-8`

**Step 3: Commit**

`feat(test): add labels integration test CI job`

---

### Task 10: Final verification

**Step 1: Run linter**

Run: `./lint.sh`
Expected: passes

**Step 2: Run unit tests**

Run: `npm test`
Expected: all pass

**Step 3: Build**

Run: `npm run build`
Expected: clean build

**Step 4: Commit any fixes if needed**

`fix(test): address lint issues in labels integration test`
