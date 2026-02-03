# Interface Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor classes to use interfaces and create mock factory infrastructure for better testability.

**Architecture:** Add interfaces to core classes (IGitOps, IRulesetStrategy, etc.), rename existing interfaces to use `I` prefix convention, then create `test/mocks/` directory with factory functions that replace 14+ mock class variants.

**Tech Stack:** TypeScript, Node.js test runner, existing patterns from `CommandExecutor` interface.

---

## Phase 1: Add New Interfaces

### Task 1: Add IGitOps Interface

**Files:**

- Modify: `src/git-ops.ts:1-35`

**Step 1: Add IGitOps interface before the class definition**

Add this interface after the imports and before `GitOpsOptions`:

```typescript
export interface IGitOps {
  cleanWorkspace(): void;
  clone(gitUrl: string): Promise<void>;
  fetch(options?: { prune?: boolean }): Promise<void>;
  createBranch(branchName: string): Promise<void>;
  commit(message: string): Promise<boolean>;
  push(branchName: string, options?: { force?: boolean }): Promise<void>;
  getDefaultBranch(): Promise<{ branch: string; method: string }>;
  writeFile(fileName: string, content: string): void;
  setExecutable(fileName: string): Promise<void>;
  getFileContent(fileName: string): string | null;
  deleteFile(fileName: string): void;
  wouldChange(fileName: string, content: string): boolean;
  hasChanges(): Promise<boolean>;
  getChangedFiles(): Promise<string[]>;
  hasStagedChanges(): Promise<boolean>;
  fileExistsOnBranch(fileName: string, branch: string): Promise<boolean>;
  fileExists(fileName: string): boolean;
}
```

**Step 2: Make GitOps class implement the interface**

Change line 23 from:

```typescript
export class GitOps {
```

to:

```typescript
export class GitOps implements IGitOps {
```

**Step 3: Build to verify**

Run: `npm run build`
Expected: SUCCESS (no errors)

**Step 4: Commit**

```bash
git add src/git-ops.ts
git commit -m "feat: add IGitOps interface"
```

---

### Task 2: Expand ILogger Interface

**Files:**

- Modify: `src/logger.ts:4-13`

**Step 1: Expand ILogger interface with all Logger class methods**

Replace the existing ILogger interface (lines 4-13) with:

```typescript
export interface ILogger {
  info(message: string): void;
  fileDiff(fileName: string, status: FileStatus, diffLines: string[]): void;
  diffSummary(
    newCount: number,
    modifiedCount: number,
    unchangedCount: number,
    deletedCount?: number
  ): void;
  setTotal(total: number): void;
  progress(current: number, repoName: string, message: string): void;
  success(current: number, repoName: string, message: string): void;
  skip(current: number, repoName: string, reason: string): void;
  error(current: number, repoName: string, error: string): void;
  summary(): void;
  hasFailures(): boolean;
}
```

**Step 2: Make Logger class implement ILogger**

Change line 22 from:

```typescript
export class Logger {
```

to:

```typescript
export class Logger implements ILogger {
```

**Step 3: Build to verify**

Run: `npm run build`
Expected: SUCCESS

**Step 4: Commit**

```bash
git add src/logger.ts
git commit -m "feat: expand ILogger interface with all Logger methods"
```

---

### Task 3: Add IRulesetStrategy Interface

**Files:**

- Create: `src/strategies/ruleset-strategy.ts`
- Modify: `src/strategies/github-ruleset-strategy.ts:195`

**Step 1: Create the new interface file**

Create `src/strategies/ruleset-strategy.ts`:

```typescript
import type { RepoInfo } from "../repo-detector.js";
import type { Ruleset } from "../config.js";
import type {
  GitHubRuleset,
  RulesetStrategyOptions,
} from "./github-ruleset-strategy.js";

export interface IRulesetStrategy {
  list(
    repoInfo: RepoInfo,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset[]>;
  get(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset>;
  create(
    repoInfo: RepoInfo,
    name: string,
    ruleset: Ruleset,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset>;
  update(
    repoInfo: RepoInfo,
    rulesetId: number,
    name: string,
    ruleset: Ruleset,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset>;
  delete(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: RulesetStrategyOptions
  ): Promise<void>;
}
```

**Step 2: Make GitHubRulesetStrategy implement IRulesetStrategy**

In `src/strategies/github-ruleset-strategy.ts`, add import at top:

```typescript
import type { IRulesetStrategy } from "./ruleset-strategy.js";
```

Change line 195 from:

```typescript
export class GitHubRulesetStrategy {
```

to:

```typescript
export class GitHubRulesetStrategy implements IRulesetStrategy {
```

**Step 3: Build to verify**

Run: `npm run build`
Expected: SUCCESS

**Step 4: Commit**

```bash
git add src/strategies/ruleset-strategy.ts src/strategies/github-ruleset-strategy.ts
git commit -m "feat: add IRulesetStrategy interface"
```

---

### Task 4: Add IRepositoryProcessor Interface

**Files:**

- Modify: `src/repository-processor.ts:1-50`

**Step 1: Add IRepositoryProcessor interface after the imports**

Add after the import statements (around line 25):

```typescript
export interface IRepositoryProcessor {
  process(
    config: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult>;
  updateManifestOnly(
    config: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult>;
}
```

**Step 2: Make RepositoryProcessor implement IRepositoryProcessor**

Find the class declaration and change from:

```typescript
export class RepositoryProcessor {
```

to:

```typescript
export class RepositoryProcessor implements IRepositoryProcessor {
```

**Step 3: Build to verify**

Run: `npm run build`
Expected: SUCCESS

**Step 4: Commit**

```bash
git add src/repository-processor.ts
git commit -m "feat: add IRepositoryProcessor interface"
```

---

### Task 5: Add IRulesetProcessor Interface

**Files:**

- Modify: `src/ruleset-processor.ts:1-30`

**Step 1: Add IRulesetProcessor interface after imports**

Add after the import statements:

```typescript
export interface IRulesetProcessor {
  process(options: RulesetProcessorOptions): Promise<RulesetProcessorResult>;
}
```

**Step 2: Make RulesetProcessor implement IRulesetProcessor**

Change the class declaration from:

```typescript
export class RulesetProcessor {
```

to:

```typescript
export class RulesetProcessor implements IRulesetProcessor {
```

**Step 3: Build to verify**

Run: `npm run build`
Expected: SUCCESS

**Step 4: Commit**

```bash
git add src/ruleset-processor.ts
git commit -m "feat: add IRulesetProcessor interface"
```

---

## Phase 2: Rename Existing Interfaces

### Task 6: Rename CommandExecutor to ICommandExecutor

**Files:**

- Modify: `src/command-executor.ts`
- Modify: All files importing `CommandExecutor`

**Step 1: Rename in source file**

In `src/command-executor.ts`, change:

```typescript
export interface CommandExecutor {
```

to:

```typescript
export interface ICommandExecutor {
```

Also update the class:

```typescript
export class ShellCommandExecutor implements ICommandExecutor {
```

And the defaultExecutor type annotation if present.

**Step 2: Find and replace all imports**

Run: `grep -r "CommandExecutor" src/ --include="*.ts" -l`

Update each file to use `ICommandExecutor` instead of `CommandExecutor`.

Files to update (update import and type annotations):

- `src/git-ops.ts`
- `src/authenticated-git-ops.ts`
- `src/repository-processor.ts`
- `src/strategies/pr-strategy.ts`
- `src/strategies/github-pr-strategy.ts`
- `src/strategies/azure-pr-strategy.ts`
- `src/strategies/gitlab-pr-strategy.ts`
- `src/strategies/git-commit-strategy.ts`
- `src/strategies/graphql-commit-strategy.ts`
- `src/strategies/github-ruleset-strategy.ts`

**Step 3: Build to verify all references updated**

Run: `npm run build`
Expected: SUCCESS

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename CommandExecutor to ICommandExecutor"
```

---

### Task 7: Rename PRStrategy to IPRStrategy

**Files:**

- Modify: `src/strategies/pr-strategy.ts`
- Modify: All files importing `PRStrategy`

**Step 1: Rename in source file**

In `src/strategies/pr-strategy.ts`, change:

```typescript
export interface PRStrategy {
```

to:

```typescript
export interface IPRStrategy {
```

Update `BasePRStrategy`:

```typescript
export abstract class BasePRStrategy implements IPRStrategy {
```

Update `PRWorkflowExecutor` constructor parameter type.

**Step 2: Update all imports**

Files to update:

- `src/strategies/github-pr-strategy.ts`
- `src/strategies/azure-pr-strategy.ts`
- `src/strategies/gitlab-pr-strategy.ts`
- `src/repository-processor.ts`
- Any test files using `PRStrategy`

**Step 3: Build to verify**

Run: `npm run build`
Expected: SUCCESS

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename PRStrategy to IPRStrategy"
```

---

### Task 8: Rename CommitStrategy to ICommitStrategy

**Files:**

- Modify: `src/strategies/commit-strategy.ts`
- Modify: All files importing `CommitStrategy`

**Step 1: Rename in source file**

In `src/strategies/commit-strategy.ts`, change:

```typescript
export interface CommitStrategy {
```

to:

```typescript
export interface ICommitStrategy {
```

**Step 2: Update implementing classes**

In `src/strategies/git-commit-strategy.ts`:

```typescript
export class GitCommitStrategy implements ICommitStrategy {
```

In `src/strategies/graphql-commit-strategy.ts`:

```typescript
export class GraphQLCommitStrategy implements ICommitStrategy {
```

**Step 3: Update all imports**

Files to update:

- `src/strategies/commit-strategy-selector.ts`
- `src/repository-processor.ts`
- Any test files

**Step 4: Build to verify**

Run: `npm run build`
Expected: SUCCESS

**Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename CommitStrategy to ICommitStrategy"
```

---

## Phase 3: Create Mock Infrastructure

### Task 9: Create Mock Types

**Files:**

- Create: `test/mocks/types.ts`

**Step 1: Create the types file**

Create `test/mocks/types.ts`:

```typescript
export interface MockCallTracker<T> {
  mock: T;
  calls: Record<string, Array<{ args: unknown[]; result?: unknown }>>;
  reset: () => void;
}
```

**Step 2: Commit**

```bash
git add test/mocks/types.ts
git commit -m "feat: add mock infrastructure types"
```

---

### Task 10: Create ICommandExecutor Mock Factory

**Files:**

- Create: `test/mocks/executor.mock.ts`

**Step 1: Create the mock factory**

Create `test/mocks/executor.mock.ts`:

```typescript
import type { ICommandExecutor } from "../../src/command-executor.js";

export interface ExecutorMockConfig {
  defaultResponse?: string;
  responses?: Map<string, string | Error>;
  trackCalls?: boolean;
}

export interface ExecutorMockResult {
  mock: ICommandExecutor;
  calls: Array<{ command: string; cwd: string }>;
  reset: () => void;
}

export function createMockExecutor(
  config: ExecutorMockConfig = {}
): ExecutorMockResult {
  const calls: Array<{ command: string; cwd: string }> = [];
  const responses = config.responses ?? new Map();
  const defaultResponse = config.defaultResponse ?? "";

  const mock: ICommandExecutor = {
    async exec(command: string, cwd: string): Promise<string> {
      calls.push({ command, cwd });

      // Check for matching response
      for (const [pattern, response] of responses) {
        if (command.includes(pattern)) {
          if (response instanceof Error) {
            throw response;
          }
          return response;
        }
      }

      return defaultResponse;
    },
  };

  return {
    mock,
    calls,
    reset: () => {
      calls.length = 0;
    },
  };
}
```

**Step 2: Commit**

```bash
git add test/mocks/executor.mock.ts
git commit -m "feat: add createMockExecutor factory"
```

---

### Task 11: Create ILogger Mock Factory

**Files:**

- Create: `test/mocks/logger.mock.ts`

**Step 1: Create the mock factory**

Create `test/mocks/logger.mock.ts`:

```typescript
import type { ILogger } from "../../src/logger.js";
import type { FileStatus } from "../../src/diff-utils.js";

export interface LoggerMockResult {
  mock: ILogger;
  messages: string[];
  reset: () => void;
}

export function createMockLogger(): LoggerMockResult {
  const messages: string[] = [];

  const mock: ILogger = {
    info(message: string): void {
      messages.push(message);
    },
    fileDiff(
      _fileName: string,
      _status: FileStatus,
      _diffLines: string[]
    ): void {
      // No-op
    },
    diffSummary(
      _newCount: number,
      _modifiedCount: number,
      _unchangedCount: number,
      _deletedCount?: number
    ): void {
      // No-op
    },
    setTotal(_total: number): void {
      // No-op
    },
    progress(_current: number, _repoName: string, _message: string): void {
      // No-op
    },
    success(_current: number, _repoName: string, _message: string): void {
      // No-op
    },
    skip(_current: number, _repoName: string, _reason: string): void {
      // No-op
    },
    error(_current: number, _repoName: string, _error: string): void {
      // No-op
    },
    summary(): void {
      // No-op
    },
    hasFailures(): boolean {
      return false;
    },
  };

  return {
    mock,
    messages,
    reset: () => {
      messages.length = 0;
    },
  };
}
```

**Step 2: Commit**

```bash
git add test/mocks/logger.mock.ts
git commit -m "feat: add createMockLogger factory"
```

---

### Task 12: Create IGitOps Mock Factory

**Files:**

- Create: `test/mocks/git-ops.mock.ts`

**Step 1: Create the mock factory**

Create `test/mocks/git-ops.mock.ts`:

```typescript
import type { IGitOps } from "../../src/git-ops.js";

export interface GitOpsMockConfig {
  // Return value overrides
  fileExists?: boolean | ((fileName: string) => boolean);
  fileContent?: string | null | ((fileName: string) => string | null);
  wouldChange?: boolean;
  hasChanges?: boolean;
  hasStagedChanges?: boolean;
  changedFiles?: string[];
  defaultBranch?: { branch: string; method: string };
  commitResult?: boolean;
  fileExistsOnBranch?:
    | boolean
    | ((fileName: string, branch: string) => boolean);

  // Error simulation
  cloneError?: Error;
  pushError?: Error;
  commitError?: Error;
  cleanupError?: Error;
}

export interface GitOpsMockCalls {
  clone: Array<{ gitUrl: string }>;
  fetch: Array<{ options?: { prune?: boolean } }>;
  createBranch: Array<{ branchName: string }>;
  commit: Array<{ message: string }>;
  push: Array<{ branchName: string; force?: boolean }>;
  writeFile: Array<{ fileName: string; content: string }>;
  deleteFile: Array<{ fileName: string }>;
  setExecutable: Array<{ fileName: string }>;
}

export interface GitOpsMockResult {
  mock: IGitOps;
  calls: GitOpsMockCalls;
  reset: () => void;
}

export function createMockGitOps(
  config: GitOpsMockConfig = {}
): GitOpsMockResult {
  const calls: GitOpsMockCalls = {
    clone: [],
    fetch: [],
    createBranch: [],
    commit: [],
    push: [],
    writeFile: [],
    deleteFile: [],
    setExecutable: [],
  };

  const mock: IGitOps = {
    cleanWorkspace(): void {
      if (config.cleanupError) {
        throw config.cleanupError;
      }
    },

    async clone(gitUrl: string): Promise<void> {
      calls.clone.push({ gitUrl });
      if (config.cloneError) {
        throw config.cloneError;
      }
    },

    async fetch(options?: { prune?: boolean }): Promise<void> {
      calls.fetch.push({ options });
    },

    async createBranch(branchName: string): Promise<void> {
      calls.createBranch.push({ branchName });
    },

    async commit(message: string): Promise<boolean> {
      calls.commit.push({ message });
      if (config.commitError) {
        throw config.commitError;
      }
      return config.commitResult ?? true;
    },

    async push(
      branchName: string,
      options?: { force?: boolean }
    ): Promise<void> {
      calls.push.push({ branchName, force: options?.force });
      if (config.pushError) {
        throw config.pushError;
      }
    },

    async getDefaultBranch(): Promise<{ branch: string; method: string }> {
      return config.defaultBranch ?? { branch: "main", method: "mock" };
    },

    writeFile(fileName: string, content: string): void {
      calls.writeFile.push({ fileName, content });
    },

    async setExecutable(fileName: string): Promise<void> {
      calls.setExecutable.push({ fileName });
    },

    getFileContent(fileName: string): string | null {
      if (typeof config.fileContent === "function") {
        return config.fileContent(fileName);
      }
      return config.fileContent ?? null;
    },

    deleteFile(fileName: string): void {
      calls.deleteFile.push({ fileName });
    },

    wouldChange(_fileName: string, _content: string): boolean {
      return config.wouldChange ?? true;
    },

    async hasChanges(): Promise<boolean> {
      return config.hasChanges ?? true;
    },

    async getChangedFiles(): Promise<string[]> {
      return config.changedFiles ?? [];
    },

    async hasStagedChanges(): Promise<boolean> {
      return config.hasStagedChanges ?? true;
    },

    async fileExistsOnBranch(
      fileName: string,
      branch: string
    ): Promise<boolean> {
      if (typeof config.fileExistsOnBranch === "function") {
        return config.fileExistsOnBranch(fileName, branch);
      }
      return config.fileExistsOnBranch ?? false;
    },

    fileExists(fileName: string): boolean {
      if (typeof config.fileExists === "function") {
        return config.fileExists(fileName);
      }
      return config.fileExists ?? false;
    },
  };

  return {
    mock,
    calls,
    reset: () => {
      calls.clone.length = 0;
      calls.fetch.length = 0;
      calls.createBranch.length = 0;
      calls.commit.length = 0;
      calls.push.length = 0;
      calls.writeFile.length = 0;
      calls.deleteFile.length = 0;
      calls.setExecutable.length = 0;
    },
  };
}
```

**Step 2: Commit**

```bash
git add test/mocks/git-ops.mock.ts
git commit -m "feat: add createMockGitOps factory"
```

---

### Task 13: Create Mock Index File

**Files:**

- Create: `test/mocks/index.ts`

**Step 1: Create the index file**

Create `test/mocks/index.ts`:

```typescript
export { createMockExecutor } from "./executor.mock.js";
export type {
  ExecutorMockConfig,
  ExecutorMockResult,
} from "./executor.mock.js";

export { createMockLogger } from "./logger.mock.js";
export type { LoggerMockResult } from "./logger.mock.js";

export { createMockGitOps } from "./git-ops.mock.js";
export type {
  GitOpsMockConfig,
  GitOpsMockCalls,
  GitOpsMockResult,
} from "./git-ops.mock.js";

export type { MockCallTracker } from "./types.js";
```

**Step 2: Build to verify**

Run: `npm run build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add test/mocks/index.ts
git commit -m "feat: add mock infrastructure index"
```

---

## Phase 4: Migrate Tests (Incremental)

### Task 14: Migrate repository-processor.test.ts - Part 1

**Files:**

- Modify: `src/repository-processor.test.ts`

**Step 1: Add import for mock factories**

Add at top of file:

```typescript
import { createMockGitOps, createMockLogger } from "../test/mocks/index.js";
```

**Step 2: Replace first MockGitOps usage**

Find the test "should correctly skip when existing file has identical content" and replace the mock setup.

Before:

```typescript
const mockFactory: GitOpsFactory = (opts, _auth) => {
  mockGitOps = new MockGitOps(opts);
  mockGitOps.setupFileExists(true, true);
  return new AuthenticatedGitOps(mockGitOps);
};
```

After:

```typescript
const { mock: mockGitOps } = createMockGitOps({
  fileExists: true,
  wouldChange: false,
  hasChanges: false,
});
const mockFactory: GitOpsFactory = (_opts, _auth) => {
  return { ...mockGitOps } as unknown as IAuthenticatedGitOps;
};
```

**Step 3: Run the specific test**

Run: `npm test -- --test-name-pattern="should correctly skip"`
Expected: PASS

**Step 4: Commit**

```bash
git add src/repository-processor.test.ts
git commit -m "refactor: migrate first test to use createMockGitOps"
```

---

### Task 15: Continue Test Migration

**Note:** This task involves migrating the remaining 13 MockGitOps variants. Each follows the same pattern as Task 14. Work through them incrementally:

1. `MockGitOps` → `createMockGitOps({ fileExists: false })`
2. `MockGitOpsNoStagedChanges` → `createMockGitOps({ hasStagedChanges: false, changedFiles: ["config.json"] })`
3. `MockGitOpsWithExecutable` → `createMockGitOps({})` + check `calls.setExecutable`
4. `MockGitOpsForDirectMode` → `createMockGitOps({})` or with `pushError`
5. `MockGitOpsForCreateOnly` → `createMockGitOps({ fileExistsOnBranch: true })`
6. `MockGitOpsForCreateOnlyDeletion` → `createMockGitOps({ fileExists: (f) => existingFiles.has(f) })`
7. `MockGitOpsForTemplate` → `createMockGitOps({})` + check `calls.writeFile`
8. Continue for remaining variants...

**After each migration:**

- Run: `npm test`
- Commit incrementally

---

## Phase 5: Cleanup

### Task 16: Remove Unused Mock Classes

**Files:**

- Modify: `src/repository-processor.test.ts`

**Step 1: Delete all MockGitOps class definitions**

After all tests are migrated, delete the following class definitions:

- `MockGitOps` (lines ~168-275)
- `MockGitOpsNoStagedChanges` (lines ~366-377)
- `MockGitOpsWithExecutable` (lines ~425-492)
- `MockGitOpsForDirectMode` (lines ~722-787)
- And all other `MockGitOps*` variants

**Step 2: Delete duplicate createMockLogger definitions**

Remove the 8+ `createMockLogger` function definitions scattered throughout the test file - use the imported one instead.

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Run lint**

Run: `./lint.sh`
Expected: No errors

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove deprecated mock classes"
```

---

## Verification Checklist

After completing all tasks:

1. `npm run build` - No TypeScript errors
2. `npm test` - All unit tests pass
3. `./lint.sh` - No linting errors
4. Verify no `as unknown as { workDir: string }` patterns remain in test file
5. Verify all interfaces follow `I` prefix convention
