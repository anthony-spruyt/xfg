# Complete Test Mock Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete migration of remaining repository-processor.test.ts mock classes to factory pattern

**Architecture:** Replace 3 remaining class-based mocks (MockGitOpsForCommitStrategy, MockGitOpsForDiffStats, MockGitOps) with createMockAuthenticatedGitOps and createMockLogger factories from test/mocks/. Each test using these mocks will be updated to use factory configuration instead of class instantiation.

**Tech Stack:** TypeScript, Node.js test runner, test/mocks/authenticated-git-ops.mock.ts, test/mocks/logger.mock.ts

---

### Task 1: Migrate CommitStrategy Local Logger

**Files:**

- Modify: `src/repository-processor.test.ts:1692-1708`

**Step 1: Read the local createMockLogger definition**

Run: `sed -n '1692,1708p' src/repository-processor.test.ts`

**Step 2: Replace with imported factory**

Find this code block starting around line 1692:

```typescript
const createMockLogger = (): ILogger & { messages: string[] } => ({
  messages: [] as string[],
  info(message: string) {
    this.messages.push(message);
  },
  fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
    // No-op for mock
  },
  diffSummary(
    _newCount: number,
    _modifiedCount: number,
    _unchangedCount: number
  ) {
    // No-op for mock
  },
});
```

Delete it entirely - tests will use the imported `createMockLogger` from `../test/mocks/index.js`.

**Step 3: Run tests to verify they still pass**

Run: `npm test`
Expected: 1379 tests pass

**Step 4: Commit**

```bash
git add src/repository-processor.test.ts
git commit -m "refactor(test): remove CommitStrategy local createMockLogger"
```

---

### Task 2: Migrate First CommitStrategy Test

**Files:**

- Modify: `src/repository-processor.test.ts` - test "should use GraphQL commit strategy when GitHub App credentials are set"

**Step 1: Find the test**

Run: `grep -n "should use GraphQL commit strategy" src/repository-processor.test.ts`

**Step 2: Replace MockGitOpsForCommitStrategy with factory**

Change from:

```typescript
const mockLogger = createMockLogger();
let mockGitOps: MockGitOpsForCommitStrategy | null = null;

const mockFactory: GitOpsFactory = (opts, _auth) => {
  mockGitOps = new MockGitOpsForCommitStrategy(opts);
  return mockGitOps;
};
```

To:

```typescript
const { mock: mockLogger } = createMockLogger();
const { mock: mockGitOps } = createMockAuthenticatedGitOps({
  fileExists: false,
  wouldChange: true,
  hasChanges: true,
  fileExistsOnBranch: false,
});
const mockFactory: GitOpsFactory = () => mockGitOps;
```

**Step 3: Add directory creation before processor.process()**

Add this line before the `await processor.process(...)` call:

```typescript
mkdirSync(localWorkDir, { recursive: true });
```

**Step 4: Run tests**

Run: `npm test`
Expected: 1379 tests pass

**Step 5: Commit**

```bash
git add src/repository-processor.test.ts
git commit -m "refactor(test): migrate first CommitStrategy test to factory"
```

---

### Task 3: Migrate Remaining CommitStrategy Tests

**Files:**

- Modify: `src/repository-processor.test.ts` - remaining tests in CommitStrategy section

**Step 1: List remaining tests using MockGitOpsForCommitStrategy**

Run: `grep -n "MockGitOpsForCommitStrategy" src/repository-processor.test.ts`

**Step 2: For each test, apply the same pattern**

Replace MockGitOpsForCommitStrategy instantiation with:

```typescript
const { mock: mockGitOps } = createMockAuthenticatedGitOps({
  fileExists: false,
  wouldChange: true,
  hasChanges: true,
  fileExistsOnBranch: false,
});
const mockFactory: GitOpsFactory = () => mockGitOps;
```

Add `mkdirSync(localWorkDir, { recursive: true });` before processor.process().

**Step 3: Run tests after each migration**

Run: `npm test`
Expected: 1379 tests pass

**Step 4: Remove MockGitOpsForCommitStrategy class definition**

Delete lines ~1710-1782 containing the class definition.

**Step 5: Run tests**

Run: `npm test`
Expected: 1379 tests pass

**Step 6: Commit**

```bash
git add src/repository-processor.test.ts
git commit -m "refactor(test): migrate all CommitStrategy tests to factory"
```

---

### Task 4: Migrate DiffStats Local Logger

**Files:**

- Modify: `src/repository-processor.test.ts` - DiffStats section around line 2167

**Step 1: Find and remove local createMockLogger**

Run: `sed -n '2160,2200p' src/repository-processor.test.ts`

Delete the local createMockLogger definition in the DiffStats describe block.

**Step 2: Run tests**

Run: `npm test`
Expected: 1379 tests pass

**Step 3: Commit**

```bash
git add src/repository-processor.test.ts
git commit -m "refactor(test): remove DiffStats local createMockLogger"
```

---

### Task 5: Migrate DiffStats Tests

**Files:**

- Modify: `src/repository-processor.test.ts` - tests using MockGitOpsForDiffStats

**Step 1: List tests using MockGitOpsForDiffStats**

Run: `grep -n "MockGitOpsForDiffStats" src/repository-processor.test.ts`

**Step 2: Migrate each test**

Replace MockGitOpsForDiffStats with createMockAuthenticatedGitOps factory.
Add directory creation before processor.process().

**Step 3: Remove MockGitOpsForDiffStats class**

Delete the class definition after all tests migrated.

**Step 4: Run tests**

Run: `npm test`
Expected: 1379 tests pass

**Step 5: Commit**

```bash
git add src/repository-processor.test.ts
git commit -m "refactor(test): migrate DiffStats tests to factory"
```

---

### Task 6: Migrate Remaining MockGitOps Tests

**Files:**

- Modify: `src/repository-processor.test.ts` - tests using MockGitOps (around line 2993+)

**Step 1: Find local createMockLogger and MockGitOps usage**

Run: `grep -n "class MockGitOps extends" src/repository-processor.test.ts`

**Step 2: Remove local createMockLogger**

**Step 3: Migrate tests to use factory**

**Step 4: Remove MockGitOps class definition**

**Step 5: Run tests**

Run: `npm test`
Expected: 1379 tests pass

**Step 6: Commit**

```bash
git add src/repository-processor.test.ts
git commit -m "refactor(test): migrate remaining tests to factory"
```

---

### Task 7: Final Cleanup and Verification

**Step 1: Verify no mock classes remain**

Run: `grep -n "class Mock.*extends GitOps" src/repository-processor.test.ts`
Expected: No output

**Step 2: Verify no local createMockLogger remain**

Run: `grep -n "const createMockLogger" src/repository-processor.test.ts`
Expected: No output

**Step 3: Run full test suite**

Run: `npm test`
Expected: 1379 tests pass

**Step 4: Run linter**

Run: `./lint.sh`
Expected: No errors

**Step 5: Commit if any fixes needed**

---

### Task 8: Complete the Branch

**Step 1: Use finishing-a-development-branch skill**

Verify tests pass and present merge/PR options.

---

## Notes

- Branch: `feature/interface-refactoring` (continue from existing work)
- Mock factories location: `test/mocks/index.ts`
- Key factory configs: `fileExists`, `wouldChange`, `hasChanges`, `fileExistsOnBranch` (all support functions)
- Tests need `mkdirSync(localWorkDir, { recursive: true })` since mock cleanWorkspace is no-op
- Previous session already migrated 32 tests, removing 668 net lines
