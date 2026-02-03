# Test Directory Reorganization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all test-related files under `test/` for consistent organization.

**Architecture:** Move `fixtures/` to `test/fixtures/`, move 33 unit tests from `src/` to `test/unit/`, update all import paths and config references.

**Tech Stack:** TypeScript, Node.js test runner, git

---

### Task 1: Create Directory Structure

**Files:**

- Create: `test/unit/`
- Create: `test/unit/strategies/`

**Step 1: Create directories**

```bash
mkdir -p test/unit/strategies
```

**Step 2: Verify directories exist**

Run: `ls -la test/`
Expected: See `unit/` directory alongside `integration/` and `mocks/`

---

### Task 2: Move Fixtures Directory

**Files:**

- Move: `fixtures/` → `test/fixtures/`

**Step 1: Move fixtures with git**

```bash
git mv fixtures test/fixtures
```

**Step 2: Verify move**

Run: `ls test/fixtures/`
Expected: See `expected/`, `templates/`, yaml files, `test-fixtures.ts`

---

### Task 3: Move Root-Level Unit Tests

**Files:**

- Move: `src/*.test.ts` → `test/unit/`

**Step 1: Move all root-level test files**

```bash
git mv src/authenticated-git-ops.test.ts test/unit/
git mv src/command-executor.test.ts test/unit/
git mv src/config-formatter.test.ts test/unit/
git mv src/config-normalizer.test.ts test/unit/
git mv src/config.test.ts test/unit/
git mv src/config-validator.test.ts test/unit/
git mv src/diff-utils.test.ts test/unit/
git mv src/env.test.ts test/unit/
git mv src/file-reference-resolver.test.ts test/unit/
git mv src/github-app-token-manager.test.ts test/unit/
git mv src/github-summary.test.ts test/unit/
git mv src/git-ops.test.ts test/unit/
git mv src/index.test.ts test/unit/
git mv src/logger.test.ts test/unit/
git mv src/manifest.test.ts test/unit/
git mv src/merge.test.ts test/unit/
git mv src/pr-creator.test.ts test/unit/
git mv src/repo-detector.test.ts test/unit/
git mv src/repository-processor.test.ts test/unit/
git mv src/retry-utils.test.ts test/unit/
git mv src/ruleset-diff.test.ts test/unit/
git mv src/ruleset-processor.test.ts test/unit/
git mv src/shell-utils.test.ts test/unit/
git mv src/workspace-utils.test.ts test/unit/
git mv src/xfg-template.test.ts test/unit/
```

**Step 2: Verify move**

Run: `ls test/unit/*.test.ts | wc -l`
Expected: 25 files

---

### Task 4: Move Strategy Unit Tests

**Files:**

- Move: `src/strategies/*.test.ts` → `test/unit/strategies/`

**Step 1: Move strategy test files**

```bash
git mv src/strategies/azure-pr-strategy.test.ts test/unit/strategies/
git mv src/strategies/commit-strategy-selector.test.ts test/unit/strategies/
git mv src/strategies/git-commit-strategy.test.ts test/unit/strategies/
git mv src/strategies/github-pr-strategy.test.ts test/unit/strategies/
git mv src/strategies/github-ruleset-strategy.test.ts test/unit/strategies/
git mv src/strategies/gitlab-pr-strategy.test.ts test/unit/strategies/
git mv src/strategies/graphql-commit-strategy.test.ts test/unit/strategies/
git mv src/strategies/pr-strategy.test.ts test/unit/strategies/
```

**Step 2: Verify move**

Run: `ls test/unit/strategies/*.test.ts | wc -l`
Expected: 8 files

---

### Task 5: Update Test Runner Script

**Files:**

- Modify: `scripts/run-tests.js`

**Step 1: Update glob pattern**

Change line 14 from:

```javascript
const testFiles = globSync("src/**/*.test.ts", { windowsPathsNoEscape: true });
```

To:

```javascript
const testFiles = globSync("test/unit/**/*.test.ts", {
  windowsPathsNoEscape: true,
});
```

**Step 2: Update comment on line 13**

Change from:

```javascript
// Find all test files in src/ directory (excluding integration tests in test/)
```

To:

```javascript
// Find all unit test files in test/unit/ directory
```

---

### Task 6: Update package.json Coverage Config

**Files:**

- Modify: `package.json`

**Step 1: Update c8 exclude pattern**

Change line 30 from:

```json
"test:coverage": "c8 --check-coverage --lines 95 --reporter=text --reporter=lcov --all --src=src --exclude='src/**/*.test.ts' --exclude='scripts/**' npm test",
```

To:

```json
"test:coverage": "c8 --check-coverage --lines 95 --reporter=text --reporter=lcov --all --src=src --exclude='test/**/*.test.ts' --exclude='scripts/**' npm test",
```

---

### Task 7: Update .gitleaks.toml

**Files:**

- Modify: `.gitleaks.toml`

**Step 1: Update path pattern**

Change line 13 from:

```toml
'''fixtures/test-fixtures\.ts$''',
```

To:

```toml
'''test/fixtures/test-fixtures\.ts$''',
```

---

### Task 8: Update .mega-linter.yml

**Files:**

- Modify: `.mega-linter.yml`

**Step 1: Update filter regex**

Change line 27 from:

```yaml
JSON_JSONLINT_FILTER_REGEX_EXCLUDE: "fixtures/templates/invalid\\.json"
```

To:

```yaml
JSON_JSONLINT_FILTER_REGEX_EXCLUDE: "test/fixtures/templates/invalid\\.json"
```

---

### Task 9: Update .prettierignore

**Files:**

- Modify: `.prettierignore`

**Step 1: Update path**

Change line 1 from:

```
fixtures/templates/invalid.json
```

To:

```
test/fixtures/templates/invalid.json
```

---

### Task 10: Update CI Workflow

**Files:**

- Modify: `.github/workflows/ci.yaml`

**Step 1: Update all fixture paths**

Change all occurrences of `./fixtures/` to `./test/fixtures/`:

- Line 306: `config: ./fixtures/integration-test-action-github.yaml` → `config: ./test/fixtures/integration-test-action-github.yaml`
- Line 367: `config: ./fixtures/integration-test-action-github.yaml` → `config: ./test/fixtures/integration-test-action-github.yaml`
- Line 425: `config: ./fixtures/integration-test-config-github-settings.yaml` → `config: ./test/fixtures/integration-test-config-github-settings.yaml`

---

### Task 11: Update Root-Level Test Imports

**Files:**

- Modify: All 25 files in `test/unit/*.test.ts`

**Step 1: Update imports in each file**

For each test file, change relative imports from `./module.js` to `../../src/module.js`.

Example for `test/unit/config.test.ts`:

- `"./config.js"` → `"../../src/config.js"`

Example for `test/unit/repository-processor.test.ts`:

- `"./repository-processor.js"` → `"../../src/repository-processor.js"`
- `"../fixtures/test-fixtures.js"` → `"../fixtures/test-fixtures.js"` (no change - already correct relative to new location)

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 12: Update Strategy Test Imports

**Files:**

- Modify: All 8 files in `test/unit/strategies/*.test.ts`

**Step 1: Update imports in each strategy test file**

For each test file, change relative imports:

- `"./module.js"` → `"../../../src/strategies/module.js"`
- `"../module.js"` → `"../../../src/module.js"`

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 13: Run Tests and Lint

**Step 1: Run unit tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run linter**

Run: `./lint.sh`
Expected: No errors

---

### Task 14: Commit Changes

**Step 1: Stage all changes**

```bash
git add -A
```

**Step 2: Create commit**

```bash
git commit -m "refactor: reorganize test files under test/ directory

- Move fixtures/ to test/fixtures/
- Move 33 unit tests from src/ to test/unit/
- Update import paths and config references
- Maintains same test behavior with cleaner organization"
```
