# Repository Processor DRY Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate duplication between `process()` and `updateManifestOnly()` using Strategy pattern, reducing `repository-processor.ts` from 438 to ~75 lines.

**Architecture:** Extract common 11-step workflow to `SyncWorkflow` class. Use `IWorkStrategy` interface with `FileSyncStrategy` and `ManifestStrategy` implementations for the differing work step. `RepositoryProcessor` becomes thin facade delegating to workflow.

**Tech Stack:** TypeScript, Node.js Test Runner, existing sync module infrastructure

---

## Task 1: Add Interfaces to types.ts

**Files:**

- Modify: `src/sync/types.ts:323-382` (end of file)

**Step 1: Read the current types.ts**

Review file to understand existing patterns before adding.

**Step 2: Write failing test for WorkResult type**

```typescript
// test/unit/sync/work-strategy.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import type { WorkResult, IWorkStrategy } from "../../../src/sync/types.js";
import type { FileWriteResult } from "../../../src/sync/types.js";

describe("IWorkStrategy interface", () => {
  test("WorkResult has required shape", () => {
    const result: WorkResult = {
      fileChanges: new Map<string, FileWriteResult>(),
      changedFiles: [],
      commitMessage: "test commit",
      fileChangeDetails: [],
    };
    assert.ok(result.fileChanges instanceof Map);
    assert.ok(Array.isArray(result.changedFiles));
    assert.equal(typeof result.commitMessage, "string");
    assert.ok(Array.isArray(result.fileChangeDetails));
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "WorkResult has required shape"`
Expected: FAIL with "Cannot find module" or type error

**Step 4: Add interfaces to types.ts**

Append to `src/sync/types.ts`:

```typescript
import type { FileAction } from "../vcs/pr-creator.js";

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

**Step 5: Add imports for new types**

Add to the top of `src/sync/types.ts`:

```typescript
import type { RepoConfig } from "../config/types.js";
```

**Step 6: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "WorkResult has required shape"`
Expected: PASS

**Step 7: Commit**

```bash
git add src/sync/types.ts test/unit/sync/work-strategy.test.ts
git commit -m "$(cat <<'EOF'
feat(sync): add IWorkStrategy and ISyncWorkflow interfaces

Add Strategy pattern interfaces for DRY refactor:
- WorkResult: result shape from work execution
- IWorkStrategy: strategy interface for file sync vs manifest
- ISyncWorkflow: workflow orchestration interface

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Update index.ts Exports

**Files:**

- Modify: `src/sync/index.ts:10-39` (type exports section)

**Step 1: Add new type exports**

Add to the `export type` block in `src/sync/index.ts`:

```typescript
export type {
  // ... existing exports ...
  WorkResult,
  IWorkStrategy,
  ISyncWorkflow,
} from "./types.js";
```

**Step 2: Run type check**

Run: `npm run build`
Expected: PASS (no type errors)

**Step 3: Commit**

```bash
git add src/sync/index.ts
git commit -m "$(cat <<'EOF'
chore(sync): export new strategy interfaces

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create FileSyncStrategy

**Files:**

- Create: `src/sync/file-sync-strategy.ts`
- Create: `test/unit/sync/file-sync-strategy.test.ts`

**Step 1: Write failing test for FileSyncStrategy**

```typescript
// test/unit/sync/file-sync-strategy.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { FileSyncStrategy } from "../../../src/sync/file-sync-strategy.js";
import type {
  IFileSyncOrchestrator,
  SessionContext,
} from "../../../src/sync/index.js";
import type { RepoConfig } from "../../../src/config/index.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import { createMockAuthenticatedGitOps } from "../../mocks/index.js";

describe("FileSyncStrategy", () => {
  const mockRepoConfig: RepoConfig = {
    git: "git@github.com:test/repo.git",
    files: [{ fileName: "test.txt", content: "test" }],
  };

  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test/repo.git",
    owner: "test",
    repo: "repo",
    host: "github.com",
  };

  test("returns null when no changes", async () => {
    const mockOrchestrator: IFileSyncOrchestrator = {
      async sync() {
        return {
          fileChanges: new Map(),
          diffStats: { additions: 0, deletions: 0, modifications: 0 },
          changedFiles: [],
          hasChanges: false,
        };
      },
    };

    const strategy = new FileSyncStrategy(mockOrchestrator);
    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: false,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      { branchName: "test", workDir: "/tmp", configId: "test" }
    );

    assert.equal(result, null);
  });

  test("returns WorkResult when changes exist", async () => {
    const mockOrchestrator: IFileSyncOrchestrator = {
      async sync() {
        return {
          fileChanges: new Map([
            [
              "test.txt",
              {
                fileName: "test.txt",
                content: "test",
                action: "create" as const,
              },
            ],
          ]),
          diffStats: { additions: 1, deletions: 0, modifications: 0 },
          changedFiles: [{ fileName: "test.txt", action: "create" as const }],
          hasChanges: true,
        };
      },
    };

    const strategy = new FileSyncStrategy(mockOrchestrator);
    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: true,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      { branchName: "test", workDir: "/tmp", configId: "test" }
    );

    assert.ok(result);
    assert.ok(result.fileChanges.has("test.txt"));
    assert.equal(result.changedFiles.length, 1);
    assert.ok(result.commitMessage.length > 0);
    assert.equal(result.fileChangeDetails.length, 1);
    assert.equal(result.fileChangeDetails[0].action, "create");
  });

  test("filters out skip actions from fileChangeDetails", async () => {
    const mockOrchestrator: IFileSyncOrchestrator = {
      async sync() {
        return {
          fileChanges: new Map([
            [
              "test.txt",
              {
                fileName: "test.txt",
                content: "test",
                action: "create" as const,
              },
            ],
          ]),
          diffStats: { additions: 1, deletions: 0, modifications: 0 },
          changedFiles: [
            { fileName: "test.txt", action: "create" as const },
            { fileName: "unchanged.txt", action: "skip" as const },
          ],
          hasChanges: true,
        };
      },
    };

    const strategy = new FileSyncStrategy(mockOrchestrator);
    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: true,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      { branchName: "test", workDir: "/tmp", configId: "test" }
    );

    assert.ok(result);
    assert.equal(result.fileChangeDetails.length, 1);
    assert.equal(result.fileChangeDetails[0].path, "test.txt");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "FileSyncStrategy"`
Expected: FAIL with "Cannot find module"

**Step 3: Create file-sync-strategy.ts**

```typescript
// src/sync/file-sync-strategy.ts
import type { RepoConfig } from "../config/types.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import { formatCommitMessage } from "./commit-message.js";
import type {
  IWorkStrategy,
  WorkResult,
  SessionContext,
  ProcessorOptions,
  IFileSyncOrchestrator,
} from "./types.js";

/**
 * Strategy that performs full file synchronization.
 * Wraps FileSyncOrchestrator to fit the IWorkStrategy interface.
 */
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

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "FileSyncStrategy"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sync/file-sync-strategy.ts test/unit/sync/file-sync-strategy.test.ts
git commit -m "$(cat <<'EOF'
feat(sync): add FileSyncStrategy for file operations

Implements IWorkStrategy, wrapping FileSyncOrchestrator.
Filters skip actions and formats commit messages.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create ManifestStrategy

**Files:**

- Create: `src/sync/manifest-strategy.ts`
- Create: `test/unit/sync/manifest-strategy.test.ts`

**Step 1: Write failing test for ManifestStrategy**

```typescript
// test/unit/sync/manifest-strategy.test.ts
import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManifestStrategy } from "../../../src/sync/manifest-strategy.js";
import type { SessionContext } from "../../../src/sync/index.js";
import { MANIFEST_FILENAME } from "../../../src/sync/manifest.js";
import type { RepoConfig } from "../../../src/config/index.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import {
  createMockAuthenticatedGitOps,
  createMockLogger,
} from "../../mocks/index.js";

describe("ManifestStrategy", () => {
  const testDir = join(tmpdir(), `manifest-strategy-test-${Date.now()}`);
  let workDir: string;

  const mockRepoConfig: RepoConfig = {
    git: "git@github.com:test/repo.git",
    files: [],
  };

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

  test("returns null when manifest unchanged", async () => {
    // Create existing manifest with same rulesets
    const existingManifest = {
      version: 1,
      configs: {
        "test-config": {
          files: {},
          rulesets: { "ruleset-a": { deleteOrphaned: true } },
        },
      },
    };
    writeFileSync(
      join(workDir, MANIFEST_FILENAME),
      JSON.stringify(existingManifest, null, 2)
    );

    const { mock: mockLogger } = createMockLogger();
    const strategy = new ManifestStrategy(
      { rulesets: ["ruleset-a"] },
      mockLogger
    );

    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: false,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      { branchName: "test", workDir, configId: "test-config" }
    );

    assert.equal(result, null);
  });

  test("returns WorkResult when manifest changes", async () => {
    // No existing manifest
    const { mock: mockLogger } = createMockLogger();
    const strategy = new ManifestStrategy(
      { rulesets: ["ruleset-a"] },
      mockLogger
    );

    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: true,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      { branchName: "test", workDir, configId: "test-config" }
    );

    assert.ok(result);
    assert.ok(result.fileChanges.has(MANIFEST_FILENAME));
    assert.equal(result.changedFiles.length, 1);
    assert.equal(
      result.commitMessage,
      "chore: update manifest with ruleset tracking"
    );
    assert.equal(result.fileChangeDetails.length, 1);
  });

  test("logs dry-run message when dryRun is true", async () => {
    const { mock: mockLogger, calls } = createMockLogger();
    const strategy = new ManifestStrategy(
      { rulesets: ["new-ruleset"] },
      mockLogger
    );

    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: true,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    await strategy.execute(mockRepoConfig, mockRepoInfo, session, {
      branchName: "test",
      workDir,
      configId: "test-config",
      dryRun: true,
    });

    const infoMessages = calls.info.map((c) => c[0]);
    assert.ok(
      infoMessages.some((m) => m.includes("Would update")),
      `Expected dry-run message, got: ${infoMessages.join(", ")}`
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "ManifestStrategy"`
Expected: FAIL with "Cannot find module"

**Step 3: Create manifest-strategy.ts**

```typescript
// src/sync/manifest-strategy.ts
import type { RepoConfig } from "../config/types.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
import {
  loadManifest,
  saveManifest,
  updateManifestRulesets,
  MANIFEST_FILENAME,
} from "./manifest.js";
import type {
  IWorkStrategy,
  WorkResult,
  SessionContext,
  ProcessorOptions,
  FileWriteResult,
} from "./types.js";

/**
 * Parameters for manifest-only updates
 */
export interface ManifestUpdateParams {
  rulesets: string[];
}

/**
 * Strategy that only updates the manifest with ruleset tracking.
 * Used by updateManifestOnly() for settings command ruleset sync.
 */
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
    const { workDir, dryRun, configId } = options;

    // Load and update manifest
    const existingManifest = loadManifest(workDir);
    const rulesetsWithDeleteOrphaned = new Map<string, boolean | undefined>(
      this.params.rulesets.map((name) => [name, true])
    );
    const { manifest: newManifest } = updateManifestRulesets(
      existingManifest,
      configId,
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

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "ManifestStrategy"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sync/manifest-strategy.ts test/unit/sync/manifest-strategy.test.ts
git commit -m "$(cat <<'EOF'
feat(sync): add ManifestStrategy for manifest-only updates

Implements IWorkStrategy for ruleset manifest tracking.
Used by updateManifestOnly() method.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create SyncWorkflow

**Files:**

- Create: `src/sync/sync-workflow.ts`
- Create: `test/unit/sync/sync-workflow.test.ts`

**Step 1: Write failing tests for SyncWorkflow**

```typescript
// test/unit/sync/sync-workflow.test.ts
import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyncWorkflow } from "../../../src/sync/sync-workflow.js";
import type {
  IAuthOptionsBuilder,
  IRepositorySession,
  IBranchManager,
  ICommitPushManager,
  IPRMergeHandler,
  IWorkStrategy,
  WorkResult,
  SessionContext,
  ProcessorOptions,
} from "../../../src/sync/index.js";
import type { RepoConfig } from "../../../src/config/index.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import {
  createMockLogger,
  createMockAuthenticatedGitOps,
  createMockExecutor,
} from "../../mocks/index.js";

describe("SyncWorkflow", () => {
  const testDir = join(tmpdir(), `sync-workflow-test-${Date.now()}`);
  let workDir: string;

  const mockRepoConfig: RepoConfig = {
    git: "git@github.com:test/repo.git",
    files: [],
  };

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

  function createMockComponents() {
    const { mock: mockLogger } = createMockLogger();
    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: true,
    });
    let cleanupCalled = false;

    const authOptionsBuilder: IAuthOptionsBuilder = {
      async resolve() {
        return { token: "test-token", authOptions: {} };
      },
    };

    const repositorySession: IRepositorySession = {
      async setup() {
        return {
          gitOps: mockGitOps,
          baseBranch: "main",
          cleanup: () => {
            cleanupCalled = true;
          },
        };
      },
    };

    const branchManager: IBranchManager = {
      async setupBranch() {},
    };

    const commitPushManager: ICommitPushManager = {
      async commitAndPush() {
        return { success: true };
      },
    };

    const prMergeHandler: IPRMergeHandler = {
      async createAndMerge() {
        return {
          success: true,
          repoName: "test/repo",
          message: "PR created",
          prUrl: "https://github.com/test/repo/pull/1",
        };
      },
    };

    return {
      mockLogger,
      authOptionsBuilder,
      repositorySession,
      branchManager,
      commitPushManager,
      prMergeHandler,
      wasCleanupCalled: () => cleanupCalled,
    };
  }

  test("returns skip result when auth fails", async () => {
    const components = createMockComponents();
    components.authOptionsBuilder.resolve = async () => ({
      skipResult: {
        success: true,
        repoName: "test/repo",
        message: "No installation found",
        skipped: true,
      },
    });

    const { mock: mockLogger } = createMockLogger();
    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      mockLogger
    );

    const mockStrategy: IWorkStrategy = {
      async execute() {
        return null;
      },
    };

    const result = await workflow.execute(
      mockRepoConfig,
      mockRepoInfo,
      { branchName: "test", workDir, configId: "test" },
      mockStrategy
    );

    assert.equal(result.skipped, true);
    assert.equal(result.message, "No installation found");
  });

  test("returns skip result when strategy returns null", async () => {
    const components = createMockComponents();
    const { mock: mockLogger } = createMockLogger();

    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      mockLogger
    );

    const mockStrategy: IWorkStrategy = {
      async execute() {
        return null;
      },
    };

    const result = await workflow.execute(
      mockRepoConfig,
      mockRepoInfo,
      { branchName: "test", workDir, configId: "test" },
      mockStrategy
    );

    assert.equal(result.skipped, true);
    assert.equal(result.message, "No changes detected");
  });

  test("creates PR when changes exist and not direct mode", async () => {
    const components = createMockComponents();
    const { mock: mockLogger } = createMockLogger();

    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      mockLogger
    );

    const workResult: WorkResult = {
      fileChanges: new Map([
        [
          "test.txt",
          { fileName: "test.txt", content: "test", action: "create" },
        ],
      ]),
      changedFiles: [{ fileName: "test.txt", action: "create" }],
      commitMessage: "test commit",
      fileChangeDetails: [{ path: "test.txt", action: "create" }],
    };

    const mockStrategy: IWorkStrategy = {
      async execute() {
        return workResult;
      },
    };

    const result = await workflow.execute(
      mockRepoConfig,
      mockRepoInfo,
      { branchName: "test", workDir, configId: "test" },
      mockStrategy
    );

    assert.equal(result.success, true);
    assert.equal(result.prUrl, "https://github.com/test/repo/pull/1");
  });

  test("pushes directly when direct mode", async () => {
    const components = createMockComponents();
    const { mock: mockLogger, calls } = createMockLogger();

    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      mockLogger
    );

    const workResult: WorkResult = {
      fileChanges: new Map([
        [
          "test.txt",
          { fileName: "test.txt", content: "test", action: "create" },
        ],
      ]),
      changedFiles: [{ fileName: "test.txt", action: "create" }],
      commitMessage: "test commit",
      fileChangeDetails: [{ path: "test.txt", action: "create" }],
    };

    const mockStrategy: IWorkStrategy = {
      async execute() {
        return workResult;
      },
    };

    const repoConfigDirect: RepoConfig = {
      ...mockRepoConfig,
      prOptions: { merge: "direct" },
    };

    const result = await workflow.execute(
      repoConfigDirect,
      mockRepoInfo,
      { branchName: "test", workDir, configId: "test" },
      mockStrategy
    );

    assert.equal(result.success, true);
    assert.ok(result.message.includes("directly"));
    const infoMessages = calls.info.map((c) => c[0]);
    assert.ok(infoMessages.some((m) => m.includes("pushed directly")));
  });

  test("calls cleanup in finally block", async () => {
    const components = createMockComponents();
    const { mock: mockLogger } = createMockLogger();

    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      mockLogger
    );

    const mockStrategy: IWorkStrategy = {
      async execute() {
        throw new Error("Intentional test error");
      },
    };

    try {
      await workflow.execute(
        mockRepoConfig,
        mockRepoInfo,
        { branchName: "test", workDir, configId: "test" },
        mockStrategy
      );
    } catch {
      // Expected error
    }

    assert.equal(components.wasCleanupCalled(), true);
  });

  test("returns skip when commit skipped (no changes after staging)", async () => {
    const components = createMockComponents();
    components.commitPushManager.commitAndPush = async () => ({
      success: true,
      skipped: true,
    });

    const { mock: mockLogger } = createMockLogger();

    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      mockLogger
    );

    const workResult: WorkResult = {
      fileChanges: new Map(),
      changedFiles: [],
      commitMessage: "test",
      fileChangeDetails: [],
      diffStats: { additions: 0, deletions: 0, modifications: 0 },
    };

    const mockStrategy: IWorkStrategy = {
      async execute() {
        return workResult;
      },
    };

    const result = await workflow.execute(
      mockRepoConfig,
      mockRepoInfo,
      { branchName: "test", workDir, configId: "test" },
      mockStrategy
    );

    assert.equal(result.skipped, true);
    assert.ok(result.message.includes("No changes detected after staging"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "SyncWorkflow"`
Expected: FAIL with "Cannot find module"

**Step 3: Create sync-workflow.ts**

```typescript
// src/sync/sync-workflow.ts
import type { RepoConfig } from "../config/types.js";
import { RepoInfo, getRepoDisplayName } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
import { defaultExecutor } from "../shared/command-executor.js";
import type {
  ISyncWorkflow,
  IWorkStrategy,
  IAuthOptionsBuilder,
  IRepositorySession,
  IBranchManager,
  ICommitPushManager,
  IPRMergeHandler,
  ProcessorOptions,
  ProcessorResult,
  SessionContext,
} from "./types.js";

/**
 * Orchestrates the common sync workflow steps.
 * Used by RepositoryProcessor with different strategies for file sync vs manifest.
 */
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

      // Step 8: Handle commit errors
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

      // Step 9: Direct mode - done
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

      // Step 10: Create and merge PR
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
      try {
        session?.cleanup();
      } catch {
        // Ignore cleanup errors - best effort
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "SyncWorkflow"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sync/sync-workflow.ts test/unit/sync/sync-workflow.test.ts
git commit -m "$(cat <<'EOF'
feat(sync): add SyncWorkflow for common orchestration

Extracts the common 10-step workflow from process() and
updateManifestOnly(). Uses Strategy pattern injection
for the differing work step.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Export New Components

**Files:**

- Modify: `src/sync/index.ts`

**Step 1: Add exports for new strategy and workflow classes**

Add to `src/sync/index.ts`:

```typescript
// Strategy pattern components
export { FileSyncStrategy } from "./file-sync-strategy.js";
export {
  ManifestStrategy,
  type ManifestUpdateParams,
} from "./manifest-strategy.js";
export { SyncWorkflow } from "./sync-workflow.js";
```

**Step 2: Run type check**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/sync/index.ts
git commit -m "$(cat <<'EOF'
chore(sync): export strategy pattern components

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Refactor RepositoryProcessor

**Files:**

- Modify: `src/sync/repository-processor.ts`
- Modify: `test/unit/repository-processor.test.ts` (may need updates)

**Step 1: Run existing tests to establish baseline**

Run: `npm test -- --test-name-pattern "RepositoryProcessor"`
Expected: PASS (all existing tests)

**Step 2: Refactor repository-processor.ts to use SyncWorkflow**

Replace entire `src/sync/repository-processor.ts`:

```typescript
import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import { GitOps } from "../vcs/git-ops.js";
import { AuthenticatedGitOps } from "../vcs/authenticated-git-ops.js";
import { logger, ILogger } from "../shared/logger.js";
import { hasGitHubAppCredentials } from "../vcs/index.js";
import { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";
import {
  FileWriter,
  ManifestManager,
  BranchManager,
  AuthOptionsBuilder,
  RepositorySession,
  CommitPushManager,
  FileSyncOrchestrator,
  PRMergeHandler,
  FileSyncStrategy,
  ManifestStrategy,
  SyncWorkflow,
  type IFileWriter,
  type IManifestManager,
  type IBranchManager,
  type IAuthOptionsBuilder,
  type IRepositorySession,
  type ICommitPushManager,
  type IFileSyncOrchestrator,
  type IPRMergeHandler,
  type ISyncWorkflow,
  type IRepositoryProcessor,
  type GitOpsFactory,
  type ProcessorOptions,
  type ProcessorResult,
} from "./index.js";

/**
 * Thin facade that delegates to SyncWorkflow with appropriate strategy.
 * process() uses FileSyncStrategy, updateManifestOnly() uses ManifestStrategy.
 */
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

    // Initialize token manager for auth builder
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

**Step 3: Run tests to verify behavior unchanged**

Run: `npm test -- --test-name-pattern "RepositoryProcessor"`
Expected: PASS (all existing tests still pass)

**Step 4: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 5: Run linting**

Run: `./lint.sh`
Expected: PASS

**Step 6: Count lines**

Run: `wc -l src/sync/repository-processor.ts`
Expected: ~85 lines (target <100)

**Step 7: Commit**

```bash
git add src/sync/repository-processor.ts
git commit -m "$(cat <<'EOF'
refactor(sync): RepositoryProcessor to thin facade

Reduces repository-processor.ts from 438 to ~85 lines by:
- Delegating to SyncWorkflow for common orchestration
- Using FileSyncStrategy for process()
- Using ManifestStrategy for updateManifestOnly()

Closes #451 DRY goal - eliminates duplicate workflow code.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final Verification

**Files:**

- None (verification only)

**Step 1: Run full test suite**

Run: `npm test`
Expected: PASS (all tests)

**Step 2: Run linting**

Run: `./lint.sh`
Expected: PASS (no errors)

**Step 3: Build project**

Run: `npm run build`
Expected: PASS (compiles without errors)

**Step 4: Verify line counts**

Run:

```bash
echo "repository-processor.ts: $(wc -l < src/sync/repository-processor.ts) lines"
echo "sync-workflow.ts: $(wc -l < src/sync/sync-workflow.ts) lines"
echo "file-sync-strategy.ts: $(wc -l < src/sync/file-sync-strategy.ts) lines"
echo "manifest-strategy.ts: $(wc -l < src/sync/manifest-strategy.ts) lines"
```

Expected:

- repository-processor.ts: ~85 lines (was 438, target <100)
- sync-workflow.ts: ~100 lines
- file-sync-strategy.ts: ~35 lines
- manifest-strategy.ts: ~55 lines

**Step 5: Review acceptance criteria**

- [ ] All existing tests pass
- [ ] `repository-processor.ts` < 100 lines
- [ ] No duplication between `process()` and `updateManifestOnly()`
- [ ] Each new component has unit tests
- [ ] Linting passes
- [ ] Public interface `IRepositoryProcessor` unchanged

---

## Summary

| Task | Description                  | Est. Time |
| ---- | ---------------------------- | --------- |
| 1    | Add interfaces to types.ts   | 5 min     |
| 2    | Update index.ts exports      | 2 min     |
| 3    | Create FileSyncStrategy      | 10 min    |
| 4    | Create ManifestStrategy      | 10 min    |
| 5    | Create SyncWorkflow          | 15 min    |
| 6    | Export new components        | 2 min     |
| 7    | Refactor RepositoryProcessor | 10 min    |
| 8    | Final verification           | 5 min     |

**Total estimated time:** ~60 minutes
