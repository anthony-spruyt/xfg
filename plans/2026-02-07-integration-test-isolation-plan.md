# Integration Test Isolation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every integration test self-contained by nuking repo state before each test, sharing helpers, and removing inter-test dependencies.

**Architecture:** Each platform gets a bash reset script that wipes the test repo clean. Tests call the nuke script at the start instead of doing inline cleanup. The shared `exec()` helper from `test-helpers.ts` replaces duplicates in ADO and GitLab.

**Tech Stack:** Bash (reset scripts), Node.js test runner, `gh`/`az`/`glab` CLIs

**Issues:** #388, #389, #391

**Design doc:** `plans/2026-02-07-integration-test-isolation-design.md`

Note: All `exec()` calls in integration tests use hardcoded commands with test constants, not user input. The shared `exec()` in `test-helpers.ts` is the integration test helper, not `child_process.exec` directly.

---

### Task 1: Create ADO reset script

**Files:**

- Create: `.github/scripts/reset-test-repo-ado.sh`
- Reference: `.github/scripts/reset-test-repo.sh` (GitHub version — follow same structure)
- Reference: `test/integration/ado.test.ts:40-163` (existing ADO API helpers for patterns)

**Step 1: Write the reset script**

Create `.github/scripts/reset-test-repo-ado.sh`. It takes 3 args: `<org-url> <project> <repo>`.

Auth: reads `AZURE_DEVOPS_EXT_PAT` env var. Uses `curl` with Basic auth for REST API calls (same pattern as `adoApi()` in `ado.test.ts:41-51`) and `az repos` CLI for branch operations.

Steps the script performs:

1. Auto-detect default branch via `GET _apis/git/repositories/<repo>?api-version=7.0` → `.defaultBranch` (strip `refs/heads/` prefix)
2. Abandon all active PRs: `az repos pr list --status active` → for each, `az repos pr update --id <id> --status abandoned`
3. Delete all branches except default: `az repos ref list` → for each non-default, `az repos ref delete --name refs/heads/<branch> --object-id <oid>`
4. Reset default branch to README-only: use ADO pushes API (`POST _apis/git/repositories/<repo>/pushes?api-version=7.0`) with a commit that:
   - Gets current tree items via `GET _apis/git/repositories/<repo>/items?recursionLevel=full&api-version=7.0`
   - Creates one commit with `changeType: delete` for every file except README.md, plus `changeType: edit` (or `add`) for README.md with standard content

Important details from ADO API:

- `az repos ref delete` requires `--object-id` (the current commit SHA of that branch ref)
- The pushes API requires `refUpdates[].oldObjectId` to be the current tip of the branch
- Use `|| true` on each cleanup operation so the script doesn't abort if one item is already gone

**Step 2: Make it executable and test locally (manual)**

```bash
chmod +x .github/scripts/reset-test-repo-ado.sh
# Test locally if you have AZURE_DEVOPS_EXT_PAT set:
# AZURE_DEVOPS_EXT_PAT=<pat> .github/scripts/reset-test-repo-ado.sh https://dev.azure.com/aspruyt fxg fxg-test
```

Verify: script outputs step-by-step progress, exits 0 even on empty repo.

**Step 3: Commit**

```bash
git add .github/scripts/reset-test-repo-ado.sh
git commit -m "refactor(test): add ADO test repo reset script (#388, #391)"
```

---

### Task 2: Create GitLab reset script

**Files:**

- Create: `.github/scripts/reset-test-repo-gitlab.sh`
- Reference: `.github/scripts/reset-test-repo.sh` (GitHub version — follow same structure)
- Reference: `test/integration/gitlab.test.ts:39-190` (existing GitLab API helpers for patterns)

**Step 1: Write the reset script**

Create `.github/scripts/reset-test-repo-gitlab.sh`. It takes 1 arg: `<project-path>` (e.g., `anthony-spruyt1/xfg-test`).

Auth: reads `GITLAB_TOKEN` env var. Uses `glab api` for all API calls (same pattern as `glabApi()` in `gitlab.test.ts:40-56`). Note: `glab` uses `GITLAB_TOKEN` automatically when set.

Steps the script performs:

1. URL-encode the project path for API calls: `PROJECT_ID=$(printf '%s' "$PROJECT_PATH" | jq -sRr @uri)`
2. Auto-detect default branch via `GET projects/<id>` → `.default_branch`
3. Close all open MRs: `GET projects/<id>/merge_requests?state=opened` → for each, `PUT projects/<id>/merge_requests/<iid>` with body `state_event=close`
4. Delete all branches except default: `GET projects/<id>/repository/branches?per_page=100` → for each non-default, `DELETE projects/<id>/repository/branches/<url-encoded-name>`
5. Reset default branch to README-only:
   - List all files on default branch: `GET projects/<id>/repository/tree?ref=<default>&recursive=true&per_page=100`
   - Build a commit action payload: `delete` for every file except README.md, plus `update` (or `create`) for README.md
   - `POST projects/<id>/repository/commits` with the actions array, branch=default, commit_message="test: reset to clean state"

Important details from GitLab API:

- Branch names must be URL-encoded in path segments (e.g., `chore%2Fsync-config`)
- The repository commits API accepts an `actions` array for multi-file changes in one commit
- `glab api` passes `-f key=value` for form fields, or use `--input -` for JSON body
- Use `|| true` / `2>/dev/null` on each cleanup operation

**Step 2: Make it executable and test locally (manual)**

```bash
chmod +x .github/scripts/reset-test-repo-gitlab.sh
# Test locally if you have GITLAB_TOKEN set:
# GITLAB_TOKEN=<token> .github/scripts/reset-test-repo-gitlab.sh anthony-spruyt1/xfg-test
```

Verify: script outputs step-by-step progress, exits 0 even on empty repo.

**Step 3: Commit**

```bash
git add .github/scripts/reset-test-repo-gitlab.sh
git commit -m "refactor(test): add GitLab test repo reset script (#388, #391)"
```

---

### Task 3: Share `exec` and `projectRoot` in ADO tests (#388)

**Files:**

- Modify: `test/integration/ado.test.ts`
- Reference: `test/integration/test-helpers.ts` (the shared module)
- Reference: `test/integration/github.test.ts:1-9` (example of how GitHub imports)

**Step 1: Update imports**

In `ado.test.ts`, replace lines 1-11 (the imports, `__filename`, `__dirname`, `projectRoot`) and lines 22-38 (the duplicate `exec()` function) with:

```typescript
import { test, describe, before } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";
import { exec, projectRoot } from "./test-helpers.js";

const fixturesDir = join(projectRoot, "test", "fixtures");
```

Remove these imports that are no longer needed: `execSync` from `node:child_process`, `dirname` from `node:path`, `fileURLToPath` from `node:url`.

Keep `before` import from `node:test` for now (removed in Task 6). Keep `rmSync`/`existsSync` for now (removed in Task 6).

All platform-specific helpers (`adoApi`, `getFileContent`, `getDefaultBranch`, `pushFileChange`, `deleteBranch`) at lines 40-163 stay unchanged — they call the local `exec()` which now resolves to the shared import.

**Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: compiles without errors.

**Step 3: Commit**

```bash
git add test/integration/ado.test.ts
git commit -m "refactor(test): use shared exec helper in ADO tests (#388)"
```

---

### Task 4: Share `exec` and `projectRoot` in GitLab tests (#388)

**Files:**

- Modify: `test/integration/gitlab.test.ts`
- Reference: `test/integration/test-helpers.ts` (the shared module)

**Step 1: Update imports**

In `gitlab.test.ts`, replace lines 1-11 (the imports, `__filename`, `__dirname`, `projectRoot`) and lines 22-37 (the duplicate `exec()` function) with:

```typescript
import { test, describe, before } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";
import { exec, projectRoot } from "./test-helpers.js";

const fixturesDir = join(projectRoot, "test", "fixtures");
```

Remove: `execSync` from `node:child_process`, `dirname` from `node:path`, `fileURLToPath` from `node:url`.

Keep `before`, `rmSync`, `existsSync` for now (removed in Task 7).

All platform-specific helpers (`glabApi`, `getFileContent`, `getDefaultBranch`, `pushFileChange`, `deleteBranch`, `getMRByBranch`, `closeMR`, `getAllMRsByBranch`) at lines 39-190 stay unchanged.

**Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: compiles without errors.

**Step 3: Commit**

```bash
git add test/integration/gitlab.test.ts
git commit -m "refactor(test): use shared exec helper in GitLab tests (#388)"
```

---

### Task 5: Restructure GitHub tests — nuke before each, remove cleanup (#389, #391)

**Files:**

- Modify: `test/integration/github.test.ts`

This is the largest task. Every test gets restructured to: nuke, arrange, act, assert (no cleanup).

**Step 1: Remove `before()` hook and update imports**

Remove the `before` import from line 1 and the entire `before(() => { ... })` block at lines 26-117.

Update imports — remove `rmSync`, `existsSync` (no longer needed since we're not cleaning `tmp/` inline). The test file should import:

```typescript
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import {
  exec,
  projectRoot,
  waitForFileVisible as waitForFileVisibleBase,
} from "./test-helpers.js";
```

**Step 2: Add nuke helper constant**

After the existing constants (`TEST_REPO`, `TARGET_FILE`, `BRANCH_NAME`, `waitForFileVisible` wrapper), add:

```typescript
const RESET_SCRIPT = join(projectRoot, ".github/scripts/reset-test-repo.sh");

function resetTestRepo(): void {
  console.log("\n=== Resetting test repo to clean state ===\n");
  exec(`bash ${RESET_SCRIPT} ${TEST_REPO}`);
  console.log("\n=== Reset complete ===\n");
}
```

**Step 3: Restructure each test**

For every test, apply this pattern:

1. Add `resetTestRepo()` as the first line
2. Keep the arrange section (seed files, etc.) — but remove any "close existing PRs" / "delete branch" / "delete file" try/catch blocks at the start, since the nuke handles that
3. Keep the act section (run xfg) unchanged
4. Keep the assert section unchanged
5. Remove the cleanup section at the end (the try/catch blocks that delete files, close PRs, etc.)

Specific tests and what to remove:

**Test: "sync creates a PR"** (line 119)

- Add `resetTestRepo()` at start
- No other changes — this test had no inline cleanup

**Test: "re-sync closes existing PR"** (line 188)

- Add `resetTestRepo()` at start
- Remove the comment "This test relies on the previous test having created a PR"
- Add arrange phase: run xfg once to create the initial PR, then get/assert the PR number
- Keep act (run xfg again) and assert (old PR closed) unchanged

The restructured re-sync test arrange phase:

```typescript
resetTestRepo();

// Arrange — create initial PR by running xfg
const configPath = join(fixturesDir, "integration-test-config-github.yaml");
console.log("Creating initial PR...");
exec(`node dist/cli.js --config ${configPath}`, { cwd: projectRoot });

// Get the PR number
console.log("Getting current PR number...");
const prListBefore = exec(
  `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number --jq '.[0].number'`
);
const prNumberBefore = prListBefore ? parseInt(prListBefore, 10) : null;
console.log(`  Current PR: #${prNumberBefore}`);
assert.ok(prNumberBefore, "Expected a PR to exist after initial sync");
```

Then keep existing act + assert code.

**Test: "createOnly skips file"** (line 244)

- Add `resetTestRepo()` at start
- Remove lines 251-276 (close existing PRs, delete branch) — nuke handles it
- Keep lines 278-306 (create file on main) — this is test-specific arrange
- Keep act + assert
- Remove lines 358-370 (cleanup — delete test file from main)

**Test: "PR title only includes files that actually changed"** (line 375)

- Add `resetTestRepo()` at start
- Remove lines 388-413 (close existing PRs, delete branch)
- Keep lines 415-460 (create unchanged file, delete changed file) — test-specific arrange
- Keep act + assert
- Remove lines 496-517 (cleanup — delete test files)

**Test: "template feature interpolates"** (line 520)

- Add `resetTestRepo()` at start
- Remove lines 533-573 (close existing PRs, delete branch, delete template file)
- Keep act + assert
- Remove lines 686-694 (cleanup — close PR)

**Test: "direct mode pushes directly"** (line 698)

- Add `resetTestRepo()` at start
- Remove lines 710-722 (delete file if exists) — nuke handles it
- Keep act + assert
- Remove lines 761-773 (cleanup — delete test file)

**Test: "deleteOrphaned removes files"** (line 778)

- Add `resetTestRepo()` at start
- Remove lines 795-836 (close PRs, delete branch, delete test files)
- Keep phases 1 and 2 (run xfg with phase1 config, then phase2 config) — these are the act
- Keep asserts
- Remove lines 906-924 (cleanup — delete manifest and remaining file)

**Test: "handles divergent branch with PR"** (line 927)

- Add `resetTestRepo()` at start
- Remove lines 940-964 (close PRs, delete branch)
- Keep lines 966-984 (create divergent file on main) — test-specific arrange; simplify since nuke guarantees no file exists (always create, never update)
- Keep phases 2 and 3 (advance main, run xfg again)
- Keep asserts
- Remove lines 1043-1060 (cleanup)

**Test: "handles divergent branch without PR"** (line 1065)

- Add `resetTestRepo()` at start
- Remove lines 1080-1118 (close PRs, delete branch, delete file)
- Keep lines 1120-1154 (create orphan branch with file) — test-specific arrange
- Keep act + assert
- Remove lines 1197-1204 (cleanup)

**Step 4: Verify TypeScript compiles**

```bash
npm run build
```

Expected: compiles without errors. Unused imports for `before`, `rmSync`, `existsSync` should be gone.

**Step 5: Verify lint passes**

```bash
./lint.sh
```

Expected: no lint errors.

**Step 6: Commit**

```bash
git add test/integration/github.test.ts
git commit -m "refactor(test): nuke-before-each for GitHub integration tests (#389, #391)"
```

---

### Task 6: Restructure ADO tests — nuke before each, remove cleanup (#389, #391)

**Files:**

- Modify: `test/integration/ado.test.ts`

**Step 1: Remove `before()` hook and update imports**

Remove the `before` import from line 1 and the entire `before(() => { ... })` block at lines 166-268.

Remove `rmSync`, `existsSync` imports (no longer needed).

Updated imports:

```typescript
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { exec, projectRoot } from "./test-helpers.js";
```

**Step 2: Add nuke helper**

After the existing constants and platform helpers, add:

```typescript
const RESET_SCRIPT = join(
  projectRoot,
  ".github/scripts/reset-test-repo-ado.sh"
);

function resetTestRepo(): void {
  console.log("\n=== Resetting ADO test repo to clean state ===\n");
  exec(`bash ${RESET_SCRIPT} ${ORG_URL} ${TEST_PROJECT} ${TEST_REPO}`);
  console.log("\n=== Reset complete ===\n");
}
```

**Step 3: Restructure each test**

Same pattern as Task 5. For each test:

1. Add `resetTestRepo()` as first line
2. Remove inline setup that duplicates nuke (abandon PRs, delete branches)
3. Keep test-specific arrange (seed files)
4. Keep act + assert
5. Remove cleanup at end

**Test: "sync creates a PR"** (line 270)

- Add `resetTestRepo()` at start
- No other changes needed

**Test: "re-sync closes existing PR"** (line 339)

- Add `resetTestRepo()` at start
- Make self-contained: add arrange phase that runs xfg once to create initial PR (same pattern as GitHub re-sync in Task 5)
- Remove comment "This test relies on the previous test having created a PR"

**Test: "createOnly skips file"** (line 398)

- Add `resetTestRepo()` at start
- Remove lines 406-429 (abandon PRs, delete branch) — nuke handles it
- Keep lines 431-456 (create file on main) — test-specific arrange
- Keep act + assert
- Remove lines 507-523 (cleanup)

**Test: "PR title only includes files that actually changed"** (line 528)

- Add `resetTestRepo()` at start
- Remove lines 540-563 (abandon PRs, delete branch)
- Keep lines 565-610 (seed unchanged file, delete changed file) — test-specific arrange
- Keep act + assert
- Remove lines 643-668 (cleanup)

**Test: "direct mode pushes directly"** (line 671)

- Add `resetTestRepo()` at start
- Remove lines 682-698 (delete file) — nuke handles it
- Keep act + assert
- Remove lines 737-755 (cleanup)

**Step 4: Verify TypeScript compiles**

```bash
npm run build
```

**Step 5: Verify lint passes**

```bash
./lint.sh
```

**Step 6: Commit**

```bash
git add test/integration/ado.test.ts
git commit -m "refactor(test): nuke-before-each for ADO integration tests (#389, #391)"
```

---

### Task 7: Restructure GitLab tests — nuke before each, remove cleanup (#389, #391)

**Files:**

- Modify: `test/integration/gitlab.test.ts`

**Step 1: Remove `before()` hook and update imports**

Remove the `before` import from line 1 and the entire `before(() => { ... })` block at lines 193-274.

Remove `rmSync`, `existsSync` imports.

Updated imports:

```typescript
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { exec, projectRoot } from "./test-helpers.js";
```

**Step 2: Add nuke helper**

After the existing constants and platform helpers, add:

```typescript
const RESET_SCRIPT = join(
  projectRoot,
  ".github/scripts/reset-test-repo-gitlab.sh"
);

function resetTestRepo(): void {
  console.log("\n=== Resetting GitLab test repo to clean state ===\n");
  exec(`bash ${RESET_SCRIPT} ${PROJECT_PATH}`);
  console.log("\n=== Reset complete ===\n");
}
```

**Step 3: Restructure each test**

Same pattern. For each test:

1. Add `resetTestRepo()` as first line
2. Remove inline setup that duplicates nuke
3. Keep test-specific arrange
4. Keep act + assert
5. Remove cleanup

**Test: "sync creates a MR"** (line 276)

- Add `resetTestRepo()` at start
- No other changes

**Test: "re-sync closes existing MR"** (line 340)

- Add `resetTestRepo()` at start
- Make self-contained: add arrange phase that runs xfg once to create initial MR
- Remove comment about depending on previous test

**Test: "createOnly skips file"** (line 393)

- Add `resetTestRepo()` at start
- Remove lines 401-421 (close MRs, delete branch)
- Keep lines 423-435 (create file on main)
- Keep act + assert
- Remove lines 486-496 (cleanup)

**Test: "MR title only includes files that actually changed"** (line 501)

- Add `resetTestRepo()` at start
- Remove lines 513-533 (close MRs, delete branch)
- Keep lines 535-564 (seed files)
- Keep act + assert
- Remove lines 597-618 (cleanup)

**Test: "direct mode pushes directly"** (line 621)

- Add `resetTestRepo()` at start
- Remove lines 632-644 (delete file)
- Keep act + assert
- Remove lines 680-693 (cleanup)

**Step 4: Verify TypeScript compiles**

```bash
npm run build
```

**Step 5: Verify lint passes**

```bash
./lint.sh
```

**Step 6: Commit**

```bash
git add test/integration/gitlab.test.ts
git commit -m "refactor(test): nuke-before-each for GitLab integration tests (#389, #391)"
```

---

### Task 8: Add reset steps to CI workflow for ADO and GitLab

**Files:**

- Modify: `.github/workflows/ci.yaml`

**Step 1: Add reset steps to ADO job**

In the `integration-test-cli-sync-ado-pat` job (line 81), add a reset step before the test run and an `if: always()` reset step after. Insert between the "Configure git credential helper" step (line 112) and the "Run Azure DevOps integration tests" step (line 121):

```yaml
- name: Cleanup - reset ADO test repo
  env:
    AZURE_DEVOPS_EXT_PAT: ${{ secrets.AZURE_DEVOPS_EXT_PAT }}
  run: .github/scripts/reset-test-repo-ado.sh https://dev.azure.com/aspruyt fxg fxg-test
```

And after the test step, add:

```yaml
- name: Cleanup - reset ADO test repo
  if: always()
  env:
    AZURE_DEVOPS_EXT_PAT: ${{ secrets.AZURE_DEVOPS_EXT_PAT }}
  run: .github/scripts/reset-test-repo-ado.sh https://dev.azure.com/aspruyt fxg fxg-test
```

Note: the ADO job already has `az extension add --name azure-devops --yes` (line 110) before these steps, so the CLI extension is available.

**Step 2: Add reset steps to GitLab job**

In the `integration-test-cli-sync-gitlab-pat` job (line 126), add the same pattern. Insert between "Configure git credential helper" (line 159) and "Run GitLab integration tests" (line 167):

```yaml
- name: Cleanup - reset GitLab test repo
  env:
    GITLAB_TOKEN: ${{ secrets.GITLAB_TOKEN }}
  run: .github/scripts/reset-test-repo-gitlab.sh anthony-spruyt1/xfg-test
```

And after the test step:

```yaml
- name: Cleanup - reset GitLab test repo
  if: always()
  env:
    GITLAB_TOKEN: ${{ secrets.GITLAB_TOKEN }}
  run: .github/scripts/reset-test-repo-gitlab.sh anthony-spruyt1/xfg-test
```

**Step 3: Verify YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yaml'))"
```

Expected: no errors.

**Step 4: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor(ci): add reset scripts for ADO and GitLab integration tests (#391)"
```

---

### Task 9: Final verification

**Step 1: Build**

```bash
npm run build
```

Expected: compiles without errors.

**Step 2: Lint**

```bash
./lint.sh
```

Expected: no lint errors.

**Step 3: Unit tests**

```bash
npm test
```

Expected: all unit tests pass. Integration tests require platform credentials so they can't be run locally in most setups — they'll be verified by CI after merge.

**Step 4: Commit any lint fixes if needed**

If lint found issues, fix and commit.
