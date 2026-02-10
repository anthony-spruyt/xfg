# Repository Processor Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Continue SOLID refactoring to reduce RepositoryProcessor from 587 lines to <200 lines by extracting FileSyncOrchestrator, PRMergeHandler, and formatCommitMessage.

**Architecture:** Extract two new components (FileSyncOrchestrator for file sync + manifest, PRMergeHandler for PR creation/merge) and one pure function (formatCommitMessage). RepositoryProcessor becomes a thin orchestrator delegating to these components.

**Tech Stack:** TypeScript, Node.js test runner, existing mock infrastructure in test/mocks/

---

## Task 1: Extract formatCommitMessage Pure Function

**Files:**

- Create: `src/sync/commit-message.ts`
- Create: `test/unit/sync/commit-message.test.ts`
- Modify: `src/sync/index.ts`

**Step 1: Write the failing test file**

Create `test/unit/sync/commit-message.test.ts`:

```typescript
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatCommitMessage } from "../../../src/sync/commit-message.js";
import type { FileAction } from "../../../src/vcs/pr-creator.js";

describe("formatCommitMessage", () => {
  test("returns single file message for one changed file", () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: sync config.json");
  });

  test("returns comma-separated message for 2-3 files", () => {
    const files: FileAction[] = [
      { fileName: "a.json", action: "create" },
      { fileName: "b.json", action: "update" },
    ];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: sync a.json, b.json");
  });

  test("returns count message for 4+ files", () => {
    const files: FileAction[] = [
      { fileName: "a.json", action: "create" },
      { fileName: "b.json", action: "update" },
      { fileName: "c.json", action: "create" },
      { fileName: "d.json", action: "update" },
    ];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: sync 4 config files");
  });

  test("filters out skipped files", () => {
    const files: FileAction[] = [
      { fileName: "changed.json", action: "create" },
      { fileName: "unchanged.json", action: "skip" },
    ];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: sync changed.json");
  });

  test("returns remove message for single deletion", () => {
    const files: FileAction[] = [{ fileName: "old.json", action: "delete" }];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: remove old.json");
  });

  test("returns orphan count message for multiple deletions only", () => {
    const files: FileAction[] = [
      { fileName: "old1.json", action: "delete" },
      { fileName: "old2.json", action: "delete" },
    ];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: remove 2 orphaned config files");
  });

  test("uses sync message for mixed sync and delete", () => {
    const files: FileAction[] = [
      { fileName: "new.json", action: "create" },
      { fileName: "old.json", action: "delete" },
    ];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: sync new.json, old.json");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="formatCommitMessage"`
Expected: FAIL with "Cannot find module '../../../src/sync/commit-message.js'"

**Step 3: Create the implementation file**

Create `src/sync/commit-message.ts`:

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

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="formatCommitMessage"`
Expected: 7 tests pass

**Step 5: Add export to index.ts**

Add to `src/sync/index.ts`:

```typescript
export { formatCommitMessage } from "./commit-message.js";
```

**Step 6: Run build and lint**

Run: `npm run build && ./lint.sh`
Expected: Success

**Step 7: Commit**

```bash
git add src/sync/commit-message.ts test/unit/sync/commit-message.test.ts src/sync/index.ts
git commit -m "feat(sync): extract formatCommitMessage as pure function"
```

---

## Task 2: Add FileSyncOrchestrator Interface to types.ts

**Files:**

- Modify: `src/sync/types.ts`

**Step 1: Add interface and types**

Add at end of `src/sync/types.ts`:

```typescript
import type { FileAction } from "../vcs/pr-creator.js";

/**
 * Result of file synchronization
 */
export interface FileSyncResult {
  fileChanges: Map<string, FileWriteResult>;
  diffStats: DiffStats;
  changedFiles: FileAction[];
  hasChanges: boolean;
}

/**
 * Interface for file synchronization orchestration
 */
export interface IFileSyncOrchestrator {
  /**
   * Write files, handle orphans, update manifest, return change summary.
   */
  sync(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    session: SessionContext,
    options: ProcessorOptions
  ): Promise<FileSyncResult>;
}
```

Note: Also add the import for `RepoConfig` at the top if not already present:

```typescript
import type { RepoConfig } from "../config/types.js";
```

**Step 2: Run build to verify interface compiles**

Run: `npm run build`
Expected: Success

**Step 3: Add interface export to index.ts**

Add to `src/sync/index.ts` type exports:

```typescript
export type { IFileSyncOrchestrator, FileSyncResult } from "./types.js";
```

**Step 4: Run build**

Run: `npm run build`
Expected: Success

**Step 5: Commit**

```bash
git add src/sync/types.ts src/sync/index.ts
git commit -m "feat(sync): add IFileSyncOrchestrator interface"
```

---

## Task 3: Create FileSyncOrchestrator Implementation

**Files:**

- Create: `src/sync/file-sync-orchestrator.ts`
- Modify: `src/sync/index.ts`

**Step 1: Create the implementation file**

Create `src/sync/file-sync-orchestrator.ts`:

```typescript
import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
import type { FileAction } from "../vcs/pr-creator.js";
import { incrementDiffStats } from "./diff-utils.js";
import { loadManifest } from "./manifest.js";
import type {
  IFileWriter,
  IManifestManager,
  SessionContext,
  ProcessorOptions,
  FileSyncResult,
  IFileSyncOrchestrator,
} from "./types.js";

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

**Step 2: Run build to verify it compiles**

Run: `npm run build`
Expected: Success

**Step 3: Add export to index.ts**

Add to `src/sync/index.ts`:

```typescript
export { FileSyncOrchestrator } from "./file-sync-orchestrator.js";
```

**Step 4: Run build and lint**

Run: `npm run build && ./lint.sh`
Expected: Success

**Step 5: Commit**

```bash
git add src/sync/file-sync-orchestrator.ts src/sync/index.ts
git commit -m "feat(sync): create FileSyncOrchestrator component"
```

---

## Task 4: Write Unit Tests for FileSyncOrchestrator

**Files:**

- Create: `test/unit/sync/file-sync-orchestrator.test.ts`

**Step 1: Write the test file**

Create `test/unit/sync/file-sync-orchestrator.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSyncOrchestrator } from "../../../src/sync/file-sync-orchestrator.js";
import {
  createMockAuthenticatedGitOps,
  createMockLogger,
} from "../../mocks/index.js";
import { createDiffStats } from "../../../src/sync/diff-utils.js";
import { MANIFEST_FILENAME } from "../../../src/sync/manifest.js";
import type { IFileWriter, IManifestManager } from "../../../src/sync/types.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import type { RepoConfig } from "../../../src/config/types.js";

const testDir = join(tmpdir(), "file-sync-orchestrator-test-" + Date.now());

describe("FileSyncOrchestrator", () => {
  let workDir: string;

  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test/repo.git",
    owner: "test",
    repo: "repo",
    host: "github.com",
  };

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createMockFileWriter(
    fileChanges: Map<
      string,
      {
        fileName: string;
        content: string | null;
        action: "create" | "update" | "delete" | "skip";
      }
    >
  ): IFileWriter {
    return {
      writeFiles: async () => ({
        fileChanges,
        diffStats: createDiffStats(),
      }),
    };
  }

  function createMockManifestManager(): IManifestManager & {
    calls: {
      processOrphans: number;
      deleteOrphans: number;
      saveUpdatedManifest: number;
    };
  } {
    const calls = {
      processOrphans: 0,
      deleteOrphans: 0,
      saveUpdatedManifest: 0,
    };
    return {
      calls,
      processOrphans: () => {
        calls.processOrphans++;
        return { manifest: { version: 3, configs: {} }, filesToDelete: [] };
      },
      deleteOrphans: async () => {
        calls.deleteOrphans++;
      },
      saveUpdatedManifest: () => {
        calls.saveUpdatedManifest++;
      },
    };
  }

  describe("sync", () => {
    test("orchestrates file writing and manifest handling", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      const fileChanges = new Map([
        [
          "config.json",
          { fileName: "config.json", content: "{}", action: "create" as const },
        ],
      ]);
      const mockFileWriter = createMockFileWriter(fileChanges);
      const mockManifestManager = createMockManifestManager();

      const orchestrator = new FileSyncOrchestrator(
        mockFileWriter,
        mockManifestManager,
        mockLogger
      );

      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [{ fileName: "config.json", content: {} }],
      };

      const result = await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps: mockGitOps, baseBranch: "main", cleanup: () => {} },
        { branchName: "chore/sync", workDir, configId: "test" }
      );

      assert.equal(mockManifestManager.calls.processOrphans, 1);
      assert.equal(mockManifestManager.calls.deleteOrphans, 1);
      assert.equal(mockManifestManager.calls.saveUpdatedManifest, 1);
      assert.equal(result.hasChanges, true);
      assert.equal(result.changedFiles.length, 1);
    });

    test("returns hasChanges false when all files skipped", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      const fileChanges = new Map([
        [
          "config.json",
          { fileName: "config.json", content: null, action: "skip" as const },
        ],
      ]);
      const mockFileWriter = createMockFileWriter(fileChanges);
      const mockManifestManager = createMockManifestManager();

      const orchestrator = new FileSyncOrchestrator(
        mockFileWriter,
        mockManifestManager,
        mockLogger
      );

      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [{ fileName: "config.json", content: {} }],
      };

      const result = await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps: mockGitOps, baseBranch: "main", cleanup: () => {} },
        { branchName: "chore/sync", workDir, configId: "test" }
      );

      assert.equal(result.hasChanges, false);
    });

    test("logs diff summary in dry-run mode", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger, diffSummaries } = createMockLogger();

      const fileChanges = new Map([
        [
          "config.json",
          { fileName: "config.json", content: "{}", action: "create" as const },
        ],
      ]);
      const mockFileWriter = createMockFileWriter(fileChanges);
      const mockManifestManager = createMockManifestManager();

      const orchestrator = new FileSyncOrchestrator(
        mockFileWriter,
        mockManifestManager,
        mockLogger
      );

      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [{ fileName: "config.json", content: {} }],
      };

      await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps: mockGitOps, baseBranch: "main", cleanup: () => {} },
        { branchName: "chore/sync", workDir, configId: "test", dryRun: true }
      );

      assert.equal(diffSummaries.length, 1);
    });

    test("calculates diff stats for non-dry-run", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      const fileChanges = new Map([
        [
          "new.json",
          { fileName: "new.json", content: "{}", action: "create" as const },
        ],
        [
          "updated.json",
          {
            fileName: "updated.json",
            content: "{}",
            action: "update" as const,
          },
        ],
      ]);
      const mockFileWriter = createMockFileWriter(fileChanges);
      const mockManifestManager = createMockManifestManager();

      const orchestrator = new FileSyncOrchestrator(
        mockFileWriter,
        mockManifestManager,
        mockLogger
      );

      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [
          { fileName: "new.json", content: {} },
          { fileName: "updated.json", content: {} },
        ],
      };

      const result = await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps: mockGitOps, baseBranch: "main", cleanup: () => {} },
        { branchName: "chore/sync", workDir, configId: "test", dryRun: false }
      );

      assert.equal(result.diffStats.newCount, 1);
      assert.equal(result.diffStats.modifiedCount, 1);
    });
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="FileSyncOrchestrator"`
Expected: All 4 tests pass

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add test/unit/sync/file-sync-orchestrator.test.ts
git commit -m "test(sync): add unit tests for FileSyncOrchestrator"
```

---

## Task 5: Add PRMergeHandler Interface to types.ts

**Files:**

- Modify: `src/sync/types.ts`

**Step 1: Add interface and types**

Add to `src/sync/types.ts`:

```typescript
/**
 * Options for PR creation and merge
 */
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

/**
 * Interface for PR creation and merge handling
 */
export interface IPRMergeHandler {
  /**
   * Create PR and optionally merge based on repo config.
   * Returns ProcessorResult with PR URL and merge status.
   */
  createAndMerge(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: PRHandlerOptions,
    changedFiles: FileAction[],
    repoName: string,
    diffStats?: DiffStats
  ): Promise<ProcessorResult>;
}
```

**Step 2: Run build to verify interface compiles**

Run: `npm run build`
Expected: Success

**Step 3: Add interface export to index.ts**

Add to `src/sync/index.ts` type exports:

```typescript
export type { IPRMergeHandler, PRHandlerOptions } from "./types.js";
```

**Step 4: Run build**

Run: `npm run build`
Expected: Success

**Step 5: Commit**

```bash
git add src/sync/types.ts src/sync/index.ts
git commit -m "feat(sync): add IPRMergeHandler interface"
```

---

## Task 6: Create PRMergeHandler Implementation

**Files:**

- Create: `src/sync/pr-merge-handler.ts`
- Modify: `src/sync/index.ts`

**Step 1: Create the implementation file**

Create `src/sync/pr-merge-handler.ts`:

```typescript
import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
import {
  createPR,
  mergePR,
  type PRResult,
  type FileAction,
} from "../vcs/pr-creator.js";
import type { PRMergeConfig } from "../vcs/index.js";
import type { DiffStats } from "./diff-utils.js";
import type {
  ProcessorResult,
  PRHandlerOptions,
  IPRMergeHandler,
} from "./types.js";

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

**Step 2: Run build to verify it compiles**

Run: `npm run build`
Expected: Success

**Step 3: Add export to index.ts**

Add to `src/sync/index.ts`:

```typescript
export { PRMergeHandler } from "./pr-merge-handler.js";
```

**Step 4: Run build and lint**

Run: `npm run build && ./lint.sh`
Expected: Success

**Step 5: Commit**

```bash
git add src/sync/pr-merge-handler.ts src/sync/index.ts
git commit -m "feat(sync): create PRMergeHandler component"
```

---

## Task 7: Write Unit Tests for PRMergeHandler

**Files:**

- Create: `test/unit/sync/pr-merge-handler.test.ts`

**Step 1: Write the test file**

Create `test/unit/sync/pr-merge-handler.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PRMergeHandler } from "../../../src/sync/pr-merge-handler.js";
import { createMockLogger, createMockExecutor } from "../../mocks/index.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import type { RepoConfig } from "../../../src/config/types.js";
import type { FileAction } from "../../../src/vcs/pr-creator.js";

const testDir = join(tmpdir(), "pr-merge-handler-test-" + Date.now());

describe("PRMergeHandler", () => {
  let workDir: string;

  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test/repo.git",
    owner: "test",
    repo: "repo",
    host: "github.com",
  };

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("createAndMerge", () => {
    test("returns success result with PR URL", async () => {
      const { mock: mockLogger, messages } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({
        responses: new Map([
          // gh pr create returns the PR URL
          ["gh pr create", "https://github.com/test/repo/pull/1"],
          // gh pr merge succeeds
          ["gh pr merge", ""],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);
      const changedFiles: FileAction[] = [
        { fileName: "config.json", action: "create" },
      ];
      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [],
      };

      const result = await handler.createAndMerge(
        mockRepoInfo,
        repoConfig,
        {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: true,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles,
        "test/repo"
      );

      assert.equal(result.success, true);
      assert.ok(messages.some((msg) => msg.includes("Creating pull request")));
    });

    test("skips merge when mode is manual", async () => {
      const { mock: mockLogger, messages } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({
        responses: new Map([
          ["gh pr create", "https://github.com/test/repo/pull/1"],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);
      const changedFiles: FileAction[] = [
        { fileName: "config.json", action: "create" },
      ];
      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [],
        prOptions: { merge: "manual" },
      };

      const result = await handler.createAndMerge(
        mockRepoInfo,
        repoConfig,
        {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: true,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles,
        "test/repo"
      );

      assert.equal(result.success, true);
      // Should not see "Handling merge" message
      assert.ok(!messages.some((msg) => msg.includes("Handling merge")));
    });

    test("passes diffStats through to result", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({
        responses: new Map([
          ["gh pr create", "https://github.com/test/repo/pull/1"],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);
      const changedFiles: FileAction[] = [];
      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [],
        prOptions: { merge: "manual" },
      };
      const diffStats = {
        newCount: 1,
        modifiedCount: 2,
        deletedCount: 0,
        unchangedCount: 0,
      };

      const result = await handler.createAndMerge(
        mockRepoInfo,
        repoConfig,
        {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: true,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles,
        "test/repo",
        diffStats
      );

      assert.deepEqual(result.diffStats, diffStats);
    });
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="PRMergeHandler"`
Expected: All 3 tests pass

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add test/unit/sync/pr-merge-handler.test.ts
git commit -m "test(sync): add unit tests for PRMergeHandler"
```

---

## Task 8: Refactor RepositoryProcessor to Use New Components

**Files:**

- Modify: `src/sync/repository-processor.ts`

This is the main refactoring task. We will:

1. Update constructor to accept new components
2. Replace `processFiles()` with `fileSyncOrchestrator.sync()`
3. Replace `createAndMergePR()` with `prMergeHandler.createAndMerge()`
4. Replace inline `formatCommitMessage()` with imported function
5. Delete the now-unused private methods

**Step 1: Read current repository-processor.ts**

Read the file to understand current structure before editing.

**Step 2: Update imports**

Replace the existing imports section. Add:

```typescript
import { formatCommitMessage } from "./commit-message.js";
import {
  FileWriter,
  ManifestManager,
  BranchManager,
  AuthOptionsBuilder,
  RepositorySession,
  CommitPushManager,
  FileSyncOrchestrator,
  PRMergeHandler,
  type IFileWriter,
  type IManifestManager,
  type IBranchManager,
  type IAuthOptionsBuilder,
  type IRepositorySession,
  type ICommitPushManager,
  type IFileSyncOrchestrator,
  type IPRMergeHandler,
  type SessionContext,
  type GitOpsFactory,
  type ProcessorOptions,
  type ProcessorResult,
} from "./index.js";
```

**Step 3: Update class properties**

Add new component properties:

```typescript
private readonly fileSyncOrchestrator: IFileSyncOrchestrator;
private readonly prMergeHandler: IPRMergeHandler;
```

**Step 4: Update constructor**

Update constructor to accept and initialize new components:

```typescript
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
  }
) {
  // ... existing initialization ...

  // Add after existing component initialization:
  this.fileSyncOrchestrator =
    components?.fileSyncOrchestrator ??
    new FileSyncOrchestrator(this.fileWriter, this.manifestManager, logInstance);
  this.prMergeHandler =
    components?.prMergeHandler ?? new PRMergeHandler(logInstance);
}
```

**Step 5: Refactor process() method**

Replace the ~140 line process() method with ~55 lines:

```typescript
async process(
  repoConfig: RepoConfig,
  repoInfo: RepoInfo,
  options: ProcessorOptions
): Promise<ProcessorResult> {
  const repoName = getRepoDisplayName(repoInfo);
  const { branchName, workDir, dryRun, prTemplate } = options;
  const retries = options.retries ?? 3;
  const executor = options.executor ?? defaultExecutor;

  // Resolve auth
  const authResult = await this.authOptionsBuilder.resolve(repoInfo, repoName);
  if (authResult.skipResult) {
    return authResult.skipResult;
  }

  // Determine merge mode
  const mergeMode = repoConfig.prOptions?.merge ?? "auto";
  const isDirectMode = mergeMode === "direct";

  if (isDirectMode && repoConfig.prOptions?.mergeStrategy) {
    this.log.info(
      `Warning: mergeStrategy '${repoConfig.prOptions.mergeStrategy}' is ignored in direct mode`
    );
  }

  let session: SessionContext | null = null;
  try {
    // Setup workspace
    session = await this.repositorySession.setup(repoInfo, {
      workDir,
      dryRun: dryRun ?? false,
      retries,
      authOptions: authResult.authOptions,
    });

    // Setup branch
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

    // Sync files and manifest
    const { diffStats, changedFiles, hasChanges, fileChanges } =
      await this.fileSyncOrchestrator.sync(repoConfig, repoInfo, session, options);

    if (!hasChanges) {
      return {
        success: true,
        repoName,
        message: "No changes detected",
        skipped: true,
        diffStats,
      };
    }

    // Commit and push
    const commitMessage = formatCommitMessage(changedFiles);
    const pushBranch = isDirectMode ? session.baseBranch : branchName;

    const commitResult = await this.commitPushManager.commitAndPush(
      {
        repoInfo,
        gitOps: session.gitOps,
        workDir,
        fileChanges,
        commitMessage,
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
        diffStats,
      };
    }

    // Direct mode: no PR
    if (isDirectMode) {
      this.log.info(`Changes pushed directly to ${session.baseBranch}`);
      return {
        success: true,
        repoName,
        message: `Pushed directly to ${session.baseBranch}`,
        diffStats,
      };
    }

    // Create and merge PR
    return await this.prMergeHandler.createAndMerge(
      repoInfo,
      repoConfig,
      {
        branchName,
        baseBranch: session.baseBranch,
        workDir,
        dryRun: dryRun ?? false,
        retries,
        prTemplate,
        token: authResult.token,
        executor,
      },
      changedFiles,
      repoName,
      diffStats
    );
  } finally {
    try {
      session?.cleanup();
    } catch {
      // Ignore cleanup errors - best effort
    }
  }
}
```

**Step 6: Refactor updateManifestOnly() method similarly**

Update to use `prMergeHandler.createAndMerge()` instead of inline `createAndMergePR()`.

**Step 7: Delete unused private methods**

Remove:

- `private async processFiles()` - now in FileSyncOrchestrator
- `private async createAndMergePR()` - now in PRMergeHandler
- `private formatCommitMessage()` - now in commit-message.ts

**Step 8: Run build**

Run: `npm run build`
Expected: Success

**Step 9: Run full test suite**

Run: `npm test`
Expected: All tests pass (1,724+)

**Step 10: Run lint**

Run: `./lint.sh`
Expected: Success

**Step 11: Verify line count**

Run: `wc -l src/sync/repository-processor.ts`
Expected: <200 lines

**Step 12: Commit**

```bash
git add src/sync/repository-processor.ts
git commit -m "refactor(sync): use extracted components in RepositoryProcessor

- Use FileSyncOrchestrator for file sync and manifest handling
- Use PRMergeHandler for PR creation and merge workflow
- Use formatCommitMessage pure function
- Reduce file from 587 to ~170 lines"
```

---

## Task 9: Final Verification and Cleanup

**Files:**

- All sync module files

**Step 1: Run full test suite**

Run: `npm test`
Expected: All 1,724+ tests pass

**Step 2: Run linting**

Run: `./lint.sh`
Expected: No errors

**Step 3: Verify file sizes**

Run: `wc -l src/sync/repository-processor.ts src/sync/file-sync-orchestrator.ts src/sync/pr-merge-handler.ts src/sync/commit-message.ts`
Expected:

- repository-processor.ts: <200 lines
- file-sync-orchestrator.ts: ~70 lines
- pr-merge-handler.ts: ~65 lines
- commit-message.ts: ~25 lines

**Step 4: Verify no unused imports**

Run: `npm run build`
Expected: No warnings about unused imports

**Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(sync): finalize Phase 2 repository-processor refactoring"
```

---

## Acceptance Checklist

- [ ] All 1,724+ tests pass
- [ ] `repository-processor.ts` <200 lines
- [ ] Each new component has unit tests:
  - [ ] commit-message.test.ts (7 tests)
  - [ ] file-sync-orchestrator.test.ts (4 tests)
  - [ ] pr-merge-handler.test.ts (3 tests)
- [ ] Linting passes (`./lint.sh`)
- [ ] Public interface `IRepositoryProcessor` unchanged
- [ ] No circular dependencies
- [ ] formatCommitMessage extracted as pure function
