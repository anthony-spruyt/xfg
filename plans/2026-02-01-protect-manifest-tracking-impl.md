# Protect Manifest Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable `deleteOrphaned` for protect command by persisting ruleset tracking to `.xfg.json` manifest.

**Architecture:** Add `updateManifestOnly()` method to `RepositoryProcessor` that clones repo, updates manifest with tracked rulesets, and commits via existing PR workflow. The protect command calls this after successful ruleset processing.

**Tech Stack:** TypeScript, Node.js, existing git-ops/pr-creator modules

---

### Task 1: Add unit tests for updateManifestOnly method

**Files:**

- Modify: `src/repository-processor.test.ts`

**Step 1: Write failing test for basic manifest update**

Add this test in the `RepositoryProcessor` describe block:

```typescript
describe("updateManifestOnly", () => {
  test("updates manifest with rulesets and commits", async () => {
    const mockLogger = createMockLogger();
    const mockGitOps = new MockGitOps({ workDir: "/tmp/test", dryRun: false });
    const processor = new RepositoryProcessor(() => mockGitOps, mockLogger);

    const repoInfo: RepoInfo = {
      type: "github",
      owner: "test-owner",
      repo: "test-repo",
      host: "github.com",
      gitUrl: "git@github.com:test-owner/test-repo.git",
    };

    const repoConfig: RepoConfig = {
      git: "git@github.com:test-owner/test-repo.git",
      files: [],
      prOptions: { merge: "direct" },
    };

    const options: ProcessorOptions = {
      branchName: "chore/sync-config",
      workDir: "/tmp/test",
      configId: "test-config",
      dryRun: false,
    };

    const manifestUpdate = { rulesets: ["pr-rules", "release-rules"] };

    const result = await processor.updateManifestOnly(
      repoInfo,
      repoConfig,
      options,
      manifestUpdate
    );

    assert.equal(result.success, true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A 5 "updateManifestOnly"`
Expected: FAIL with "updateManifestOnly is not a function"

**Step 3: Commit test**

```bash
git add src/repository-processor.test.ts
git commit -m "test: add failing test for updateManifestOnly"
```

---

### Task 2: Implement updateManifestOnly method skeleton

**Files:**

- Modify: `src/repository-processor.ts`

**Step 1: Add method signature after the process() method (around line 595)**

```typescript
/**
 * Updates only the manifest file with ruleset tracking.
 * Used by protect command to persist state for deleteOrphaned.
 * Reuses existing clone/commit/PR workflow.
 */
async updateManifestOnly(
  repoInfo: RepoInfo,
  repoConfig: RepoConfig,
  options: ProcessorOptions,
  manifestUpdate: { rulesets: string[] }
): Promise<ProcessorResult> {
  const repoName = getRepoDisplayName(repoInfo);

  // TODO: Implement
  return {
    success: true,
    repoName,
    message: "Manifest update not yet implemented",
    skipped: true,
  };
}
```

**Step 2: Run test to verify it passes (skeleton)**

Run: `npm test 2>&1 | grep -E "(pass|fail) [0-9]+" | tail -1`
Expected: Tests pass (skeleton returns success)

**Step 3: Commit skeleton**

```bash
git add src/repository-processor.ts
git commit -m "feat: add updateManifestOnly method skeleton"
```

---

### Task 3: Implement clone and manifest loading

**Files:**

- Modify: `src/repository-processor.ts`

**Step 1: Add updateManifestRulesets import**

Ensure this import exists at top of file:

```typescript
import {
  loadManifest,
  saveManifest,
  updateManifest,
  updateManifestRulesets,
  MANIFEST_FILENAME,
} from "./manifest.js";
```

**Step 2: Implement clone and load logic in updateManifestOnly**

Replace the TODO implementation with the full method. See design doc for complete implementation.

**Step 3: Run tests**

Run: `npm test 2>&1 | grep -E "(pass|fail) [0-9]+" | tail -1`
Expected: Tests pass

**Step 4: Commit**

```bash
git add src/repository-processor.ts
git commit -m "feat: implement clone and manifest loading in updateManifestOnly"
```

---

### Task 4: Implement commit and PR workflow

**Files:**

- Modify: `src/repository-processor.ts`

**Step 1: Add commit/PR logic after manifest change detection**

Add branching, commit via strategy, PR creation, and merge handling - reusing existing patterns from process() method.

**Step 2: Run tests**

Run: `npm test 2>&1 | grep -E "(pass|fail) [0-9]+" | tail -1`
Expected: Tests pass

**Step 3: Commit**

```bash
git add src/repository-processor.ts
git commit -m "feat: implement commit and PR workflow in updateManifestOnly"
```

---

### Task 5: Integrate with protect command in index.ts

**Files:**

- Modify: `src/index.ts`

**Step 1: Add RepositoryProcessor import and instance**

**Step 2: Update protect loop to call updateManifestOnly after successful ruleset processing**

**Step 3: Build and verify**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "(pass|fail) [0-9]+" | tail -1`
Expected: Tests pass

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: integrate updateManifestOnly with protect command"
```

---

### Task 6: Add comprehensive unit tests

**Files:**

- Modify: `src/repository-processor.test.ts`

**Step 1: Add tests for dry-run mode and no-changes scenario**

**Step 2: Run tests**

Run: `npm test 2>&1 | grep -E "(pass|fail) [0-9]+" | tail -1`
Expected: Tests pass

**Step 3: Commit**

```bash
git add src/repository-processor.test.ts
git commit -m "test: add comprehensive tests for updateManifestOnly"
```

---

### Task 7: Run full validation

**Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -10`
Expected: All tests pass

**Step 2: Run linter**

Run: `./lint.sh 2>&1 | tail -20`
Expected: No errors

**Step 3: Build**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

---

### Task 8: Create PR

**Step 1: Push branch and create PR**

```bash
git push -u origin feat/protect-manifest-tracking
gh pr create --title "feat: add manifest tracking for protect command deleteOrphaned" --body "## Summary
- Adds updateManifestOnly() method to RepositoryProcessor
- Protect command now persists ruleset tracking to .xfg.json
- Enables deleteOrphaned to work for rulesets
- Honors prOptions.merge strategy (direct, pr, auto, force)

## Test plan
- [ ] Unit tests pass
- [ ] Lint passes
- [ ] Manual test: run protect with deleteOrphaned, verify manifest updated"
```

**Step 2: Enable auto-merge**

```bash
gh pr merge --auto --squash --delete-branch
```
