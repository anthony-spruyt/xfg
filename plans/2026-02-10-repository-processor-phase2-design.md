# Repository Processor Phase 2 Refactoring Design

## Overview

Continue SOLID refactoring of `RepositoryProcessor` from 587 lines to <200 lines by extracting two additional components and one pure function.

### Current State (After Phase 1)

- `repository-processor.ts`: 587 lines
- Components extracted: `AuthOptionsBuilder`, `RepositorySession`, `CommitPushManager`
- All 1,724 tests passing

### Phase 2 Extractions

| Method                  | Lines | New Component/Function   |
| ----------------------- | ----- | ------------------------ |
| `processFiles()`        | ~93   | `FileSyncOrchestrator`   |
| `createAndMergePR()`    | ~77   | `PRMergeHandler`         |
| `formatCommitMessage()` | ~22   | Pure function extraction |

### Success Criteria

| Metric                          | Current | Target |
| ------------------------------- | ------- | ------ |
| `repository-processor.ts` lines | 587     | <200   |
| New source files                | 0       | 3      |
| New test files                  | 0       | 3      |
| Tests passing                   | 1,724   | 1,724+ |

---

## Architecture

### Target State

```
RepositoryProcessor (~150 lines) - Thin Orchestrator
├── AuthOptionsBuilder (exists) - Auth domain
├── RepositorySession (exists) - Workspace lifecycle
├── BranchManager (exists) - Branch operations
├── FileSyncOrchestrator (NEW) - File sync + manifest
├── CommitPushManager (exists) - Commit/push workflow
└── PRMergeHandler (NEW) - PR creation and merge

Plus: formatCommitMessage() - Pure function
```

---

## Component Design

### 1. FileSyncOrchestrator

**Purpose**: Orchestrate file writing and manifest management.

**File**: `src/sync/file-sync-orchestrator.ts`

```typescript
import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
import type { FileAction } from "../vcs/pr-creator.js";
import { incrementDiffStats, DiffStats } from "./diff-utils.js";
import { loadManifest } from "./manifest.js";
import type {
  IFileWriter,
  IManifestManager,
  SessionContext,
  ProcessorOptions,
  FileWriteResult,
} from "./index.js";

export interface FileSyncResult {
  fileChanges: Map<string, FileWriteResult>;
  diffStats: DiffStats;
  changedFiles: FileAction[];
  hasChanges: boolean;
}

export interface IFileSyncOrchestrator {
  sync(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    session: SessionContext,
    options: ProcessorOptions
  ): Promise<FileSyncResult>;
}

export class FileSyncOrchestrator implements IFileSyncOrchestrator {
  constructor(
    private readonly fileWriter: IFileWriter,
    private readonly manifestManager: IManifestManager,
    private readonly log: ILogger
  ) {}

  async sync(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    session: SessionContext,
    options: ProcessorOptions
  ): Promise<FileSyncResult> {
    const { workDir, dryRun, noDelete, configId } = options;

    // Write files
    const { fileChanges, diffStats } = await this.fileWriter.writeFiles(
      repoConfig.files,
      {
        repoInfo,
        baseBranch: session.baseBranch,
        workDir,
        dryRun: dryRun ?? false,
        noDelete: noDelete ?? false,
        configId,
      },
      { gitOps: session.gitOps, log: this.log }
    );

    // Handle orphans
    const existingManifest = loadManifest(workDir);
    const filesWithDeleteOrphaned = new Map<string, boolean | undefined>(
      repoConfig.files.map((f) => [f.fileName, f.deleteOrphaned])
    );

    const { manifest: newManifest, filesToDelete } =
      this.manifestManager.processOrphans(
        workDir,
        configId,
        filesWithDeleteOrphaned
      );

    await this.manifestManager.deleteOrphans(
      filesToDelete,
      { dryRun: dryRun ?? false, noDelete: noDelete ?? false },
      { gitOps: session.gitOps, log: this.log, fileChanges }
    );

    // Update diff stats for deletions in dry-run
    if (dryRun && filesToDelete.length > 0 && !noDelete) {
      for (const fileName of filesToDelete) {
        if (session.gitOps.fileExists(fileName)) {
          incrementDiffStats(diffStats, "DELETED");
        }
      }
    }

    // Save manifest
    this.manifestManager.saveUpdatedManifest(
      workDir,
      newManifest,
      existingManifest,
      dryRun ?? false,
      fileChanges
    );

    // Show diff summary in dry-run
    if (dryRun) {
      this.log.diffSummary(
        diffStats.newCount,
        diffStats.modifiedCount,
        diffStats.unchangedCount,
        diffStats.deletedCount
      );
    }

    // Build changed files list
    const changedFiles: FileAction[] = Array.from(fileChanges.entries()).map(
      ([fileName, info]) => ({ fileName, action: info.action })
    );

    // Calculate diff stats for non-dry-run
    if (!dryRun) {
      for (const [, info] of fileChanges) {
        if (info.action === "create") incrementDiffStats(diffStats, "NEW");
        else if (info.action === "update")
          incrementDiffStats(diffStats, "MODIFIED");
        else if (info.action === "delete")
          incrementDiffStats(diffStats, "DELETED");
      }
    }

    const hasChanges = changedFiles.some((f) => f.action !== "skip");

    return { fileChanges, diffStats, changedFiles, hasChanges };
  }
}
```

**Test Strategy**:

- Mock `IFileWriter` and `IManifestManager`
- Test dry-run diff stats accumulation
- Test orphan deletion flow
- Test manifest save sequencing
- Test hasChanges calculation

---

### 2. PRMergeHandler

**Purpose**: Handle PR creation and merge workflow.

**File**: `src/sync/pr-merge-handler.ts`

```typescript
import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
import type { ICommandExecutor } from "../shared/command-executor.js";
import {
  createPR,
  mergePR,
  type PRResult,
  type FileAction,
} from "../vcs/pr-creator.js";
import type { PRMergeConfig } from "../vcs/index.js";
import type { DiffStats } from "./diff-utils.js";
import type { ProcessorResult } from "./index.js";

export interface PRHandlerOptions {
  branchName: string;
  baseBranch: string;
  workDir: string;
  dryRun: boolean;
  retries: number;
  prTemplate?: string;
  token?: string;
  executor: ICommandExecutor;
}

export interface IPRMergeHandler {
  createAndMerge(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: PRHandlerOptions,
    changedFiles: FileAction[],
    repoName: string,
    diffStats?: DiffStats
  ): Promise<ProcessorResult>;
}

export class PRMergeHandler implements IPRMergeHandler {
  constructor(private readonly log: ILogger) {}

  async createAndMerge(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: PRHandlerOptions,
    changedFiles: FileAction[],
    repoName: string,
    diffStats?: DiffStats
  ): Promise<ProcessorResult> {
    this.log.info("Creating pull request...");
    const prResult: PRResult = await createPR({
      repoInfo,
      branchName: options.branchName,
      baseBranch: options.baseBranch,
      files: changedFiles,
      workDir: options.workDir,
      dryRun: options.dryRun,
      retries: options.retries,
      prTemplate: options.prTemplate,
      executor: options.executor,
      token: options.token,
    });

    const mergeMode = repoConfig.prOptions?.merge ?? "auto";
    let mergeResult: ProcessorResult["mergeResult"];

    if (prResult.success && prResult.url && mergeMode !== "manual") {
      this.log.info(`Handling merge (mode: ${mergeMode})...`);

      const mergeConfig: PRMergeConfig = {
        mode: mergeMode,
        strategy: repoConfig.prOptions?.mergeStrategy ?? "squash",
        deleteBranch: repoConfig.prOptions?.deleteBranch ?? true,
        bypassReason: repoConfig.prOptions?.bypassReason,
      };

      const result = await mergePR({
        repoInfo,
        prUrl: prResult.url,
        mergeConfig,
        workDir: options.workDir,
        dryRun: options.dryRun,
        retries: options.retries,
        executor: options.executor,
        token: options.token,
      });

      mergeResult = {
        merged: result.merged ?? false,
        autoMergeEnabled: result.autoMergeEnabled,
        message: result.message,
      };

      if (!result.success) {
        this.log.info(`Warning: Merge operation failed - ${result.message}`);
      } else {
        this.log.info(result.message);
      }
    }

    return {
      success: prResult.success,
      repoName,
      message: prResult.message,
      prUrl: prResult.url,
      mergeResult,
      diffStats,
    };
  }
}
```

**Test Strategy**:

- Mock `createPR` and `mergePR` functions
- Test PR creation success/failure paths
- Test merge mode handling (manual skips merge)
- Test merge config building from repo options
- Test merge result propagation

---

### 3. formatCommitMessage Pure Function

**Purpose**: Generate commit messages based on changed files.

**File**: `src/sync/commit-message.ts`

```typescript
import type { FileAction } from "../vcs/pr-creator.js";

/**
 * Format a commit message based on the files being changed.
 *
 * Rules:
 * - Delete-only: "chore: remove <file>" or "chore: remove N orphaned config files"
 * - Single file: "chore: sync <file>"
 * - 2-3 files: "chore: sync file1, file2, file3"
 * - 4+ files: "chore: sync N config files"
 */
export function formatCommitMessage(files: FileAction[]): string {
  const changedFiles = files.filter((f) => f.action !== "skip");
  const deletedFiles = changedFiles.filter((f) => f.action === "delete");
  const syncedFiles = changedFiles.filter((f) => f.action !== "delete");

  if (syncedFiles.length === 0 && deletedFiles.length > 0) {
    if (deletedFiles.length === 1) {
      return `chore: remove ${deletedFiles[0].fileName}`;
    }
    return `chore: remove ${deletedFiles.length} orphaned config files`;
  }

  if (changedFiles.length === 1) {
    return `chore: sync ${changedFiles[0].fileName}`;
  }

  if (changedFiles.length <= 3) {
    return `chore: sync ${changedFiles.map((f) => f.fileName).join(", ")}`;
  }

  return `chore: sync ${changedFiles.length} config files`;
}
```

**Test Strategy**:

- Test single file sync message
- Test multiple files (2-3) sync message
- Test many files (4+) sync message
- Test delete-only scenarios
- Test mixed sync/delete scenarios
- Test skip filtering

---

### 4. Refactored RepositoryProcessor

After extraction, the processor becomes a thin orchestrator:

```typescript
export class RepositoryProcessor implements IRepositoryProcessor {
  private readonly gitOpsFactory: GitOpsFactory;
  private readonly log: ILogger;
  private readonly authOptionsBuilder: IAuthOptionsBuilder;
  private readonly repositorySession: IRepositorySession;
  private readonly commitPushManager: ICommitPushManager;
  private readonly fileSyncOrchestrator: IFileSyncOrchestrator;
  private readonly prMergeHandler: IPRMergeHandler;
  private readonly branchManager: IBranchManager;

  constructor(
    gitOpsFactory?: GitOpsFactory,
    log?: ILogger,
    components?: {
      branchManager?: IBranchManager;
      authOptionsBuilder?: IAuthOptionsBuilder;
      repositorySession?: IRepositorySession;
      commitPushManager?: ICommitPushManager;
      fileSyncOrchestrator?: IFileSyncOrchestrator;
      prMergeHandler?: IPRMergeHandler;
    }
  ) {
    // Initialize with defaults or injected components
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult> {
    // ~55 lines of orchestration:
    // 1. authOptionsBuilder.resolve()
    // 2. repositorySession.setup()
    // 3. branchManager.setupBranch()
    // 4. fileSyncOrchestrator.sync()
    // 5. commitPushManager.commitAndPush()
    // 6. prMergeHandler.createAndMerge() (if not direct mode)
  }

  async updateManifestOnly(...): Promise<ProcessorResult> {
    // ~50 lines - similar flow, manifest-only
  }
}
```

---

## File Structure

### New Files

```
src/sync/
├── file-sync-orchestrator.ts   # NEW (~70 lines)
├── pr-merge-handler.ts         # NEW (~65 lines)
├── commit-message.ts           # NEW (~22 lines)
├── repository-processor.ts     # MODIFIED (~150 lines, was 587)
├── types.ts                    # MODIFIED (add interfaces)
└── index.ts                    # MODIFIED (add exports)

test/unit/sync/
├── file-sync-orchestrator.test.ts  # NEW
├── pr-merge-handler.test.ts        # NEW
├── commit-message.test.ts          # NEW
└── repository-processor.test.ts    # EXISTING (still works)
```

---

## Implementation Order

1. Extract `formatCommitMessage()` to `commit-message.ts` (simplest, no dependencies)
2. Add interfaces to `types.ts`
3. Create `FileSyncOrchestrator` with tests
4. Create `PRMergeHandler` with tests
5. Refactor `RepositoryProcessor` to use new components
6. Verify all tests pass
7. Update exports in `index.ts`

---

## Risks and Mitigations

| Risk                    | Mitigation                               |
| ----------------------- | ---------------------------------------- |
| Breaking existing tests | Run tests after each extraction          |
| Subtle behavior changes | Move code exactly, don't rewrite         |
| Constructor complexity  | Optional params with production defaults |
| Circular dependencies   | Careful import ordering, use types.ts    |

---

## Acceptance Criteria

- [ ] All 1,724+ tests pass
- [ ] `repository-processor.ts` <200 lines
- [ ] Each new component has unit tests
- [ ] Linting passes (`./lint.sh`)
- [ ] Public interface `IRepositoryProcessor` unchanged
- [ ] No circular dependencies
