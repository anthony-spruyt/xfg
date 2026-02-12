# Repository Processor DRY Refactor Design

## Overview

Follow-up to issue #451. Eliminate duplication between `process()` and `updateManifestOnly()` using the Strategy pattern to achieve the <200 line target for `repository-processor.ts`.

## Problem Statement

Current state after initial SOLID refactoring:

- `repository-processor.ts`: 438 lines (target: <200)
- Both `process()` (~150 lines) and `updateManifestOnly()` (~167 lines) follow identical 11-step workflow
- Only step 6 ("do work") differs between the methods
- Violates DRY principle with duplicated orchestration logic

## Goals

1. Reduce `repository-processor.ts` to <100 lines (thin facade)
2. Extract common workflow to `SyncWorkflow` class
3. Use Strategy pattern for the differing "work" step
4. Maintain 100% backwards compatibility
5. Improve testability with injectable strategies

## Non-Goals

- Changing the `IRepositoryProcessor` interface
- Modifying other components
- Adding new features

## Architecture

### Current State

```
RepositoryProcessor (438 lines)
├── process() - 150 lines of workflow + file sync
└── updateManifestOnly() - 167 lines of SAME workflow + manifest update
```

### Target State

```
RepositoryProcessor (~75 lines) - Thin Facade
├── process() → delegates to SyncWorkflow with FileSyncStrategy
└── updateManifestOnly() → delegates to SyncWorkflow with ManifestStrategy

SyncWorkflow (~100 lines) - Common Orchestration
├── Step 1: Resolve auth
├── Step 2: Determine merge mode
├── Step 3: Setup session
├── Step 4: Setup branch
├── Step 5: Execute work strategy ← STRATEGY INJECTION POINT
├── Step 6: Handle no changes
├── Step 7: Commit and push
├── Step 8: Handle commit result
├── Step 9: Direct mode return
└── Step 10: Create and merge PR

IWorkStrategy (interface)
├── FileSyncStrategy (~35 lines) - wraps FileSyncOrchestrator
└── ManifestStrategy (~55 lines) - updates manifest only
```

## Component Design

### 1. IWorkStrategy Interface

```typescript
// src/sync/types.ts (additions)

/**
 * Result of executing work within a sync workflow
 */
export interface WorkResult {
  /** File changes to commit */
  fileChanges: Map<string, FileWriteResult>;
  /** Changed files for PR body */
  changedFiles: FileAction[];
  /** Diff statistics for reporting */
  diffStats?: DiffStats;
  /** Human-readable commit message */
  commitMessage: string;
  /** File change details for result reporting */
  fileChangeDetails: FileChangeDetail[];
}

/**
 * Strategy for executing work within the sync workflow.
 * Implementations define what changes to make (files vs manifest).
 */
export interface IWorkStrategy {
  /**
   * Execute work and return changes to commit.
   * Return null if no changes detected (workflow will skip).
   */
  execute(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    session: SessionContext,
    options: ProcessorOptions
  ): Promise<WorkResult | null>;
}
```

### 2. ISyncWorkflow Interface

```typescript
/**
 * Orchestrates the common sync workflow steps.
 */
export interface ISyncWorkflow {
  /**
   * Execute workflow: auth → session → branch → work → commit → PR
   */
  execute(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions,
    workStrategy: IWorkStrategy
  ): Promise<ProcessorResult>;
}
```

### 3. SyncWorkflow Implementation

**File**: `src/sync/sync-workflow.ts`

```typescript
export class SyncWorkflow implements ISyncWorkflow {
  constructor(
    private readonly authOptionsBuilder: IAuthOptionsBuilder,
    private readonly repositorySession: IRepositorySession,
    private readonly branchManager: IBranchManager,
    private readonly commitPushManager: ICommitPushManager,
    private readonly prMergeHandler: IPRMergeHandler,
    private readonly log: ILogger
  ) {}

  async execute(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions,
    workStrategy: IWorkStrategy
  ): Promise<ProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { branchName, workDir, dryRun } = options;
    const retries = options.retries ?? 3;
    const executor = options.executor ?? defaultExecutor;

    // Step 1: Resolve auth
    const authResult = await this.authOptionsBuilder.resolve(
      repoInfo,
      repoName
    );
    if (authResult.skipResult) {
      return authResult.skipResult;
    }

    // Step 2: Determine merge mode
    const mergeMode = repoConfig.prOptions?.merge ?? "auto";
    const isDirectMode = mergeMode === "direct";

    let session: SessionContext | null = null;
    try {
      // Step 3: Setup session
      session = await this.repositorySession.setup(repoInfo, {
        workDir,
        dryRun: dryRun ?? false,
        retries,
        authOptions: authResult.authOptions,
      });

      // Step 4: Setup branch
      await this.branchManager.setupBranch({
        repoInfo,
        branchName,
        baseBranch: session.baseBranch,
        workDir,
        isDirectMode,
        dryRun: dryRun ?? false,
        retries,
        token: authResult.token,
        gitOps: session.gitOps,
        log: this.log,
        executor,
      });

      // Step 5: Execute work strategy
      const workResult = await workStrategy.execute(
        repoConfig,
        repoInfo,
        session,
        options
      );

      // Step 6: No changes - skip
      if (!workResult) {
        return {
          success: true,
          repoName,
          message: "No changes detected",
          skipped: true,
        };
      }

      // Step 7: Commit and push
      const pushBranch = isDirectMode ? session.baseBranch : branchName;
      const commitResult = await this.commitPushManager.commitAndPush(
        {
          repoInfo,
          gitOps: session.gitOps,
          workDir,
          fileChanges: workResult.fileChanges,
          commitMessage: workResult.commitMessage,
          pushBranch,
          isDirectMode,
          dryRun: dryRun ?? false,
          retries,
          token: authResult.token,
          executor,
        },
        repoName
      );

      if (!commitResult.success && commitResult.errorResult) {
        return commitResult.errorResult;
      }

      if (commitResult.skipped) {
        return {
          success: true,
          repoName,
          message: "No changes detected after staging",
          skipped: true,
          diffStats: workResult.diffStats,
          fileChanges: workResult.fileChangeDetails,
        };
      }

      // Step 8: Direct mode - done
      if (isDirectMode) {
        this.log.info(`Changes pushed directly to ${session.baseBranch}`);
        return {
          success: true,
          repoName,
          message: `Pushed directly to ${session.baseBranch}`,
          diffStats: workResult.diffStats,
          fileChanges: workResult.fileChangeDetails,
        };
      }

      // Step 9: Create and merge PR
      return await this.prMergeHandler.createAndMerge(
        repoInfo,
        repoConfig,
        {
          branchName,
          baseBranch: session.baseBranch,
          workDir,
          dryRun: dryRun ?? false,
          retries,
          prTemplate: options.prTemplate,
          token: authResult.token,
          executor,
        },
        workResult.changedFiles,
        repoName,
        workResult.diffStats,
        workResult.fileChangeDetails
      );
    } finally {
      session?.cleanup();
    }
  }
}
```

### 4. FileSyncStrategy Implementation

**File**: `src/sync/file-sync-strategy.ts`

```typescript
export class FileSyncStrategy implements IWorkStrategy {
  constructor(private readonly fileSyncOrchestrator: IFileSyncOrchestrator) {}

  async execute(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    session: SessionContext,
    options: ProcessorOptions
  ): Promise<WorkResult | null> {
    const { fileChanges, diffStats, changedFiles, hasChanges } =
      await this.fileSyncOrchestrator.sync(
        repoConfig,
        repoInfo,
        session,
        options
      );

    if (!hasChanges) {
      return null;
    }

    const fileChangeDetails = changedFiles
      .filter((f) => f.action !== "skip")
      .map((f) => ({
        path: f.fileName,
        action: f.action as "create" | "update" | "delete",
      }));

    return {
      fileChanges,
      changedFiles,
      diffStats,
      commitMessage: formatCommitMessage(changedFiles),
      fileChangeDetails,
    };
  }
}
```

### 5. ManifestStrategy Implementation

**File**: `src/sync/manifest-strategy.ts`

```typescript
export interface ManifestUpdateParams {
  rulesets: string[];
}

export class ManifestStrategy implements IWorkStrategy {
  constructor(
    private readonly params: ManifestUpdateParams,
    private readonly log: ILogger
  ) {}

  async execute(
    _repoConfig: RepoConfig,
    _repoInfo: RepoInfo,
    _session: SessionContext,
    options: ProcessorOptions
  ): Promise<WorkResult | null> {
    const { workDir, dryRun } = options;

    // Load and update manifest
    const existingManifest = loadManifest(workDir);
    const rulesetsWithDeleteOrphaned = new Map<string, boolean | undefined>(
      this.params.rulesets.map((name) => [name, true])
    );
    const { manifest: newManifest } = updateManifestRulesets(
      existingManifest,
      options.configId,
      rulesetsWithDeleteOrphaned
    );

    // Check if changed
    const existingConfigs = existingManifest?.configs ?? {};
    if (
      JSON.stringify(existingConfigs) === JSON.stringify(newManifest.configs)
    ) {
      return null;
    }

    if (dryRun) {
      this.log.info(`Would update ${MANIFEST_FILENAME} with rulesets`);
    }

    saveManifest(workDir, newManifest);

    const fileChanges = new Map<string, FileWriteResult>([
      [
        MANIFEST_FILENAME,
        {
          fileName: MANIFEST_FILENAME,
          content: JSON.stringify(newManifest, null, 2) + "\n",
          action: "update",
        },
      ],
    ]);

    return {
      fileChanges,
      changedFiles: [
        { fileName: MANIFEST_FILENAME, action: "update" as const },
      ],
      commitMessage: "chore: update manifest with ruleset tracking",
      fileChangeDetails: [{ path: MANIFEST_FILENAME, action: "update" }],
    };
  }
}
```

### 6. Refactored RepositoryProcessor

**File**: `src/sync/repository-processor.ts`

```typescript
export class RepositoryProcessor implements IRepositoryProcessor {
  private readonly syncWorkflow: ISyncWorkflow;
  private readonly fileSyncOrchestrator: IFileSyncOrchestrator;
  private readonly log: ILogger;

  constructor(
    gitOpsFactory?: GitOpsFactory,
    log?: ILogger,
    components?: {
      fileWriter?: IFileWriter;
      manifestManager?: IManifestManager;
      branchManager?: IBranchManager;
      authOptionsBuilder?: IAuthOptionsBuilder;
      repositorySession?: IRepositorySession;
      commitPushManager?: ICommitPushManager;
      fileSyncOrchestrator?: IFileSyncOrchestrator;
      prMergeHandler?: IPRMergeHandler;
      syncWorkflow?: ISyncWorkflow;
    }
  ) {
    const factory =
      gitOpsFactory ??
      ((opts, auth) => new AuthenticatedGitOps(new GitOps(opts), auth));
    const logInstance = log ?? logger;
    this.log = logInstance;

    // Initialize components
    const tokenManager = hasGitHubAppCredentials()
      ? new GitHubAppTokenManager(
          process.env.XFG_GITHUB_APP_ID!,
          process.env.XFG_GITHUB_APP_PRIVATE_KEY!
        )
      : null;

    const fileWriter = components?.fileWriter ?? new FileWriter();
    const manifestManager =
      components?.manifestManager ?? new ManifestManager();
    const branchManager = components?.branchManager ?? new BranchManager();
    const authOptionsBuilder =
      components?.authOptionsBuilder ??
      new AuthOptionsBuilder(tokenManager, logInstance);
    const repositorySession =
      components?.repositorySession ??
      new RepositorySession(factory, logInstance);
    const commitPushManager =
      components?.commitPushManager ?? new CommitPushManager(logInstance);
    const prMergeHandler =
      components?.prMergeHandler ?? new PRMergeHandler(logInstance);

    this.fileSyncOrchestrator =
      components?.fileSyncOrchestrator ??
      new FileSyncOrchestrator(fileWriter, manifestManager, logInstance);

    this.syncWorkflow =
      components?.syncWorkflow ??
      new SyncWorkflow(
        authOptionsBuilder,
        repositorySession,
        branchManager,
        commitPushManager,
        prMergeHandler,
        logInstance
      );
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult> {
    const strategy = new FileSyncStrategy(this.fileSyncOrchestrator);
    return this.syncWorkflow.execute(repoConfig, repoInfo, options, strategy);
  }

  async updateManifestOnly(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: ProcessorOptions,
    manifestUpdate: { rulesets: string[] }
  ): Promise<ProcessorResult> {
    const strategy = new ManifestStrategy(manifestUpdate, this.log);
    return this.syncWorkflow.execute(repoConfig, repoInfo, options, strategy);
  }
}
```

## File Structure

### New Files

```
src/sync/
├── sync-workflow.ts          # NEW (~100 lines)
├── file-sync-strategy.ts     # NEW (~35 lines)
├── manifest-strategy.ts      # NEW (~55 lines)
├── repository-processor.ts   # MODIFIED (~75 lines, was 438)
├── types.ts                  # MODIFIED (add interfaces)
└── index.ts                  # MODIFIED (export new components)

test/unit/sync/
├── sync-workflow.test.ts     # NEW
├── file-sync-strategy.test.ts    # NEW
├── manifest-strategy.test.ts     # NEW
└── repository-processor.test.ts  # MODIFIED
```

## Line Count Summary

| File                      | Before | After |
| ------------------------- | ------ | ----- |
| `repository-processor.ts` | 438    | ~75   |
| `sync-workflow.ts`        | -      | ~100  |
| `file-sync-strategy.ts`   | -      | ~35   |
| `manifest-strategy.ts`    | -      | ~55   |
| **Total**                 | 438    | ~265  |

## Testing Strategy

### Unit Tests Per Component

| Component             | Test Cases                                                                            |
| --------------------- | ------------------------------------------------------------------------------------- |
| `SyncWorkflow`        | Auth skip, session setup, branch setup, strategy execution, commit paths, PR creation |
| `FileSyncStrategy`    | Returns null when no changes, maps file changes correctly                             |
| `ManifestStrategy`    | Returns null when no changes, updates manifest correctly                              |
| `RepositoryProcessor` | Delegates to workflow with correct strategy                                           |

### TDD Approach

1. Write failing tests for `IWorkStrategy` implementations first
2. Implement strategies to pass tests
3. Write failing tests for `SyncWorkflow`
4. Implement workflow to pass tests
5. Refactor `RepositoryProcessor` and update its tests

## Implementation Plan

| Phase | Task                                 | Files       |
| ----- | ------------------------------------ | ----------- |
| 1     | Add interfaces to `types.ts`         | `types.ts`  |
| 2     | Create `FileSyncStrategy` with tests | 2 new files |
| 3     | Create `ManifestStrategy` with tests | 2 new files |
| 4     | Create `SyncWorkflow` with tests     | 2 new files |
| 5     | Refactor `RepositoryProcessor`       | 1 modified  |
| 6     | Update exports in `index.ts`         | 1 modified  |
| 7     | Run all tests and lint               | -           |

## Acceptance Criteria

- [ ] All existing tests pass
- [ ] `repository-processor.ts` < 100 lines
- [ ] No duplication between `process()` and `updateManifestOnly()`
- [ ] Each new component has unit tests
- [ ] Linting passes (`./lint.sh`)
- [ ] Public interface `IRepositoryProcessor` unchanged

## Related

- Issue: #451
- Original design: `plans/2026-02-10-repository-processor-refactor-design.md`
