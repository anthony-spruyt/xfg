# Split repository-processor.ts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the 894-line `repository-processor.ts` God class into focused components (FileWriter, ManifestManager, BranchManager) with the orchestrator under 450 lines.

**Architecture:** Extract cohesive responsibilities into single-purpose classes injected into RepositoryProcessor. Each component handles one concern: FileWriter manages file operations and templating, ManifestManager tracks managed files for orphan deletion, BranchManager handles branch/PR lifecycle.

**Tech Stack:** TypeScript, Node.js test runner, existing mock infrastructure

---

## Task 1: Create FileWriter Interface and Types

**Files:**

- Create: `src/sync/types.ts`

**Step 1: Write the types file**

```typescript
import type { ContentValue, FileContent } from "../config/types.js";
import type { RepoInfo } from "../repo-detector.js";
import type { IAuthenticatedGitOps } from "../authenticated-git-ops.js";
import type { DiffStats } from "../diff-utils.js";
import type { ILogger } from "../logger.js";

/**
 * Result of processing a single file
 */
export interface FileWriteResult {
  fileName: string;
  content: string | null;
  action: "create" | "update" | "delete" | "skip";
}

/**
 * Context for file writing operations
 */
export interface FileWriteContext {
  repoInfo: RepoInfo;
  baseBranch: string;
  workDir: string;
  dryRun: boolean;
  noDelete: boolean;
  configId: string;
}

/**
 * Dependencies for FileWriter
 */
export interface FileWriterDeps {
  gitOps: IAuthenticatedGitOps;
  log: ILogger;
}

/**
 * Result of writing all files
 */
export interface FileWriteAllResult {
  fileChanges: Map<string, FileWriteResult>;
  diffStats: DiffStats;
}

/**
 * Interface for file writing operations
 */
export interface IFileWriter {
  /**
   * Write all files from config to repository
   */
  writeFiles(
    files: FileContent[],
    ctx: FileWriteContext,
    deps: FileWriterDeps
  ): Promise<FileWriteAllResult>;
}
```

**Step 2: Verify file compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/sync/types.ts
git commit -m "feat(sync): add FileWriter types"
```

---

## Task 2: Create FileWriter Test File (Red Phase)

**Files:**

- Create: `test/unit/sync/file-writer.test.ts`

**Step 1: Write the failing test**

```typescript
import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileWriter } from "../../../src/sync/file-writer.js";
import { createMockAuthenticatedGitOps } from "../../mocks/index.js";
import { createMockLogger } from "../../mocks/index.js";
import type { FileContent } from "../../../src/config/types.js";
import type { GitHubRepoInfo } from "../../../src/repo-detector.js";

const testDir = join(tmpdir(), "file-writer-test-" + Date.now());

describe("FileWriter", () => {
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

  describe("shouldBeExecutable", () => {
    test("returns true for .sh files by default", () => {
      const result = FileWriter.shouldBeExecutable({
        fileName: "script.sh",
        content: "#!/bin/bash",
      });
      assert.equal(result, true);
    });

    test("returns false for non-.sh files by default", () => {
      const result = FileWriter.shouldBeExecutable({
        fileName: "config.json",
        content: { key: "value" },
      });
      assert.equal(result, false);
    });

    test("respects explicit executable: true", () => {
      const result = FileWriter.shouldBeExecutable({
        fileName: "config.json",
        content: { key: "value" },
        executable: true,
      });
      assert.equal(result, true);
    });

    test("respects explicit executable: false for .sh", () => {
      const result = FileWriter.shouldBeExecutable({
        fileName: "script.sh",
        content: "#!/bin/bash",
        executable: false,
      });
      assert.equal(result, false);
    });
  });

  describe("writeFiles", () => {
    test("skips file when createOnly and file exists on base branch", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExistsOnBranch: true,
        fileExists: true,
        wouldChange: true,
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "existing.json",
          content: { key: "value" },
          createOnly: true,
        },
      ];

      const result = await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: false,
          noDelete: false,
          configId: "test",
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
        }
      );

      const fileResult = result.fileChanges.get("existing.json");
      assert.equal(fileResult?.action, "skip");
    });

    test("writes file and returns create action for new files", async () => {
      const writtenFiles: Array<{ fileName: string; content: string }> = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        onWriteFile: (fileName, content) => {
          writtenFiles.push({ fileName, content });
        },
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "new.json",
          content: { key: "value" },
        },
      ];

      const result = await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: false,
          noDelete: false,
          configId: "test",
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
        }
      );

      const fileResult = result.fileChanges.get("new.json");
      assert.equal(fileResult?.action, "create");
      assert.equal(writtenFiles.length, 1);
    });

    test("applies xfg template interpolation when template: true", async () => {
      const writtenFiles: Array<{ fileName: string; content: string }> = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        onWriteFile: (fileName, content) => {
          writtenFiles.push({ fileName, content });
        },
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "readme.md",
          content: "# ${xfg:repo.name}",
          template: true,
        },
      ];

      const result = await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: false,
          noDelete: false,
          configId: "test",
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
        }
      );

      assert.equal(writtenFiles[0]?.content, "# repo");
    });

    test("does not write files in dryRun mode", async () => {
      const writtenFiles: Array<{ fileName: string; content: string }> = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        onWriteFile: (fileName, content) => {
          writtenFiles.push({ fileName, content });
        },
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "new.json",
          content: { key: "value" },
        },
      ];

      await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: true,
          noDelete: false,
          configId: "test",
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
        }
      );

      assert.equal(writtenFiles.length, 0);
    });

    test("sets executable permission for .sh files", async () => {
      const executableFiles: string[] = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        onSetExecutable: (fileName) => {
          executableFiles.push(fileName);
        },
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "script.sh",
          content: "#!/bin/bash\necho hello",
        },
      ];

      await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: false,
          noDelete: false,
          configId: "test",
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
        }
      );

      assert.equal(executableFiles.length, 1);
      assert.equal(executableFiles[0], "script.sh");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="FileWriter"`
Expected: FAIL with "Cannot find module '../../../src/sync/file-writer.js'"

**Step 3: Commit failing test**

```bash
git add test/unit/sync/file-writer.test.ts
git commit -m "test(sync): add FileWriter tests (red phase)"
```

---

## Task 3: Implement FileWriter (Green Phase)

**Files:**

- Create: `src/sync/file-writer.ts`

**Step 1: Write the implementation**

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FileContent, ContentValue } from "../config/types.js";
import { convertContentToString } from "../config.js";
import { interpolateXfgContent } from "../xfg-template.js";
import {
  getFileStatus,
  generateDiff,
  createDiffStats,
  incrementDiffStats,
} from "../diff-utils.js";
import type {
  IFileWriter,
  FileWriteContext,
  FileWriterDeps,
  FileWriteAllResult,
  FileWriteResult,
} from "./types.js";

/**
 * Determines if a file should be marked as executable.
 * .sh files are auto-executable unless explicit executable: false is set.
 * Non-.sh files are executable only if executable: true is explicitly set.
 */
export function shouldBeExecutable(file: FileContent): boolean {
  const isShellScript = file.fileName.endsWith(".sh");

  if (file.executable !== undefined) {
    // Explicit setting takes precedence
    return file.executable;
  }

  // Default: .sh files are executable, others are not
  return isShellScript;
}

/**
 * Handles file writing, template interpolation, and executable permissions.
 */
export class FileWriter implements IFileWriter {
  /**
   * Static method for checking executable status (for external use)
   */
  static shouldBeExecutable = shouldBeExecutable;

  async writeFiles(
    files: FileContent[],
    ctx: FileWriteContext,
    deps: FileWriterDeps
  ): Promise<FileWriteAllResult> {
    const { repoInfo, baseBranch, workDir, dryRun } = ctx;
    const { gitOps, log } = deps;

    const fileChanges = new Map<string, FileWriteResult>();
    const diffStats = createDiffStats();

    // Step 1: Process each file
    for (const file of files) {
      const filePath = join(workDir, file.fileName);
      const fileExistsLocal = existsSync(filePath);

      // Handle createOnly - check against BASE branch
      if (file.createOnly) {
        const existsOnBase = await gitOps.fileExistsOnBranch(
          file.fileName,
          baseBranch
        );
        if (existsOnBase) {
          log.info(
            `Skipping ${file.fileName} (createOnly: exists on ${baseBranch})`
          );
          fileChanges.set(file.fileName, {
            fileName: file.fileName,
            content: null,
            action: "skip",
          });
          continue;
        }
      }

      log.info(`Writing ${file.fileName}...`);

      // Apply xfg templating if enabled
      let contentToWrite: ContentValue | null = file.content;
      if (file.template && contentToWrite !== null) {
        contentToWrite = interpolateXfgContent(
          contentToWrite,
          {
            repoInfo,
            fileName: file.fileName,
            vars: file.vars,
          },
          { strict: true }
        );
      }

      const fileContent = convertContentToString(
        contentToWrite,
        file.fileName,
        {
          header: file.header,
          schemaUrl: file.schemaUrl,
        }
      );

      // Determine action type (create vs update) BEFORE writing
      const action: "create" | "update" = fileExistsLocal ? "update" : "create";

      // Check if file would change
      const existingContent = gitOps.getFileContent(file.fileName);
      const changed = gitOps.wouldChange(file.fileName, fileContent);

      if (changed) {
        fileChanges.set(file.fileName, {
          fileName: file.fileName,
          content: fileContent,
          action,
        });
      }

      if (dryRun) {
        // In dry-run, show diff but don't write
        const status = getFileStatus(existingContent !== null, changed);
        incrementDiffStats(diffStats, status);

        const diffLines = generateDiff(
          existingContent,
          fileContent,
          file.fileName
        );
        log.fileDiff(file.fileName, status, diffLines);
      } else {
        // Write the file
        gitOps.writeFile(file.fileName, fileContent);
      }
    }

    // Step 2: Set executable permissions (skip skipped files)
    for (const file of files) {
      const tracked = fileChanges.get(file.fileName);
      if (tracked?.action === "skip") {
        continue;
      }

      if (shouldBeExecutable(file)) {
        log.info(`Setting executable: ${file.fileName}`);
        await gitOps.setExecutable(file.fileName);
      }
    }

    return { fileChanges, diffStats };
  }
}
```

**Step 2: Update sync/index.ts to export FileWriter**

Create `src/sync/index.ts`:

```typescript
export { FileWriter, shouldBeExecutable } from "./file-writer.js";
export type {
  IFileWriter,
  FileWriteContext,
  FileWriterDeps,
  FileWriteAllResult,
  FileWriteResult,
} from "./types.js";
```

**Step 3: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="FileWriter"`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/sync/file-writer.ts src/sync/index.ts
git commit -m "feat(sync): implement FileWriter"
```

---

## Task 4: Create ManifestManager Test File (Red Phase)

**Files:**

- Create: `test/unit/sync/manifest-manager.test.ts`

**Step 1: Write the failing test**

```typescript
import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManifestManager } from "../../../src/sync/manifest-manager.js";
import {
  createMockAuthenticatedGitOps,
  createMockLogger,
} from "../../mocks/index.js";
import type { FileWriteResult } from "../../../src/sync/types.js";
import { MANIFEST_FILENAME } from "../../../src/manifest.js";

const testDir = join(tmpdir(), "manifest-manager-test-" + Date.now());

describe("ManifestManager", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("processOrphans", () => {
    test("identifies orphaned files from previous manifest", () => {
      // Setup: Create a manifest with a file that's no longer in config
      const manifest = {
        version: 3,
        configs: {
          "test-config": {
            files: ["old-file.json", "current-file.json"],
          },
        },
      };
      writeFileSync(
        join(workDir, MANIFEST_FILENAME),
        JSON.stringify(manifest, null, 2)
      );

      const manager = new ManifestManager();
      const currentFiles = new Map<string, boolean | undefined>([
        ["current-file.json", true],
      ]);

      const result = manager.processOrphans(
        workDir,
        "test-config",
        currentFiles
      );

      assert.deepEqual(result.filesToDelete, ["old-file.json"]);
    });

    test("returns empty array when no orphans", () => {
      const manifest = {
        version: 3,
        configs: {
          "test-config": {
            files: ["file.json"],
          },
        },
      };
      writeFileSync(
        join(workDir, MANIFEST_FILENAME),
        JSON.stringify(manifest, null, 2)
      );

      const manager = new ManifestManager();
      const currentFiles = new Map<string, boolean | undefined>([
        ["file.json", true],
      ]);

      const result = manager.processOrphans(
        workDir,
        "test-config",
        currentFiles
      );

      assert.deepEqual(result.filesToDelete, []);
    });

    test("handles missing manifest gracefully", () => {
      const manager = new ManifestManager();
      const currentFiles = new Map<string, boolean | undefined>([
        ["file.json", true],
      ]);

      const result = manager.processOrphans(
        workDir,
        "test-config",
        currentFiles
      );

      assert.deepEqual(result.filesToDelete, []);
    });
  });

  describe("deleteOrphans", () => {
    test("deletes files that exist and tracks in fileChanges", async () => {
      const deletedFiles: string[] = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: (fileName) => fileName === "orphan.json",
        onDeleteFile: (fileName) => deletedFiles.push(fileName),
      });
      const { mock: mockLogger } = createMockLogger();

      const manager = new ManifestManager();
      const fileChanges = new Map<string, FileWriteResult>();

      await manager.deleteOrphans(
        ["orphan.json", "nonexistent.json"],
        {
          dryRun: false,
          noDelete: false,
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
          fileChanges,
        }
      );

      assert.equal(deletedFiles.length, 1);
      assert.equal(deletedFiles[0], "orphan.json");
      assert.equal(fileChanges.get("orphan.json")?.action, "delete");
    });

    test("does not delete when noDelete is true", async () => {
      const deletedFiles: string[] = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: () => true,
        onDeleteFile: (fileName) => deletedFiles.push(fileName),
      });
      const { mock: mockLogger } = createMockLogger();

      const manager = new ManifestManager();
      const fileChanges = new Map<string, FileWriteResult>();

      await manager.deleteOrphans(
        ["orphan.json"],
        {
          dryRun: false,
          noDelete: true,
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
          fileChanges,
        }
      );

      assert.equal(deletedFiles.length, 0);
    });
  });

  describe("saveManifest", () => {
    test("saves manifest and tracks change in fileChanges", () => {
      const manager = new ManifestManager();
      const fileChanges = new Map<string, FileWriteResult>();
      const manifest = {
        version: 3 as const,
        configs: {
          "test-config": { files: ["file.json"] },
        },
      };

      manager.saveUpdatedManifest(workDir, manifest, null, false, fileChanges);

      assert.equal(existsSync(join(workDir, MANIFEST_FILENAME)), true);
      assert.equal(fileChanges.get(MANIFEST_FILENAME)?.action, "create");
    });

    test("does not save in dryRun mode", () => {
      const manager = new ManifestManager();
      const fileChanges = new Map<string, FileWriteResult>();
      const manifest = {
        version: 3 as const,
        configs: {
          "test-config": { files: ["file.json"] },
        },
      };

      manager.saveUpdatedManifest(workDir, manifest, null, true, fileChanges);

      assert.equal(existsSync(join(workDir, MANIFEST_FILENAME)), false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="ManifestManager"`
Expected: FAIL with "Cannot find module '../../../src/sync/manifest-manager.js'"

**Step 3: Commit failing test**

```bash
git add test/unit/sync/manifest-manager.test.ts
git commit -m "test(sync): add ManifestManager tests (red phase)"
```

---

## Task 5: Implement ManifestManager (Green Phase)

**Files:**

- Create: `src/sync/manifest-manager.ts`
- Modify: `src/sync/types.ts`
- Modify: `src/sync/index.ts`

**Step 1: Add ManifestManager types to types.ts**

Add to `src/sync/types.ts`:

```typescript
import type { XfgManifest } from "../manifest.js";

/**
 * Result of processing orphans
 */
export interface OrphanProcessResult {
  manifest: XfgManifest;
  filesToDelete: string[];
}

/**
 * Options for orphan deletion
 */
export interface OrphanDeleteOptions {
  dryRun: boolean;
  noDelete: boolean;
}

/**
 * Dependencies for orphan deletion
 */
export interface OrphanDeleteDeps {
  gitOps: IAuthenticatedGitOps;
  log: ILogger;
  fileChanges: Map<string, FileWriteResult>;
}

/**
 * Interface for manifest management operations
 */
export interface IManifestManager {
  /**
   * Process manifest to find orphaned files
   */
  processOrphans(
    workDir: string,
    configId: string,
    filesWithDeleteOrphaned: Map<string, boolean | undefined>
  ): OrphanProcessResult;

  /**
   * Delete orphaned files
   */
  deleteOrphans(
    filesToDelete: string[],
    options: OrphanDeleteOptions,
    deps: OrphanDeleteDeps
  ): Promise<void>;

  /**
   * Save updated manifest
   */
  saveUpdatedManifest(
    workDir: string,
    manifest: XfgManifest,
    existingManifest: XfgManifest | null,
    dryRun: boolean,
    fileChanges: Map<string, FileWriteResult>
  ): void;
}
```

**Step 2: Implement ManifestManager**

Create `src/sync/manifest-manager.ts`:

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadManifest,
  saveManifest,
  updateManifest,
  MANIFEST_FILENAME,
  type XfgManifest,
} from "../manifest.js";
import { incrementDiffStats, type DiffStats } from "../diff-utils.js";
import type {
  IManifestManager,
  OrphanProcessResult,
  OrphanDeleteOptions,
  OrphanDeleteDeps,
  FileWriteResult,
} from "./types.js";

/**
 * Handles manifest loading, saving, and orphan detection.
 */
export class ManifestManager implements IManifestManager {
  processOrphans(
    workDir: string,
    configId: string,
    filesWithDeleteOrphaned: Map<string, boolean | undefined>
  ): OrphanProcessResult {
    const existingManifest = loadManifest(workDir);

    const { manifest, filesToDelete } = updateManifest(
      existingManifest,
      configId,
      filesWithDeleteOrphaned
    );

    return { manifest, filesToDelete };
  }

  async deleteOrphans(
    filesToDelete: string[],
    options: OrphanDeleteOptions,
    deps: OrphanDeleteDeps
  ): Promise<void> {
    const { dryRun, noDelete } = options;
    const { gitOps, log, fileChanges } = deps;

    if (filesToDelete.length === 0) {
      return;
    }

    if (noDelete) {
      log.info(
        `Skipping deletion of ${filesToDelete.length} orphaned file(s) (--no-delete flag)`
      );
      return;
    }

    for (const fileName of filesToDelete) {
      // Only delete if file actually exists in the working directory
      if (!gitOps.fileExists(fileName)) {
        continue;
      }

      fileChanges.set(fileName, {
        fileName,
        content: null,
        action: "delete",
      });

      if (dryRun) {
        log.fileDiff(fileName, "DELETED", []);
      } else {
        log.info(`Deleting orphaned file: ${fileName}`);
        gitOps.deleteFile(fileName);
      }
    }
  }

  saveUpdatedManifest(
    workDir: string,
    manifest: XfgManifest,
    existingManifest: XfgManifest | null,
    dryRun: boolean,
    fileChanges: Map<string, FileWriteResult>
  ): void {
    // Check if manifest changed
    const existingConfigs = existingManifest?.configs ?? {};
    const manifestChanged =
      JSON.stringify(existingConfigs) !== JSON.stringify(manifest.configs);

    if (!manifestChanged) {
      return;
    }

    const hasAnyManagedFiles = Object.keys(manifest.configs).length > 0;
    if (!hasAnyManagedFiles && existingManifest === null) {
      return;
    }

    const manifestExisted = existsSync(join(workDir, MANIFEST_FILENAME));
    const manifestContent = JSON.stringify(manifest, null, 2) + "\n";

    fileChanges.set(MANIFEST_FILENAME, {
      fileName: MANIFEST_FILENAME,
      content: manifestContent,
      action: manifestExisted ? "update" : "create",
    });

    if (!dryRun) {
      saveManifest(workDir, manifest);
    }
  }
}
```

**Step 3: Update sync/index.ts**

Add to `src/sync/index.ts`:

```typescript
export { ManifestManager } from "./manifest-manager.js";
export type {
  IManifestManager,
  OrphanProcessResult,
  OrphanDeleteOptions,
  OrphanDeleteDeps,
} from "./types.js";
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="ManifestManager"`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/sync/manifest-manager.ts src/sync/types.ts src/sync/index.ts
git commit -m "feat(sync): implement ManifestManager"
```

---

## Task 6: Create BranchManager Test File (Red Phase)

**Files:**

- Create: `test/unit/sync/branch-manager.test.ts`

**Step 1: Write the failing test**

```typescript
import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BranchManager } from "../../../src/sync/branch-manager.js";
import {
  createMockAuthenticatedGitOps,
  createMockLogger,
  createMockExecutor,
} from "../../mocks/index.js";
import type { GitHubRepoInfo } from "../../../src/repo-detector.js";

const testDir = join(tmpdir(), "branch-manager-test-" + Date.now());

describe("BranchManager", () => {
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

  describe("setupBranch", () => {
    test("creates branch for non-direct mode", async () => {
      const createdBranches: string[] = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      mockGitOps.createBranch = async (branchName: string) => {
        createdBranches.push(branchName);
      };
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({});

      const manager = new BranchManager();
      await manager.setupBranch({
        repoInfo: mockRepoInfo,
        branchName: "chore/sync-config",
        baseBranch: "main",
        workDir,
        isDirectMode: false,
        dryRun: false,
        retries: 3,
        gitOps: mockGitOps,
        log: mockLogger,
        executor: mockExecutor,
      });

      assert.equal(createdBranches.length, 1);
      assert.equal(createdBranches[0], "chore/sync-config");
    });

    test("skips branch creation for direct mode", async () => {
      const createdBranches: string[] = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      mockGitOps.createBranch = async (branchName: string) => {
        createdBranches.push(branchName);
      };
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({});

      const manager = new BranchManager();
      await manager.setupBranch({
        repoInfo: mockRepoInfo,
        branchName: "chore/sync-config",
        baseBranch: "main",
        workDir,
        isDirectMode: true,
        dryRun: false,
        retries: 3,
        gitOps: mockGitOps,
        log: mockLogger,
        executor: mockExecutor,
      });

      assert.equal(createdBranches.length, 0);
    });

    test("skips PR cleanup in dryRun mode", async () => {
      const fetchCalls: Array<{ prune?: boolean }> = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      mockGitOps.fetch = async (options?: { prune?: boolean }) => {
        fetchCalls.push({ prune: options?.prune });
      };
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({});

      const manager = new BranchManager();
      await manager.setupBranch({
        repoInfo: mockRepoInfo,
        branchName: "chore/sync-config",
        baseBranch: "main",
        workDir,
        isDirectMode: false,
        dryRun: true,
        retries: 3,
        gitOps: mockGitOps,
        log: mockLogger,
        executor: mockExecutor,
      });

      // Should not have fetched with prune (which happens after PR cleanup)
      const pruneFetches = fetchCalls.filter((c) => c.prune === true);
      assert.equal(pruneFetches.length, 0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="BranchManager"`
Expected: FAIL with "Cannot find module '../../../src/sync/branch-manager.js'"

**Step 3: Commit failing test**

```bash
git add test/unit/sync/branch-manager.test.ts
git commit -m "test(sync): add BranchManager tests (red phase)"
```

---

## Task 7: Implement BranchManager (Green Phase)

**Files:**

- Create: `src/sync/branch-manager.ts`
- Modify: `src/sync/types.ts`
- Modify: `src/sync/index.ts`

**Step 1: Add BranchManager types to types.ts**

Add to `src/sync/types.ts`:

```typescript
import type { ICommandExecutor } from "../command-executor.js";

/**
 * Options for branch setup
 */
export interface BranchSetupOptions {
  repoInfo: RepoInfo;
  branchName: string;
  baseBranch: string;
  workDir: string;
  isDirectMode: boolean;
  dryRun: boolean;
  retries: number;
  token?: string;
  gitOps: IAuthenticatedGitOps;
  log: ILogger;
  executor: ICommandExecutor;
}

/**
 * Interface for branch management operations
 */
export interface IBranchManager {
  /**
   * Setup branch for sync (close existing PR, create fresh branch)
   */
  setupBranch(options: BranchSetupOptions): Promise<void>;
}
```

**Step 2: Implement BranchManager**

Create `src/sync/branch-manager.ts`:

```typescript
import { getPRStrategy } from "../strategies/index.js";
import type { IBranchManager, BranchSetupOptions } from "./types.js";

/**
 * Handles branch creation and existing PR cleanup.
 */
export class BranchManager implements IBranchManager {
  async setupBranch(options: BranchSetupOptions): Promise<void> {
    const {
      repoInfo,
      branchName,
      baseBranch,
      workDir,
      isDirectMode,
      dryRun,
      retries,
      token,
      gitOps,
      log,
      executor,
    } = options;

    // Direct mode: stay on default branch, no PR cleanup needed
    if (isDirectMode) {
      log.info(`Direct mode: staying on ${baseBranch}`);
      return;
    }

    // Close existing PR if exists (fresh start approach)
    // Skip for dry-run mode
    if (!dryRun) {
      log.info("Checking for existing PR...");
      const strategy = getPRStrategy(repoInfo, executor);
      const closed = await strategy.closeExistingPR({
        repoInfo,
        branchName,
        baseBranch,
        workDir,
        retries,
        token,
      });

      if (closed) {
        log.info("Closed existing PR and deleted branch for fresh sync");
        // Prune stale remote tracking refs so --force-with-lease works correctly
        await gitOps.fetch({ prune: true });
      }
    }

    // Create branch (always fresh from base branch)
    log.info(`Creating branch: ${branchName}`);
    await gitOps.createBranch(branchName);
  }
}
```

**Step 3: Update sync/index.ts**

Add to `src/sync/index.ts`:

```typescript
export { BranchManager } from "./branch-manager.js";
export type { IBranchManager, BranchSetupOptions } from "./types.js";
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="BranchManager"`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/sync/branch-manager.ts src/sync/types.ts src/sync/index.ts
git commit -m "feat(sync): implement BranchManager"
```

---

## Task 8: Refactor RepositoryProcessor to Use Components

**Files:**

- Modify: `src/repository-processor.ts`

**Step 1: Run existing tests to establish baseline**

Run: `npm test -- --test-name-pattern="RepositoryProcessor"`
Expected: All existing tests PASS

**Step 2: Add component imports and injections**

Add imports at top of `repository-processor.ts`:

```typescript
import {
  FileWriter,
  ManifestManager,
  BranchManager,
  type IFileWriter,
  type IManifestManager,
  type IBranchManager,
} from "./sync/index.js";
```

Update constructor to accept component injections:

```typescript
export class RepositoryProcessor implements IRepositoryProcessor {
  private gitOps: IAuthenticatedGitOps | null = null;
  private readonly gitOpsFactory: GitOpsFactory;
  private readonly log: ILogger;
  private retries: number = 3;
  private executor: ICommandExecutor = defaultExecutor;
  private readonly tokenManager: GitHubAppTokenManager | null;
  private readonly fileWriter: IFileWriter;
  private readonly manifestManager: IManifestManager;
  private readonly branchManager: IBranchManager;

  constructor(
    gitOpsFactory?: GitOpsFactory,
    log?: ILogger,
    components?: {
      fileWriter?: IFileWriter;
      manifestManager?: IManifestManager;
      branchManager?: IBranchManager;
    }
  ) {
    this.gitOpsFactory =
      gitOpsFactory ??
      ((opts, auth) => new AuthenticatedGitOps(new GitOps(opts), auth));
    this.log = log ?? logger;
    this.fileWriter = components?.fileWriter ?? new FileWriter();
    this.manifestManager = components?.manifestManager ?? new ManifestManager();
    this.branchManager = components?.branchManager ?? new BranchManager();

    // Initialize GitHub App token manager if credentials are configured
    if (hasGitHubAppCredentials()) {
      this.tokenManager = new GitHubAppTokenManager(
        process.env.XFG_GITHUB_APP_ID!,
        process.env.XFG_GITHUB_APP_PRIVATE_KEY!
      );
    } else {
      this.tokenManager = null;
    }
  }
```

**Step 3: Run tests to verify no regression**

Run: `npm test -- --test-name-pattern="RepositoryProcessor"`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/repository-processor.ts
git commit -m "refactor: add component injection to RepositoryProcessor"
```

---

## Task 9: Replace File Writing Logic with FileWriter

**Files:**

- Modify: `src/repository-processor.ts`

**Step 1: Replace inline file writing with FileWriter call**

In the `process()` method, replace the file writing loop (lines ~265-360) with:

```typescript
// Step 5: Write all config files using FileWriter
const { fileChanges: fileWriteResults, diffStats } =
  await this.fileWriter.writeFiles(
    repoConfig.files,
    {
      repoInfo,
      baseBranch,
      workDir,
      dryRun: dryRun ?? false,
      noDelete: options.noDelete ?? false,
      configId: options.configId,
    },
    {
      gitOps: this.gitOps!,
      log: this.log,
    }
  );

// Convert to the format used by the rest of the method
const fileChangesForCommit = new Map<
  string,
  {
    content: string | null;
    action: "create" | "update" | "delete" | "skip";
  }
>();
for (const [fileName, result] of fileWriteResults) {
  fileChangesForCommit.set(fileName, {
    content: result.content,
    action: result.action,
  });
}
```

**Step 2: Remove the now-unused shouldBeExecutable function from repository-processor.ts**

Delete lines 62-76 (the standalone `shouldBeExecutable` function).

**Step 3: Run tests to verify no regression**

Run: `npm test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/repository-processor.ts
git commit -m "refactor: use FileWriter for file operations"
```

---

## Task 10: Replace Manifest Logic with ManifestManager

**Files:**

- Modify: `src/repository-processor.ts`

**Step 1: Replace inline manifest logic with ManifestManager calls**

Replace the manifest handling section (lines ~363-428) with:

```typescript
// Step 5c: Handle orphaned file deletion (manifest-based tracking)
const existingManifest = loadManifest(workDir);

// Build map of files with their deleteOrphaned setting
const filesWithDeleteOrphaned = new Map<string, boolean | undefined>();
for (const file of repoConfig.files) {
  filesWithDeleteOrphaned.set(file.fileName, file.deleteOrphaned);
}

// Process manifest and get orphans
const { manifest: newManifest, filesToDelete } =
  this.manifestManager.processOrphans(
    workDir,
    options.configId,
    filesWithDeleteOrphaned
  );

// Delete orphaned files
await this.manifestManager.deleteOrphans(
  filesToDelete,
  { dryRun: dryRun ?? false, noDelete: options.noDelete ?? false },
  {
    gitOps: this.gitOps!,
    log: this.log,
    fileChanges: fileChangesForCommit,
  }
);

// Increment diff stats for deletions in dry-run mode
if (dryRun && filesToDelete.length > 0 && !options.noDelete) {
  for (const fileName of filesToDelete) {
    if (this.gitOps!.fileExists(fileName)) {
      incrementDiffStats(diffStats, "DELETED");
    }
  }
}

// Save updated manifest
this.manifestManager.saveUpdatedManifest(
  workDir,
  newManifest,
  existingManifest,
  dryRun ?? false,
  fileChangesForCommit
);
```

**Step 2: Run tests to verify no regression**

Run: `npm test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/repository-processor.ts
git commit -m "refactor: use ManifestManager for manifest operations"
```

---

## Task 11: Replace Branch Logic with BranchManager

**Files:**

- Modify: `src/repository-processor.ts`

**Step 1: Replace inline branch logic with BranchManager call**

Replace the existing PR cleanup and branch creation section (lines ~221-247) with:

```typescript
// Step 3.5 & 4: Setup branch (close existing PR, create new branch)
await this.branchManager.setupBranch({
  repoInfo,
  branchName,
  baseBranch,
  workDir,
  isDirectMode,
  dryRun: dryRun ?? false,
  retries: this.retries,
  token,
  gitOps: this.gitOps!,
  log: this.log,
  executor: this.executor,
});
```

**Step 2: Run tests to verify no regression**

Run: `npm test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/repository-processor.ts
git commit -m "refactor: use BranchManager for branch operations"
```

---

## Task 12: Clean Up Unused Imports

**Files:**

- Modify: `src/repository-processor.ts`

**Step 1: Remove unused imports**

Remove these imports that are now handled by components:

```typescript
// Remove these (now in FileWriter):
import { interpolateXfgContent } from "./xfg-template.js";
import { getFileStatus, generateDiff } from "./diff-utils.js";

// Keep these (still used):
import {
  createDiffStats,
  incrementDiffStats,
  DiffStats,
} from "./diff-utils.js";
```

**Step 2: Run tests and lint**

Run: `npm test && ./lint.sh`
Expected: All tests PASS, no lint errors

**Step 3: Commit**

```bash
git add src/repository-processor.ts
git commit -m "refactor: clean up unused imports"
```

---

## Task 13: Verify Line Count and Final Acceptance

**Files:**

- Verify: `src/repository-processor.ts`
- Verify: `src/sync/file-writer.ts`
- Verify: `src/sync/manifest-manager.ts`
- Verify: `src/sync/branch-manager.ts`

**Step 1: Check line counts**

Run: `wc -l src/repository-processor.ts src/sync/file-writer.ts src/sync/manifest-manager.ts src/sync/branch-manager.ts`

Expected:

- `repository-processor.ts` < 450 lines
- `file-writer.ts` < 200 lines
- `manifest-manager.ts` < 200 lines
- `branch-manager.ts` < 200 lines

**Step 2: Run full test suite**

Run: `npm test`
Expected: All 1654+ tests PASS

**Step 3: Run lint**

Run: `./lint.sh`
Expected: No errors

**Step 4: Commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup for repository-processor split"
```

---

## Task 14: Update updateManifestOnly Method

**Files:**

- Modify: `src/repository-processor.ts`

**Step 1: Apply same refactoring to updateManifestOnly**

The `updateManifestOnly` method has similar patterns. Update it to use:

- `this.branchManager.setupBranch()` for branch setup
- Direct manifest operations (this method doesn't write files)

**Step 2: Run tests**

Run: `npm test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/repository-processor.ts
git commit -m "refactor: apply component usage to updateManifestOnly"
```

---

## Summary

After completing all tasks:

| Component             | Location                       | Lines | Responsibility            |
| --------------------- | ------------------------------ | ----- | ------------------------- |
| `RepositoryProcessor` | `src/repository-processor.ts`  | ~400  | Orchestration             |
| `FileWriter`          | `src/sync/file-writer.ts`      | ~130  | File writing, templating  |
| `ManifestManager`     | `src/sync/manifest-manager.ts` | ~90   | Manifest, orphan tracking |
| `BranchManager`       | `src/sync/branch-manager.ts`   | ~50   | Branch/PR lifecycle       |
| Types                 | `src/sync/types.ts`            | ~80   | Shared interfaces         |

Total reduction: 894 lines → ~750 lines across 5 focused files
