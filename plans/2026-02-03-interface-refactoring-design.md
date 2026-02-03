# Interface Refactoring Design

## Overview

Refactor classes to use interfaces for better testability and composition. Add comprehensive interface coverage and create reusable mock factories to eliminate repetitive mock class definitions.

## Problem Statement

- **GitOps class** has 14+ mock variants in `repository-processor.test.ts`
- Tests use `as unknown as { workDir: string }` to access private properties (15+ instances)
- Duplicate `createMockLogger()` definitions appear 8+ times across test files
- Inconsistent interface naming (some have `I` prefix, some don't)
- Classes like `GitOps`, `GitHubRulesetStrategy` lack interfaces entirely

## Interface Additions

### New Interfaces

| Class                   | New Interface          | Location                                   |
| ----------------------- | ---------------------- | ------------------------------------------ |
| `GitOps`                | `IGitOps`              | `src/git-ops.ts`                           |
| `GitHubRulesetStrategy` | `IRulesetStrategy`     | `src/strategies/ruleset-strategy.ts` (new) |
| `RepositoryProcessor`   | `IRepositoryProcessor` | `src/repository-processor.ts`              |
| `RulesetProcessor`      | `IRulesetProcessor`    | `src/ruleset-processor.ts`                 |

### Interface Renames (for consistency)

| Current Name      | New Name           | File                                |
| ----------------- | ------------------ | ----------------------------------- |
| `CommandExecutor` | `ICommandExecutor` | `src/command-executor.ts`           |
| `PRStrategy`      | `IPRStrategy`      | `src/strategies/pr-strategy.ts`     |
| `CommitStrategy`  | `ICommitStrategy`  | `src/strategies/commit-strategy.ts` |

### Expand Existing

`ILogger` in `src/logger.ts` - add missing methods:

```typescript
export interface ILogger {
  // Existing
  info(message: string): void;
  fileDiff(fileName: string, status: FileStatus, diffLines: string[]): void;
  diffSummary(
    newCount: number,
    modifiedCount: number,
    unchangedCount: number,
    deletedCount?: number
  ): void;

  // Add these
  setTotal(total: number): void;
  progress(current: number, repoName: string, message: string): void;
  success(current: number, repoName: string, message: string): void;
  skip(current: number, repoName: string, reason: string): void;
  error(current: number, repoName: string, error: string): void;
  summary(): void;
  hasFailures(): boolean;
}
```

## IGitOps Interface

```typescript
export interface IGitOps {
  // Workspace management
  cleanWorkspace(): void;

  // Git operations
  clone(gitUrl: string): Promise<void>;
  fetch(options?: { prune?: boolean }): Promise<void>;
  createBranch(branchName: string): Promise<void>;
  commit(message: string): Promise<boolean>;
  push(branchName: string, options?: { force?: boolean }): Promise<void>;
  getDefaultBranch(): Promise<{ branch: string; method: string }>;

  // File operations
  writeFile(fileName: string, content: string): void;
  setExecutable(fileName: string): Promise<void>;
  getFileContent(fileName: string): string | null;
  deleteFile(fileName: string): void;

  // Query operations
  wouldChange(fileName: string, content: string): boolean;
  hasChanges(): Promise<boolean>;
  getChangedFiles(): Promise<string[]>;
  hasStagedChanges(): Promise<boolean>;
  fileExistsOnBranch(fileName: string, branch: string): Promise<boolean>;
  fileExists(fileName: string): boolean;
}
```

## Mock Factory Infrastructure

### Directory Structure

```
test/
  mocks/
    index.ts              # Re-exports everything
    types.ts              # Shared mock types
    git-ops.mock.ts       # createMockGitOps()
    logger.mock.ts        # createMockLogger()
    executor.mock.ts      # createMockExecutor()
    strategies.mock.ts    # createMockPRStrategy(), createMockCommitStrategy()
    ruleset.mock.ts       # createMockRulesetStrategy()
```

### GitOps Mock Factory

```typescript
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

  // Behavior flags
  trackCalls?: boolean; // Default: true
}

export interface GitOpsMockResult {
  mock: IGitOps;
  calls: {
    clone: Array<{ gitUrl: string }>;
    push: Array<{ branch: string; force?: boolean }>;
    commit: Array<{ message: string }>;
    writeFile: Array<{ fileName: string; content: string }>;
    deleteFile: Array<{ fileName: string }>;
    setExecutable: Array<{ fileName: string }>;
    createBranch: Array<{ branchName: string }>;
  };
  reset: () => void;
}

export function createMockGitOps(
  config: GitOpsMockConfig = {}
): GitOpsMockResult;
```

### Mock Class Replacement Map

| Old Mock Class                    | New Factory Config                                                        |
| --------------------------------- | ------------------------------------------------------------------------- |
| `MockGitOps`                      | `createMockGitOps({ fileExists: false })`                                 |
| `MockGitOpsNoStagedChanges`       | `createMockGitOps({ hasStagedChanges: false, changedFiles: ["x.json"] })` |
| `MockGitOpsWithExecutable`        | `createMockGitOps({})` + check `calls.setExecutable`                      |
| `MockGitOpsForDirectMode`         | `createMockGitOps({ pushError: new Error("rejected") })`                  |
| `MockGitOpsForCreateOnly`         | `createMockGitOps({ fileExistsOnBranch: true })`                          |
| `MockGitOpsForCreateOnlyDeletion` | `createMockGitOps({ fileExists: (f) => files.has(f) })`                   |
| `MockGitOpsForTemplate`           | `createMockGitOps({})` + check `calls.writeFile`                          |
| `MockGitOpsForCommit`             | `createMockGitOps({ commitResult: true })`                                |
| `MockGitOpsWithCleanupError`      | `createMockGitOps({ cleanupError: new Error(...) })`                      |
| `MockGitOpsForDeletion`           | `createMockGitOps({ fileExists: (f) => files.has(f) })`                   |
| `MockGitOpsForFileCount`          | `createMockGitOps({ changedFiles: [...] })`                               |
| `MockGitOpsForCommitStrategy`     | `createMockGitOps({})`                                                    |
| `MockGitOpsForDiffStats`          | `createMockGitOps({})`                                                    |
| `MockGitOpsForPR`                 | `createMockGitOps({})`                                                    |

## Migration Strategy

### Phase 1: Add interfaces (non-breaking)

1. Add `IGitOps` interface to `src/git-ops.ts`
2. Expand `ILogger` in `src/logger.ts`
3. Add `IRulesetStrategy` to `src/strategies/ruleset-strategy.ts` (new file)
4. Add `IRepositoryProcessor` to `src/repository-processor.ts`
5. Add `IRulesetProcessor` to `src/ruleset-processor.ts`
6. Make classes implement their interfaces

### Phase 2: Rename existing interfaces

| Find              | Replace            | Files Affected |
| ----------------- | ------------------ | -------------- |
| `CommandExecutor` | `ICommandExecutor` | ~15 files      |
| `PRStrategy`      | `IPRStrategy`      | ~8 files       |
| `CommitStrategy`  | `ICommitStrategy`  | ~6 files       |

Run `npm run build` after each rename to catch missed references.

### Phase 3: Create mock infrastructure

1. Create `test/mocks/` directory structure
2. Implement `createMockGitOps()` factory
3. Implement `createMockLogger()` factory
4. Implement `createMockExecutor()` (consolidate existing)
5. Export all from `test/mocks/index.ts`

### Phase 4: Migrate tests incrementally

**Migration order (by impact):**

1. `repository-processor.test.ts` - 14 mock classes → 1 factory
2. `authenticated-git-ops.test.ts` - inline mocks → factory
3. `github-pr-strategy.test.ts` - custom executor → shared factory
4. `github-ruleset-strategy.test.ts` - MockExecutor class → factory
5. Remaining test files

### Phase 5: Cleanup

- Delete all `MockGitOps*` class variants
- Remove duplicate `createMockLogger()` definitions (8 copies → 1)
- Remove duplicate `createMockExecutor()` definitions

## Summary of Changes

| Type                   | Count |
| ---------------------- | ----- |
| New interfaces         | 5     |
| Renamed interfaces     | 3     |
| Expanded interfaces    | 1     |
| New mock files         | 6     |
| Test files to migrate  | 5     |
| Mock classes to delete | ~20   |

## Benefits

- **Testability**: Mock any class with simple factory calls
- **Consistency**: All interfaces follow `I` prefix convention
- **DRY**: Single source for mock implementations
- **Type safety**: No more `as unknown as` casts for private property access
- **Maintainability**: Interface changes surface at compile time
