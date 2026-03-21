# JSON/YAML Content Diff in Summary Output — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show unified content diffs for JSON/YAML files in CLI and GitHub Step Summary output.

**Architecture:** Extract a raw (no-chalk) `computeUnifiedDiff` from `generateDiff`, attach pre-computed diff lines to `FileWriteResult` and `FileChangeDetail`, carry them through the report pipeline, and render in both CLI (chalk-colored) and markdown (raw) output.

**Tech Stack:** TypeScript, node:test, chalk

**Spec:** `docs/superpowers/specs/2026-03-21-json-yaml-diff-summary-design.md`

---

### Task 1: Extract `computeUnifiedDiff` and add `isStructuredDataFile`

**Files:**
- Modify: `src/sync/diff-utils.ts`
- Modify: `src/sync/index.ts`
- Test: `test/unit/diff-utils.test.ts`

- [ ] **Step 1: Write failing tests for `computeUnifiedDiff`**

Add to `test/unit/diff-utils.test.ts`:

```typescript
import {
  // ... existing imports ...
  computeUnifiedDiff,
} from "../../src/sync/diff-utils.js";

describe("computeUnifiedDiff", () => {
  test("returns all additions with hunk header for new file", () => {
    const lines = computeUnifiedDiff(null, "line1\nline2\n");
    assert.ok(lines.length > 0);
    assert.ok(lines[0].startsWith("@@ -0,0 +1,"));
    assert.ok(lines.slice(1).every((l) => l.startsWith("+")));
  });

  test("returns all removals with hunk header for deleted file", () => {
    const lines = computeUnifiedDiff("line1\nline2\n", null);
    assert.ok(lines.length > 0);
    assert.ok(lines[0].startsWith("@@ -1,"));
    assert.ok(lines[0].includes("+0,0"));
    assert.ok(lines.slice(1).every((l) => l.startsWith("-")));
  });

  test("returns empty array when content is identical", () => {
    const content = "same\n";
    assert.deepEqual(computeUnifiedDiff(content, content), []);
  });

  test("returns raw lines without ANSI codes", () => {
    const lines = computeUnifiedDiff(null, "hello\n");
    const ansiRegex = new RegExp(
      String.fromCharCode(0x1b) + "\\[[0-9;]*m",
      "g"
    );
    for (const line of lines) {
      assert.equal(line, line.replace(ansiRegex, ""));
    }
  });

  test("returns hunks with context for modified file", () => {
    const lines = computeUnifiedDiff("a\nb\nc\n", "a\nx\nc\n");
    assert.ok(lines.some((l) => l.startsWith("@@")));
    assert.ok(lines.some((l) => l === "-b"));
    assert.ok(lines.some((l) => l === "+x"));
  });

  test("returns empty array when both null", () => {
    assert.deepEqual(computeUnifiedDiff(null, null), []);
  });
});
```

- [ ] **Step 2: Write failing tests for `isStructuredDataFile`**

Add to `test/unit/diff-utils.test.ts`:

```typescript
import {
  // ... existing imports ...
  isStructuredDataFile,
} from "../../src/sync/diff-utils.js";

describe("isStructuredDataFile", () => {
  test("matches .json", () => {
    assert.equal(isStructuredDataFile("config.json"), true);
  });

  test("matches .json5", () => {
    assert.equal(isStructuredDataFile("config.json5"), true);
  });

  test("matches .yaml", () => {
    assert.equal(isStructuredDataFile("config.yaml"), true);
  });

  test("matches .yml", () => {
    assert.equal(isStructuredDataFile("ci.yml"), true);
  });

  test("is case insensitive", () => {
    assert.equal(isStructuredDataFile("Config.JSON"), true);
    assert.equal(isStructuredDataFile("Config.YAML"), true);
  });

  test("rejects .sh", () => {
    assert.equal(isStructuredDataFile("script.sh"), false);
  });

  test("rejects .md", () => {
    assert.equal(isStructuredDataFile("README.md"), false);
  });

  test("rejects .ts", () => {
    assert.equal(isStructuredDataFile("index.ts"), false);
  });

  test("matches nested paths", () => {
    assert.equal(isStructuredDataFile(".github/workflows/ci.yml"), true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test test/unit/diff-utils.test.ts`
Expected: FAIL — `computeUnifiedDiff` and `isStructuredDataFile` not exported

- [ ] **Step 4: Implement `computeUnifiedDiff` and `isStructuredDataFile`**

In `src/sync/diff-utils.ts`, add `isStructuredDataFile`:

```typescript
export function isStructuredDataFile(fileName: string): boolean {
  return /\.(json|json5|ya?ml)$/i.test(fileName);
}
```

Add `computeUnifiedDiff` — extract the raw logic from `generateDiff`:

```typescript
/**
 * Compute a unified diff between old and new content.
 * Returns raw diff lines (no ANSI formatting).
 *
 * - oldContent === null → new file (all additions)
 * - newContent === null → deleted file (all removals)
 * - both null → empty array
 */
export function computeUnifiedDiff(
  oldContent: string | null,
  newContent: string | null,
  contextLines: number = 3
): string[] {
  if (oldContent === null && newContent === null) {
    return [];
  }

  // New file: all additions
  if (oldContent === null) {
    const newLines = newContent!.split("\n");
    // Filter trailing empty string from split
    const lines = newLines[newLines.length - 1] === "" ? newLines.slice(0, -1) : newLines;
    if (lines.length === 0) return [];
    const result: string[] = [`@@ -0,0 +1,${lines.length} @@`];
    for (const line of lines) {
      result.push(`+${line}`);
    }
    return result;
  }

  // Deleted file: all removals
  if (newContent === null) {
    const oldLines = oldContent.split("\n");
    const lines = oldLines[oldLines.length - 1] === "" ? oldLines.slice(0, -1) : oldLines;
    if (lines.length === 0) return [];
    const result: string[] = [`@@ -1,${lines.length} +0,0 @@`];
    for (const line of lines) {
      result.push(`-${line}`);
    }
    return result;
  }

  // Modified file: LCS diff
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const hunks = computeDiffHunks(oldLines, newLines, contextLines);
  if (hunks.length === 0) return [];

  const result: string[] = [];
  for (const hunk of hunks) {
    result.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
    );
    for (const line of hunk.lines) {
      result.push(line);
    }
  }
  return result;
}
```

Refactor `generateDiff` to use `computeUnifiedDiff` and clean up the `_fileName` param:

```typescript
export function generateDiff(
  oldContent: string | null,
  newContent: string,
  contextLines: number = 3
): string[] {
  return computeUnifiedDiff(oldContent, newContent, contextLines).map(
    formatDiffLine
  );
}
```

- [ ] **Step 5: Update existing `generateDiff` callers for removed `_fileName` param**

In `src/sync/file-writer.ts` line 123-127, remove the third argument:

```typescript
// Before:
const diffLines = generateDiff(existingContent, fileContent, file.fileName);

// After:
const diffLines = generateDiff(existingContent, fileContent);
```

In `test/unit/diff-utils.test.ts`, update all existing `generateDiff` calls to remove the third arg:

```typescript
// Before:
generateDiff(null, "line1\nline2\n", "test.txt");
// After:
generateDiff(null, "line1\nline2\n");
```

(Apply to all 8 existing generateDiff calls in the test file.)

- [ ] **Step 6: Add barrel exports to `src/sync/index.ts`**

Add to existing exports:

```typescript
export {
  computeUnifiedDiff,
  isStructuredDataFile,
  formatDiffLine,
} from "./diff-utils.js";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx tsx --test test/unit/diff-utils.test.ts`
Expected: All tests PASS

- [ ] **Step 8: Run full test suite**

Run: `npm test`
Expected: PASS (no regressions from `generateDiff` refactor)

- [ ] **Step 9: Commit**

```bash
git add src/sync/diff-utils.ts src/sync/index.ts src/sync/file-writer.ts test/unit/diff-utils.test.ts
git commit -m "refactor: extract computeUnifiedDiff and add isStructuredDataFile (#599)"
```

---

### Task 2: Add `diffLines` to data types

**Files:**
- Modify: `src/sync/types.ts`

- [ ] **Step 1: Add `diffLines` to `FileWriteResult`**

In `src/sync/types.ts`, update the interface:

```typescript
export interface FileWriteResult {
  fileName: string;
  content: string | null;
  action: "create" | "update" | "delete" | "skip";
  diffLines?: string[];
}
```

- [ ] **Step 2: Add `diffLines` to `FileChangeDetail`**

In `src/sync/types.ts`, update the interface:

```typescript
export interface FileChangeDetail {
  path: string;
  action: "create" | "update" | "delete";
  diffLines?: string[];
}
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS (additive changes only)

- [ ] **Step 4: Commit**

```bash
git add src/sync/types.ts
git commit -m "feat: add diffLines to FileWriteResult and FileChangeDetail (#599)"
```

---

### Task 3: Compute `diffLines` in `FileWriter.writeFiles()`

**Files:**
- Modify: `src/sync/file-writer.ts`
- Test: `test/unit/sync/file-writer.test.ts`

- [ ] **Step 1: Write failing test — diffLines populated for JSON in dry-run**

Add to `test/unit/sync/file-writer.test.ts`:

```typescript
import { isStructuredDataFile } from "../../../src/sync/diff-utils.js";

test("populates diffLines for JSON files in dry-run", async () => {
  const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
    wouldChange: true,
    fileContent: '{"old": true}\n',
    fileExists: false,
    fileExistsOnBranch: false,
  });
  const { mock: mockLogger } = createMockLogger();

  const writer = new FileWriter();
  const files: FileContent[] = [
    { fileName: "config.json", content: { new: true } },
  ];

  const result = await writer.writeFiles(
    files,
    {
      repoInfo: mockRepoInfo,
      baseBranch: "main",
      workDir,
      dryRun: true,
      noDelete: false,
      configId: "test",
    },
    { gitOps: mockGitOps, log: mockLogger }
  );

  const entry = result.fileChanges.get("config.json");
  assert.ok(entry);
  assert.ok(entry.diffLines);
  assert.ok(entry.diffLines.length > 0);
  // Raw lines, no ANSI codes
  const ansiRegex = new RegExp(
    String.fromCharCode(0x1b) + "\\[[0-9;]*m",
    "g"
  );
  for (const line of entry.diffLines) {
    assert.equal(line, line.replace(ansiRegex, ""));
  }
});
```

- [ ] **Step 2: Write failing test — diffLines populated for JSON in apply mode**

```typescript
test("populates diffLines for JSON files in apply mode", async () => {
  const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
    wouldChange: true,
    fileContent: null,
    fileExists: false,
    fileExistsOnBranch: false,
  });
  const { mock: mockLogger } = createMockLogger();

  const writer = new FileWriter();
  const files: FileContent[] = [
    { fileName: "config.json", content: { key: "value" } },
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
    { gitOps: mockGitOps, log: mockLogger }
  );

  const entry = result.fileChanges.get("config.json");
  assert.ok(entry);
  assert.ok(entry.diffLines);
  assert.ok(entry.diffLines.length > 0);
});
```

- [ ] **Step 3: Write failing test — no diffLines for .sh files**

```typescript
test("does not populate diffLines for non-structured files", async () => {
  const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
    wouldChange: true,
    fileContent: null,
    fileExists: false,
    fileExistsOnBranch: false,
  });
  const { mock: mockLogger } = createMockLogger();

  const writer = new FileWriter();
  const files: FileContent[] = [
    { fileName: "script.sh", content: "#!/bin/bash\necho hello" },
  ];

  const result = await writer.writeFiles(
    files,
    {
      repoInfo: mockRepoInfo,
      baseBranch: "main",
      workDir,
      dryRun: true,
      noDelete: false,
      configId: "test",
    },
    { gitOps: mockGitOps, log: mockLogger }
  );

  const entry = result.fileChanges.get("script.sh");
  assert.ok(entry);
  assert.equal(entry.diffLines, undefined);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx tsx --test test/unit/sync/file-writer.test.ts`
Expected: FAIL — `diffLines` is undefined for JSON files

- [ ] **Step 5: Implement — compute diffLines in FileWriter.writeFiles()**

In `src/sync/file-writer.ts`, add import:

```typescript
import {
  getFileStatus,
  generateDiff,
  createDiffStats,
  incrementDiffStats,
  computeUnifiedDiff,
  isStructuredDataFile,
} from "./diff-utils.js";
```

Replace the block at lines 111-132 with:

```typescript
      if (changed) {
        const writeResult: FileWriteResult = {
          fileName: file.fileName,
          content: fileContent,
          action,
        };

        // Compute raw diff lines for structured data files (all modes)
        if (isStructuredDataFile(file.fileName)) {
          writeResult.diffLines = computeUnifiedDiff(
            existingContent,
            fileContent
          );
        }

        fileChanges.set(file.fileName, writeResult);
      }

      if (dryRun) {
        const status = getFileStatus(existingContent !== null, changed);
        incrementDiffStats(diffStats, status);

        const diffLines = generateDiff(existingContent, fileContent);
        log.fileDiff(file.fileName, status, diffLines);
      } else if (changed) {
        incrementDiffStats(diffStats, action === "create" ? "NEW" : "MODIFIED");
        gitOps.writeFile(file.fileName, fileContent);
      }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsx --test test/unit/sync/file-writer.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/sync/file-writer.ts test/unit/sync/file-writer.test.ts
git commit -m "feat: compute diffLines in FileWriter for JSON/YAML files (#599)"
```

---

### Task 4: Compute `diffLines` in `ManifestManager`

**Files:**
- Modify: `src/sync/manifest-manager.ts`
- Test: `test/unit/sync/manifest-manager.test.ts`

- [ ] **Step 1: Write failing test — diffLines for JSON/YAML orphan delete**

Add to `test/unit/sync/manifest-manager.test.ts`:

```typescript
test("attaches diffLines for JSON orphan deletions", () => {
  // Setup: create a manifest with a JSON file to orphan
  // Then call deleteOrphans with that file
  // Assert fileChanges entry has diffLines with removal lines
  const manager = new ManifestManager();
  const fileChanges = new Map<string, FileWriteResult>();
  const mockGitOps = {
    fileExists: () => true,
    deleteFile: () => {},
    getFileContent: () => '{"key": "value"}\n',
  };
  const mockLog = {
    info: () => {},
    warn: () => {},
    debug: () => {},
    fileDiff: () => {},
  };

  manager.deleteOrphans(
    ["old-config.json"],
    { dryRun: false, noDelete: false },
    { gitOps: mockGitOps as any, log: mockLog as any, fileChanges }
  );

  const entry = fileChanges.get("old-config.json");
  assert.ok(entry);
  assert.ok(entry.diffLines);
  assert.ok(entry.diffLines.length > 0);
  assert.ok(entry.diffLines.some((l) => l.startsWith("-")));
});
```

- [ ] **Step 2: Write failing test — no diffLines for non-JSON orphan delete**

```typescript
test("does not attach diffLines for non-JSON orphan deletions", () => {
  const manager = new ManifestManager();
  const fileChanges = new Map<string, FileWriteResult>();
  const mockGitOps = {
    fileExists: () => true,
    deleteFile: () => {},
    getFileContent: () => "#!/bin/bash\necho hello",
  };
  const mockLog = {
    info: () => {},
    warn: () => {},
    debug: () => {},
    fileDiff: () => {},
  };

  manager.deleteOrphans(
    ["script.sh"],
    { dryRun: false, noDelete: false },
    { gitOps: mockGitOps as any, log: mockLog as any, fileChanges }
  );

  const entry = fileChanges.get("script.sh");
  assert.ok(entry);
  assert.equal(entry.diffLines, undefined);
});
```

- [ ] **Step 3: Write failing test — diffLines for manifest save**

```typescript
test("attaches diffLines when manifest is updated", () => {
  // Use a real temp dir with an existing manifest
  const manager = new ManifestManager();
  const fileChanges = new Map<string, FileWriteResult>();
  const existingManifest = { version: 4, configs: { old: { files: ["a.json"] } } };
  const newManifest = { version: 4, configs: { new: { files: ["b.json"] } } };

  // Write existing manifest so manifestExisted = true
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, ".xfg.json"), JSON.stringify(existingManifest, null, 2) + "\n");

  manager.saveUpdatedManifest(
    workDir,
    newManifest as any,
    existingManifest as any,
    false,
    fileChanges
  );

  const entry = fileChanges.get(".xfg.json");
  assert.ok(entry);
  assert.ok(entry.diffLines);
  assert.ok(entry.diffLines.length > 0);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx tsx --test test/unit/sync/manifest-manager.test.ts`
Expected: FAIL — `diffLines` is undefined

- [ ] **Step 5: Implement deleteOrphans diff computation**

In `src/sync/manifest-manager.ts`, add import:

```typescript
import { computeUnifiedDiff, isStructuredDataFile } from "./diff-utils.js";
```

Update the `deleteOrphans` method — in the loop body (line 70-74), replace:

```typescript
      fileChanges.set(fileName, {
        fileName,
        content: null,
        action: "delete",
      });
```

With:

```typescript
      const writeResult: FileWriteResult = {
        fileName,
        content: null,
        action: "delete",
      };

      if (isStructuredDataFile(fileName)) {
        const existingContent = gitOps.getFileContent(fileName);
        if (existingContent !== null) {
          writeResult.diffLines = computeUnifiedDiff(existingContent, null);
        }
      }

      fileChanges.set(fileName, writeResult);
```

- [ ] **Step 6: Implement saveUpdatedManifest diff computation**

In the `saveUpdatedManifest` method, replace lines 109-113:

```typescript
    fileChanges.set(MANIFEST_FILENAME, {
      fileName: MANIFEST_FILENAME,
      content: manifestContent,
      action: manifestExisted ? "update" : "create",
    });
```

With:

```typescript
    const writeResult: FileWriteResult = {
      fileName: MANIFEST_FILENAME,
      content: manifestContent,
      action: manifestExisted ? "update" : "create",
    };

    // Compute diff for the manifest (it's a JSON file)
    const oldManifestContent = existingManifest
      ? JSON.stringify(existingManifest, null, 2) + "\n"
      : null;
    writeResult.diffLines = computeUnifiedDiff(
      oldManifestContent,
      manifestContent
    );

    fileChanges.set(MANIFEST_FILENAME, writeResult);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx tsx --test test/unit/sync/manifest-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 8: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/sync/manifest-manager.ts test/unit/sync/manifest-manager.test.ts
git commit -m "feat: compute diffLines in ManifestManager for JSON/YAML files (#599)"
```

---

### Task 5: Pass `diffLines` through `FileSyncStrategy` and `buildSyncReport`

**Files:**
- Modify: `src/sync/file-sync-strategy.ts`
- Modify: `src/cli/sync-report-builder.ts`
- Test: `test/unit/sync/file-sync-strategy.test.ts`
- Test: `test/unit/sync-report-builder.test.ts`

- [ ] **Step 1: Write failing test — FileSyncStrategy carries diffLines**

Add to `test/unit/sync/file-sync-strategy.test.ts`:

```typescript
  test("carries diffLines from fileChanges to fileChangeDetails", async () => {
    const mockDiffLines = ["@@ -0,0 +1,1 @@", "+new content"];
    const mockOrchestrator: IFileSyncOrchestrator = {
      async sync() {
        return {
          fileChanges: new Map([
            [
              "config.json",
              {
                fileName: "config.json",
                content: '{"new": true}\n',
                action: "create" as const,
                diffLines: mockDiffLines,
              },
            ],
          ]),
          diffStats: {
            newCount: 1,
            modifiedCount: 0,
            unchangedCount: 0,
            deletedCount: 0,
          },
          changedFiles: [
            { fileName: "config.json", action: "create" as const },
          ],
          hasChanges: true,
        };
      },
    };

    const strategy = new FileSyncStrategy(mockOrchestrator);
    const { gitOps } = createMockAuthenticatedGitOps({ hasChanges: true });
    const session: SessionContext = {
      gitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      {
        branchName: "test",
        workDir: "/tmp",
        configId: "test",
        executor: createMockExecutor().mock,
      }
    );

    assert.ok(result);
    assert.deepEqual(result.fileChangeDetails[0].diffLines, mockDiffLines);
  });

  test("does not include diffLines when absent from fileChanges", async () => {
    const mockOrchestrator: IFileSyncOrchestrator = {
      async sync() {
        return {
          fileChanges: new Map([
            [
              "script.sh",
              {
                fileName: "script.sh",
                content: "#!/bin/bash",
                action: "create" as const,
              },
            ],
          ]),
          diffStats: {
            newCount: 1,
            modifiedCount: 0,
            unchangedCount: 0,
            deletedCount: 0,
          },
          changedFiles: [
            { fileName: "script.sh", action: "create" as const },
          ],
          hasChanges: true,
        };
      },
    };

    const strategy = new FileSyncStrategy(mockOrchestrator);
    const { gitOps } = createMockAuthenticatedGitOps({ hasChanges: true });
    const session: SessionContext = {
      gitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      {
        branchName: "test",
        workDir: "/tmp",
        configId: "test",
        executor: createMockExecutor().mock,
      }
    );

    assert.ok(result);
    assert.equal(result.fileChangeDetails[0].diffLines, undefined);
  });
```

- [ ] **Step 2: Write failing test — buildSyncReport preserves diffLines**

Add to `test/unit/sync-report-builder.test.ts`:

```typescript
  test("preserves diffLines through the pipeline", () => {
    const diffLines = ["@@ -1,1 +1,1 @@", "-old", "+new"];
    const results = [
      {
        repoName: "org/repo",
        success: true,
        fileChanges: [
          { path: "config.json", action: "update" as const, diffLines },
        ],
      },
    ];

    const report = buildSyncReport(results);

    assert.deepEqual(report.repos[0].files[0].diffLines, diffLines);
  });

  test("handles files without diffLines", () => {
    const results = [
      {
        repoName: "org/repo",
        success: true,
        fileChanges: [
          { path: "script.sh", action: "create" as const },
        ],
      },
    ];

    const report = buildSyncReport(results);

    assert.equal(report.repos[0].files[0].diffLines, undefined);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test test/unit/sync/file-sync-strategy.test.ts test/unit/sync-report-builder.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement FileSyncStrategy diffLines passthrough**

In `src/sync/file-sync-strategy.ts`, update the map at lines 37-42:

```typescript
    const fileChangeDetails = changedFiles
      .filter((f) => f.action !== "skip")
      .map((f) => {
        const detail: {
          path: string;
          action: "create" | "update" | "delete";
          diffLines?: string[];
        } = {
          path: f.fileName,
          action: f.action as "create" | "update" | "delete",
        };
        const writeResult = fileChanges.get(f.fileName);
        if (writeResult?.diffLines) {
          detail.diffLines = writeResult.diffLines;
        }
        return detail;
      });
```

- [ ] **Step 5: Implement buildSyncReport diffLines passthrough**

In `src/cli/sync-report-builder.ts`, update the map at lines 23-26:

```typescript
    const files: ReportFileChange[] = result.fileChanges.map((f) => {
      const entry: ReportFileChange = { path: f.path, action: f.action };
      if (f.diffLines) {
        entry.diffLines = f.diffLines;
      }
      return entry;
    });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsx --test test/unit/sync/file-sync-strategy.test.ts test/unit/sync-report-builder.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/sync/file-sync-strategy.ts src/cli/sync-report-builder.ts test/unit/sync/file-sync-strategy.test.ts test/unit/sync-report-builder.test.ts
git commit -m "feat: carry diffLines through FileSyncStrategy and buildSyncReport (#599)"
```

---

### Task 6: Render `diffLines` in markdown summary output

**Files:**
- Modify: `src/output/unified-summary.ts`
- Test: `test/unit/unified-summary.test.ts`

- [ ] **Step 1: Write failing test — renderSyncLines includes diff lines**

Add to `test/unit/unified-summary.test.ts`:

```typescript
import { renderSyncLines } from "../../src/output/unified-summary.js";

describe("renderSyncLines with diffLines", () => {
  test("appends diff lines after file path for updates", () => {
    const diffLines: string[] = [];
    renderSyncLines(
      {
        repoName: "org/repo",
        files: [
          {
            path: "config.json",
            action: "update",
            diffLines: ["@@ -1,1 +1,1 @@", "-old", "+new"],
          },
        ],
      },
      diffLines
    );

    assert.deepEqual(diffLines, [
      "! config.json",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ]);
  });

  test("appends diff lines after file path for creates", () => {
    const diffLines: string[] = [];
    renderSyncLines(
      {
        repoName: "org/repo",
        files: [
          {
            path: "config.json",
            action: "create",
            diffLines: ["@@ -0,0 +1,1 @@", '+{"key": "value"}'],
          },
        ],
      },
      diffLines
    );

    assert.deepEqual(diffLines, [
      "+ config.json",
      "@@ -0,0 +1,1 @@",
      '+{"key": "value"}',
    ]);
  });

  test("does not append diff lines when absent", () => {
    const diffLines: string[] = [];
    renderSyncLines(
      {
        repoName: "org/repo",
        files: [{ path: "script.sh", action: "create" }],
      },
      diffLines
    );

    assert.deepEqual(diffLines, ["+ script.sh"]);
  });

  test("appends diff lines for deleted files", () => {
    const diffLines: string[] = [];
    renderSyncLines(
      {
        repoName: "org/repo",
        files: [
          {
            path: "old.yaml",
            action: "delete",
            diffLines: ["@@ -1,2 +0,0 @@", "-key: value", "-other: thing"],
          },
        ],
      },
      diffLines
    );

    assert.deepEqual(diffLines, [
      "- old.yaml",
      "@@ -1,2 +0,0 @@",
      "-key: value",
      "-other: thing",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/unit/unified-summary.test.ts`
Expected: FAIL — diff lines not present in output

- [ ] **Step 3: Implement renderSyncLines diff output**

In `src/output/unified-summary.ts`, update `renderSyncLines` (lines 176-193):

```typescript
export function renderSyncLines(
  syncRepo: RepoFileChanges,
  diffLines: string[]
): void {
  for (const file of syncRepo.files) {
    if (file.action === "create") {
      diffLines.push(`+ ${file.path}`);
    } else if (file.action === "update") {
      diffLines.push(`! ${file.path}`);
    } else if (file.action === "delete") {
      diffLines.push(`- ${file.path}`);
    }

    if (file.diffLines) {
      diffLines.push(...file.diffLines);
    }
  }

  if (syncRepo.error) {
    diffLines.push(`- Error: ${syncRepo.error}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/unit/unified-summary.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/output/unified-summary.ts test/unit/unified-summary.test.ts
git commit -m "feat: render diffLines in markdown summary output (#599)"
```

---

### Task 7: Render `diffLines` in CLI output

**Files:**
- Modify: `src/output/sync-report.ts`
- Test: `test/unit/sync-report-formatter.test.ts`

- [ ] **Step 1: Write failing test — CLI output includes chalk-formatted diff**

Add to `test/unit/sync-report-formatter.test.ts`:

```typescript
describe("formatSyncReportCLI with diffLines", () => {
  test("renders diff lines with indentation for JSON files", () => {
    const report: SyncReport = {
      repos: [
        {
          repoName: "org/repo",
          files: [
            {
              path: "config.json",
              action: "update",
              diffLines: ["@@ -1,1 +1,1 @@", "-old", "+new"],
            },
          ],
        },
      ],
      totals: { files: { create: 0, update: 1, delete: 0 } },
    };

    const lines = formatSyncReportCLI(report);
    const output = lines.join("\n");

    // Strip ANSI codes for assertion
    const ansiRegex = new RegExp(
      String.fromCharCode(0x1b) + "\\[[0-9;]*m",
      "g"
    );
    const raw = output.replace(ansiRegex, "");

    assert.ok(raw.includes("      @@ -1,1 +1,1 @@"), "should have indented hunk header");
    assert.ok(raw.includes("      -old"), "should have indented removal");
    assert.ok(raw.includes("      +new"), "should have indented addition");
  });

  test("does not render diff lines when absent", () => {
    const report: SyncReport = {
      repos: [
        {
          repoName: "org/repo",
          files: [{ path: "script.sh", action: "create" }],
        },
      ],
      totals: { files: { create: 1, update: 0, delete: 0 } },
    };

    const lines = formatSyncReportCLI(report);
    const output = lines.join("\n");
    const ansiRegex = new RegExp(
      String.fromCharCode(0x1b) + "\\[[0-9;]*m",
      "g"
    );
    const raw = output.replace(ansiRegex, "");

    // Should only have repo header, file line, blank line, and summary
    assert.ok(!raw.includes("@@"), "should not have hunk headers");
  });
});
```

- [ ] **Step 2: Write failing test — markdown output includes diff lines**

```typescript
describe("formatSyncReportMarkdown with diffLines", () => {
  test("includes diff lines in markdown output", () => {
    const report: SyncReport = {
      repos: [
        {
          repoName: "org/repo",
          files: [
            {
              path: "config.json",
              action: "update",
              diffLines: ["@@ -1,1 +1,1 @@", "-old", "+new"],
            },
          ],
        },
      ],
      totals: { files: { create: 0, update: 1, delete: 0 } },
    };

    const markdown = formatSyncReportMarkdown(report, true);

    assert.ok(markdown.includes("@@ -1,1 +1,1 @@"));
    assert.ok(markdown.includes("-old"));
    assert.ok(markdown.includes("+new"));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test test/unit/sync-report-formatter.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement CLI diff rendering**

In `src/output/sync-report.ts`, add import:

```typescript
import { formatDiffLine } from "../sync/diff-utils.js";
```

Update `formatSyncReportCLI` — after the file line in the loop (lines 30-37), add diff rendering:

```typescript
    // Files
    for (const file of repo.files) {
      if (file.action === "create") {
        lines.push(chalk.green(`    + ${file.path}`));
      } else if (file.action === "update") {
        lines.push(chalk.yellow(`    ~ ${file.path}`));
      } else if (file.action === "delete") {
        lines.push(chalk.red(`    - ${file.path}`));
      }

      // Content diff for structured data files
      if (file.diffLines) {
        for (const diffLine of file.diffLines) {
          lines.push(`      ${formatDiffLine(diffLine)}`);
        }
      }
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test test/unit/sync-report-formatter.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/output/sync-report.ts test/unit/sync-report-formatter.test.ts
git commit -m "feat: render diffLines in CLI output with chalk formatting (#599)"
```

---

### Task 8: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Run type checking**

Run: `npm run test:typecheck`
Expected: PASS

- [ ] **Step 3: Run linting**

Run: `./lint.sh`
Expected: PASS

- [ ] **Step 4: Check test coverage for changed files**

Run: `npm test -- --experimental-test-coverage`

Verify coverage meets 95% for:
- `src/sync/diff-utils.ts`
- `src/sync/file-writer.ts`
- `src/sync/file-sync-strategy.ts`
- `src/sync/manifest-manager.ts`
- `src/cli/sync-report-builder.ts`
- `src/output/unified-summary.ts`
- `src/output/sync-report.ts`

- [ ] **Step 5: Commit any remaining fixes**

If lint/typecheck/coverage required changes, commit them.

---

### Task 9: Documentation update

**Files:**
- Modify: docs page covering sync output (find exact page first)

- [ ] **Step 1: Identify the docs page to update**

Run: `grep -r "summary\|plan\|dry.run\|output" docs/ --include="*.md" -l`

Find the page that describes sync output or the plan/dry-run feature.

- [ ] **Step 2: Add section about JSON/YAML content diffs**

Add a brief section explaining:
- JSON/YAML files (`.json`, `.json5`, `.yaml`, `.yml`) now show unified content diffs in both CLI output and GitHub Step Summary
- Diffs appear in both dry-run (plan) and apply modes
- Diffs are shown for creates (all additions), updates (changed regions), and deletes (all removals)

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: document JSON/YAML content diffs in sync output (#599)"
```
