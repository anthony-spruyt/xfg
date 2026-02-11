# Sync Output Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Resource-based sync output with a repo-grouped format matching the settings output redesign.

**Architecture:** Create `SyncReport` types parallel to `SettingsReport`, with per-file change tracking. Build formatters for CLI and markdown output. Wire into sync-command, then delete legacy code.

**Tech Stack:** TypeScript, Node.js test runner, chalk for CLI colors

---

## Task 1: Create SyncReport Types

**Files:**

- Create: `src/output/sync-report.ts`
- Test: `test/unit/sync-report-formatter.test.ts`

**Step 1: Write the failing test for types**

```typescript
// test/unit/sync-report-formatter.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import type {
  SyncReport,
  RepoFileChanges,
  FileChange,
} from "../../src/output/sync-report.js";

describe("sync-report types", () => {
  test("SyncReport structure is correct", () => {
    const report: SyncReport = {
      repos: [],
      totals: {
        files: { create: 0, update: 0, delete: 0 },
      },
    };
    assert.ok(report);
  });

  test("RepoFileChanges structure is correct", () => {
    const repoChanges: RepoFileChanges = {
      repoName: "org/repo",
      files: [],
    };
    assert.ok(repoChanges);
  });

  test("FileChange structure is correct", () => {
    const change: FileChange = {
      path: ".github/workflows/ci.yml",
      action: "create",
    };
    assert.ok(change);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "sync-report types"`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/output/sync-report.ts

export interface SyncReport {
  repos: RepoFileChanges[];
  totals: {
    files: { create: number; update: number; delete: number };
  };
}

export interface RepoFileChanges {
  repoName: string;
  files: FileChange[];
  prUrl?: string;
  mergeOutcome?: "manual" | "auto" | "force" | "direct";
  error?: string;
}

export interface FileChange {
  path: string;
  action: "create" | "update" | "delete";
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "sync-report types"`
Expected: PASS

**Step 5: Commit**

```bash
git add test/unit/sync-report-formatter.test.ts src/output/sync-report.ts
git commit -m "feat(output): add SyncReport types for sync output redesign"
```

---

## Task 2: Create CLI Formatter - Empty Report

**Files:**

- Modify: `src/output/sync-report.ts`
- Modify: `test/unit/sync-report-formatter.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to test/unit/sync-report-formatter.test.ts
import {
  formatSyncReportCLI,
  type SyncReport,
  type RepoFileChanges,
  type FileChange,
} from "../../src/output/sync-report.js";

describe("formatSyncReportCLI", () => {
  test("renders empty report as no changes", () => {
    const report: SyncReport = {
      repos: [],
      totals: {
        files: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSyncReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("No changes"), "should show no changes message");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "formatSyncReportCLI"`
Expected: FAIL with "formatSyncReportCLI is not a function"

**Step 3: Write minimal implementation**

```typescript
// Add to src/output/sync-report.ts

function formatSummary(totals: SyncReport["totals"]): string {
  const total = totals.files.create + totals.files.update + totals.files.delete;

  if (total === 0) {
    return "No changes";
  }

  const parts: string[] = [];
  if (totals.files.create > 0) parts.push(`${totals.files.create} to create`);
  if (totals.files.update > 0) parts.push(`${totals.files.update} to update`);
  if (totals.files.delete > 0) parts.push(`${totals.files.delete} to delete`);

  const fileWord = total === 1 ? "file" : "files";
  return `Plan: ${total} ${fileWord} (${parts.join(", ")})`;
}

export function formatSyncReportCLI(report: SyncReport): string[] {
  const lines: string[] = [];
  lines.push(formatSummary(report.totals));
  return lines;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "formatSyncReportCLI"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/sync-report.ts test/unit/sync-report-formatter.test.ts
git commit -m "feat(output): add formatSyncReportCLI with empty report handling"
```

---

## Task 3: CLI Formatter - Single Repo with Files

**Files:**

- Modify: `src/output/sync-report.ts`
- Modify: `test/unit/sync-report-formatter.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to describe("formatSyncReportCLI")
test("renders repo with file changes", () => {
  const report: SyncReport = {
    repos: [
      {
        repoName: "org/repo",
        files: [
          { path: ".github/workflows/ci.yml", action: "create" },
          { path: ".github/CODEOWNERS", action: "update" },
          { path: ".github/old-workflow.yml", action: "delete" },
        ],
      },
    ],
    totals: {
      files: { create: 1, update: 1, delete: 1 },
    },
  };

  const lines = formatSyncReportCLI(report);
  const output = lines.join("\n");

  assert.ok(output.includes("org/repo"), "should include repo name");
  assert.ok(output.includes("ci.yml"), "should include created file");
  assert.ok(output.includes("CODEOWNERS"), "should include updated file");
  assert.ok(output.includes("old-workflow.yml"), "should include deleted file");
  assert.ok(output.includes("3 files"), "should include summary");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "renders repo with file changes"`
Expected: FAIL - output doesn't include repo name

**Step 3: Write minimal implementation**

```typescript
// Replace formatSyncReportCLI in src/output/sync-report.ts
import chalk from "chalk";

export function formatSyncReportCLI(report: SyncReport): string[] {
  const lines: string[] = [];

  for (const repo of report.repos) {
    if (repo.files.length === 0 && !repo.error) {
      continue;
    }

    // Repo header
    lines.push(chalk.yellow(`~ ${repo.repoName}`));

    // Files
    for (const file of repo.files) {
      if (file.action === "create") {
        lines.push(chalk.green(`    + ${file.path}`));
      } else if (file.action === "update") {
        lines.push(chalk.yellow(`    ~ ${file.path}`));
      } else if (file.action === "delete") {
        lines.push(chalk.red(`    - ${file.path}`));
      }
    }

    lines.push(""); // Blank line between repos
  }

  // Summary
  lines.push(formatSummary(report.totals));

  return lines;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "renders repo with file changes"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/sync-report.ts test/unit/sync-report-formatter.test.ts
git commit -m "feat(output): add file change rendering to sync CLI formatter"
```

---

## Task 4: CLI Formatter - Multiple Repos and Errors

**Files:**

- Modify: `src/output/sync-report.ts`
- Modify: `test/unit/sync-report-formatter.test.ts`

**Step 1: Write the failing tests**

```typescript
// Add to describe("formatSyncReportCLI")
test("renders multiple repos with blank lines between", () => {
  const report: SyncReport = {
    repos: [
      {
        repoName: "org/repo1",
        files: [{ path: "README.md", action: "create" }],
      },
      {
        repoName: "org/repo2",
        files: [{ path: "LICENSE", action: "update" }],
      },
    ],
    totals: {
      files: { create: 1, update: 1, delete: 0 },
    },
  };

  const lines = formatSyncReportCLI(report);
  const output = lines.join("\n");

  assert.ok(output.includes("org/repo1"), "should include first repo");
  assert.ok(output.includes("org/repo2"), "should include second repo");
  const repo1Index = lines.findIndex((l) => l.includes("org/repo1"));
  const repo2Index = lines.findIndex((l) => l.includes("org/repo2"));
  assert.ok(
    repo2Index > repo1Index + 2,
    "should have separation between repos"
  );
});

test("renders repo with error", () => {
  const report: SyncReport = {
    repos: [
      {
        repoName: "org/failed-repo",
        files: [],
        error: "Connection refused",
      },
    ],
    totals: {
      files: { create: 0, update: 0, delete: 0 },
    },
  };

  const lines = formatSyncReportCLI(report);
  const output = lines.join("\n");

  assert.ok(output.includes("org/failed-repo"), "should include repo name");
  assert.ok(output.includes("Error:"), "should show error label");
  assert.ok(output.includes("Connection refused"), "should show error message");
});

test("renders repo with PR URL info", () => {
  const report: SyncReport = {
    repos: [
      {
        repoName: "org/repo",
        files: [{ path: "README.md", action: "update" }],
        prUrl: "https://github.com/org/repo/pull/42",
        mergeOutcome: "manual",
      },
    ],
    totals: {
      files: { create: 0, update: 1, delete: 0 },
    },
  };

  const lines = formatSyncReportCLI(report);
  const output = lines.join("\n");

  assert.ok(output.includes("org/repo"), "should include repo name");
  // PR info is optional in CLI output - just verify no crash
  assert.ok(output.includes("README.md"), "should include file");
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "formatSyncReportCLI"`
Expected: FAIL - error rendering not implemented

**Step 3: Update implementation**

```typescript
// Update formatSyncReportCLI in src/output/sync-report.ts
export function formatSyncReportCLI(report: SyncReport): string[] {
  const lines: string[] = [];

  for (const repo of report.repos) {
    if (repo.files.length === 0 && !repo.error) {
      continue;
    }

    // Repo header
    lines.push(chalk.yellow(`~ ${repo.repoName}`));

    // Files
    for (const file of repo.files) {
      if (file.action === "create") {
        lines.push(chalk.green(`    + ${file.path}`));
      } else if (file.action === "update") {
        lines.push(chalk.yellow(`    ~ ${file.path}`));
      } else if (file.action === "delete") {
        lines.push(chalk.red(`    - ${file.path}`));
      }
    }

    // Error
    if (repo.error) {
      lines.push(chalk.red(`    Error: ${repo.error}`));
    }

    lines.push(""); // Blank line between repos
  }

  // Summary
  lines.push(formatSummary(report.totals));

  return lines;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "formatSyncReportCLI"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/sync-report.ts test/unit/sync-report-formatter.test.ts
git commit -m "feat(output): add error handling and multi-repo support to sync CLI"
```

---

## Task 5: Markdown Formatter

**Files:**

- Modify: `src/output/sync-report.ts`
- Modify: `test/unit/sync-report-formatter.test.ts`

**Step 1: Write the failing tests**

````typescript
// Add to test file
import {
  formatSyncReportCLI,
  formatSyncReportMarkdown,
  type SyncReport,
  type RepoFileChanges,
  type FileChange,
} from "../../src/output/sync-report.js";

describe("formatSyncReportMarkdown", () => {
  test("includes dry run warning when dryRun=true", () => {
    const report: SyncReport = {
      repos: [
        {
          repoName: "org/repo",
          files: [{ path: "README.md", action: "update" }],
        },
      ],
      totals: {
        files: { create: 0, update: 1, delete: 0 },
      },
    };

    const markdown = formatSyncReportMarkdown(report, true);

    assert.ok(
      markdown.includes("(Dry Run)"),
      "should include dry run in title"
    );
    assert.ok(
      markdown.includes("[!WARNING]"),
      "should include warning callout"
    );
    assert.ok(
      markdown.includes("no changes were applied"),
      "should explain dry run"
    );
  });

  test("wraps output in diff code block", () => {
    const report: SyncReport = {
      repos: [
        {
          repoName: "org/repo",
          files: [
            { path: ".github/ci.yml", action: "create" },
            { path: "README.md", action: "update" },
          ],
        },
      ],
      totals: {
        files: { create: 1, update: 1, delete: 0 },
      },
    };

    const markdown = formatSyncReportMarkdown(report, false);

    assert.ok(markdown.includes("```diff"), "should have diff code block");
    assert.ok(markdown.includes("org/repo"), "should include repo name");
    assert.ok(markdown.includes("ci.yml"), "should include file");
  });

  test("includes plan summary as bold text", () => {
    const report: SyncReport = {
      repos: [
        {
          repoName: "org/repo",
          files: [{ path: "README.md", action: "update" }],
        },
      ],
      totals: {
        files: { create: 0, update: 1, delete: 0 },
      },
    };

    const markdown = formatSyncReportMarkdown(report, false);

    assert.ok(markdown.includes("**Plan:"), "should have bold plan summary");
  });

  test("renders error in markdown", () => {
    const report: SyncReport = {
      repos: [
        {
          repoName: "org/failed-repo",
          files: [],
          error: "Connection refused",
        },
      ],
      totals: {
        files: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatSyncReportMarkdown(report, false);

    assert.ok(markdown.includes("org/failed-repo"), "should include repo name");
    assert.ok(
      markdown.includes("Error:") || markdown.includes("!"),
      "should indicate error"
    );
  });
});
````

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "formatSyncReportMarkdown"`
Expected: FAIL with "formatSyncReportMarkdown is not a function"

**Step 3: Write implementation**

````typescript
// Add to src/output/sync-report.ts
export function formatSyncReportMarkdown(
  report: SyncReport,
  dryRun: boolean
): string {
  const lines: string[] = [];

  // Title
  const titleSuffix = dryRun ? " (Dry Run)" : "";
  lines.push(`## Config Sync Summary${titleSuffix}`);
  lines.push("");

  // Dry-run warning
  if (dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  // Diff block
  const diffLines: string[] = [];

  for (const repo of report.repos) {
    if (repo.files.length === 0 && !repo.error) {
      continue;
    }

    diffLines.push(`~ ${repo.repoName}`);

    for (const file of repo.files) {
      if (file.action === "create") {
        diffLines.push(`    + ${file.path}`);
      } else if (file.action === "update") {
        diffLines.push(`    ~ ${file.path}`);
      } else if (file.action === "delete") {
        diffLines.push(`    - ${file.path}`);
      }
    }

    if (repo.error) {
      diffLines.push(`    ! Error: ${repo.error}`);
    }
  }

  if (diffLines.length > 0) {
    lines.push("```diff");
    lines.push(...diffLines);
    lines.push("```");
    lines.push("");
  }

  // Summary
  lines.push(`**${formatSummary(report.totals)}**`);

  return lines.join("\n");
}
````

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "formatSyncReportMarkdown"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/sync-report.ts test/unit/sync-report-formatter.test.ts
git commit -m "feat(output): add markdown formatter for sync report"
```

---

## Task 6: Add File Writer for GitHub Summary

**Files:**

- Modify: `src/output/sync-report.ts`
- Modify: `test/unit/sync-report-formatter.test.ts`

**Step 1: Write the failing tests**

```typescript
// Add imports
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach } from "node:test";

// Add new describe block
describe("writeSyncReportSummary", () => {
  let tempFile: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempFile = join(tmpdir(), `sync-report-test-${Date.now()}.md`);
    originalEnv = process.env.GITHUB_STEP_SUMMARY;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GITHUB_STEP_SUMMARY;
    } else {
      process.env.GITHUB_STEP_SUMMARY = originalEnv;
    }
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  });

  test("writes markdown to GITHUB_STEP_SUMMARY path", () => {
    process.env.GITHUB_STEP_SUMMARY = tempFile;
    const report: SyncReport = {
      repos: [
        {
          repoName: "org/repo",
          files: [{ path: "README.md", action: "update" }],
        },
      ],
      totals: {
        files: { create: 0, update: 1, delete: 0 },
      },
    };

    writeSyncReportSummary(report, false);

    assert.ok(existsSync(tempFile));
    const content = readFileSync(tempFile, "utf-8");
    assert.ok(content.includes("Config Sync Summary"));
  });

  test("no-ops when env var not set", () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    const report: SyncReport = {
      repos: [],
      totals: {
        files: { create: 0, update: 0, delete: 0 },
      },
    };

    writeSyncReportSummary(report, false);

    assert.ok(!existsSync(tempFile));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "writeSyncReportSummary"`
Expected: FAIL with "writeSyncReportSummary is not a function"

**Step 3: Write implementation**

```typescript
// Add to src/output/sync-report.ts
import { appendFileSync } from "node:fs";

export function writeSyncReportSummary(
  report: SyncReport,
  dryRun: boolean
): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatSyncReportMarkdown(report, dryRun);
  appendFileSync(summaryPath, "\n" + markdown + "\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "writeSyncReportSummary"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/sync-report.ts test/unit/sync-report-formatter.test.ts
git commit -m "feat(output): add writeSyncReportSummary for GitHub Actions"
```

---

## Task 7: Create Sync Report Builder

**Files:**

- Create: `src/cli/sync-report-builder.ts`
- Create: `test/unit/sync-report-builder.test.ts`

**Step 1: Write the failing test**

```typescript
// test/unit/sync-report-builder.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { buildSyncReport } from "../../src/cli/sync-report-builder.js";
import type { SyncReport } from "../../src/output/sync-report.js";

describe("buildSyncReport", () => {
  test("builds report from empty results", () => {
    const report = buildSyncReport([]);

    assert.deepEqual(report.repos, []);
    assert.deepEqual(report.totals, {
      files: { create: 0, update: 0, delete: 0 },
    });
  });

  test("builds report from processor result with file changes", () => {
    const results = [
      {
        repoName: "org/repo",
        success: true,
        fileChanges: [
          { path: ".github/ci.yml", action: "create" as const },
          { path: "README.md", action: "update" as const },
        ],
      },
    ];

    const report = buildSyncReport(results);

    assert.equal(report.repos.length, 1);
    assert.equal(report.repos[0].repoName, "org/repo");
    assert.equal(report.repos[0].files.length, 2);
    assert.deepEqual(report.totals, {
      files: { create: 1, update: 1, delete: 0 },
    });
  });

  test("builds report with PR URL and merge outcome", () => {
    const results = [
      {
        repoName: "org/repo",
        success: true,
        fileChanges: [{ path: "README.md", action: "update" as const }],
        prUrl: "https://github.com/org/repo/pull/42",
        mergeOutcome: "manual" as const,
      },
    ];

    const report = buildSyncReport(results);

    assert.equal(report.repos[0].prUrl, "https://github.com/org/repo/pull/42");
    assert.equal(report.repos[0].mergeOutcome, "manual");
  });

  test("builds report with error", () => {
    const results = [
      {
        repoName: "org/failed-repo",
        success: false,
        error: "Connection refused",
        fileChanges: [],
      },
    ];

    const report = buildSyncReport(results);

    assert.equal(report.repos[0].error, "Connection refused");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "buildSyncReport"`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// src/cli/sync-report-builder.ts
import type {
  SyncReport,
  RepoFileChanges,
  FileChange,
} from "../output/sync-report.js";

interface FileChangeInput {
  path: string;
  action: "create" | "update" | "delete";
}

interface SyncResultInput {
  repoName: string;
  success: boolean;
  fileChanges: FileChangeInput[];
  prUrl?: string;
  mergeOutcome?: "manual" | "auto" | "force" | "direct";
  error?: string;
}

export function buildSyncReport(results: SyncResultInput[]): SyncReport {
  const repos: RepoFileChanges[] = [];
  const totals = {
    files: { create: 0, update: 0, delete: 0 },
  };

  for (const result of results) {
    const files: FileChange[] = result.fileChanges.map((f) => ({
      path: f.path,
      action: f.action,
    }));

    // Count totals
    for (const file of files) {
      if (file.action === "create") totals.files.create++;
      else if (file.action === "update") totals.files.update++;
      else if (file.action === "delete") totals.files.delete++;
    }

    repos.push({
      repoName: result.repoName,
      files,
      prUrl: result.prUrl,
      mergeOutcome: result.mergeOutcome,
      error: result.error,
    });
  }

  return { repos, totals };
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "buildSyncReport"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/sync-report-builder.ts test/unit/sync-report-builder.test.ts
git commit -m "feat(cli): add sync report builder to convert processor results"
```

---

## Task 8: Add FileChangeDetail to ProcessorResult

**Files:**

- Modify: `src/sync/types.ts`

**Step 1: Read current types.ts to understand exact location**

Run: Read `src/sync/types.ts` around line 285

**Step 2: Add FileChangeDetail interface and update ProcessorResult**

```typescript
// Add after DiffStats interface (around line 265)
export interface FileChangeDetail {
  path: string;
  action: "create" | "update" | "delete";
}

// Update ProcessorResult interface (around line 285)
export interface ProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  prUrl?: string;
  skipped?: boolean;
  mergeResult?: {
    merged: boolean;
    autoMergeEnabled?: boolean;
    message: string;
  };
  diffStats?: DiffStats;
  fileChanges?: FileChangeDetail[]; // ADD THIS LINE
}
```

**Step 3: Build to verify**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/sync/types.ts
git commit -m "feat(sync): add FileChangeDetail type to ProcessorResult"
```

---

## Task 9: Update Repository Processor to Return File Changes

**Files:**

- Modify: `src/sync/repository-processor.ts`

**Step 1: Read the file to understand the flow**

The processor gets `changedFiles: FileAction[]` from `fileSyncOrchestrator.sync()`. We need to map these to `FileChangeDetail[]`.

**Step 2: Add mapping function and update returns**

```typescript
// Add import at top
import type { FileChangeDetail } from "./types.js";

// Add helper function after imports
function mapToFileChangeDetails(
  changedFiles: FileAction[]
): FileChangeDetail[] {
  return changedFiles
    .filter((f) => f.action !== "skip")
    .map((f) => ({
      path: f.fileName,
      action: f.action as "create" | "update" | "delete",
    }));
}

// In process() method, after getting changedFiles (around line 160):
const fileChangeDetails = mapToFileChangeDetails(changedFiles);

// Update all ProcessorResult returns to include fileChanges: fileChangeDetails
// There are returns around lines 170, 207, 217, and in handlePRFlow
```

**Step 3: Build to verify**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/sync/repository-processor.ts
git commit -m "feat(sync): include file change details in processor results"
```

---

## Task 10: Update PR Merge Handler

**Files:**

- Modify: `src/sync/pr-merge-handler.ts`

**Step 1: Update handlePRAndMerge signature to accept fileChanges**

```typescript
// Update the method signature
async handlePRAndMerge(
  options: PRHandlerOptions,
  changedFiles: FileAction[],
  repoName: string,
  diffStats?: DiffStats,
  fileChanges?: FileChangeDetail[]  // ADD THIS
): Promise<ProcessorResult>

// Update the return to include fileChanges
return {
  success: prResult.success,
  repoName,
  message: prResult.message,
  prUrl: prResult.url,
  mergeResult,
  diffStats,
  fileChanges,  // ADD THIS
};
```

**Step 2: Update caller in repository-processor.ts**

Pass `fileChangeDetails` to `handlePRAndMerge`.

**Step 3: Build to verify**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/sync/pr-merge-handler.ts src/sync/repository-processor.ts
git commit -m "feat(sync): pass file changes through PR handler"
```

---

## Task 11: Wire New Report to Sync Command

**Files:**

- Modify: `src/cli/sync-command.ts`

**Step 1: Update imports**

```typescript
// Replace old imports
// Remove: import { Plan, printPlan } from "../output/plan-formatter.js";
// Remove: import { writePlanSummary } from "../output/plan-summary.js";
// Remove: import { syncResultToResources } from "../settings/resource-converters.js";
// Remove: import { RepoResult } from "../output/github-summary.js";

// Add new imports
import { buildSyncReport } from "./sync-report-builder.js";
import {
  formatSyncReportCLI,
  writeSyncReportSummary,
} from "../output/sync-report.js";
```

**Step 2: Replace results collection**

```typescript
// Replace: const results: RepoResult[] = [];
// Replace: const plan: Plan = { resources: [], errors: [] };

// With:
interface SyncResultEntry {
  repoName: string;
  success: boolean;
  fileChanges: Array<{ path: string; action: "create" | "update" | "delete" }>;
  prUrl?: string;
  mergeOutcome?: "manual" | "auto" | "force" | "direct";
  error?: string;
}
const reportResults: SyncResultEntry[] = [];
```

**Step 3: Update the processing loop**

```typescript
// After getting result from processor.process(), replace the results/plan building:
const mergeOutcome = determineMergeOutcome(result);

reportResults.push({
  repoName,
  success: result.success,
  fileChanges: result.fileChanges ?? [],
  prUrl: result.prUrl,
  mergeOutcome,
  error: result.success ? undefined : result.message,
});

// Add helper function
function determineMergeOutcome(
  result: ProcessorResult
): "manual" | "auto" | "force" | "direct" | undefined {
  if (!result.success) return undefined;
  if (!result.prUrl) return "direct";
  if (result.mergeResult?.merged) return "force";
  if (result.mergeResult?.autoMergeEnabled) return "auto";
  return "manual";
}
```

**Step 4: Replace output section**

```typescript
// Replace:
// console.log("");
// printPlan(plan);
// writePlanSummary(plan, { title: "Config Sync Summary", dryRun: options.dryRun ?? false });

// With:
const report = buildSyncReport(reportResults);
console.log("");
for (const line of formatSyncReportCLI(report)) {
  console.log(line);
}
writeSyncReportSummary(report, options.dryRun ?? false);

// Update error check:
const hasErrors = reportResults.some((r) => r.error);
if (hasErrors) {
  process.exit(1);
}
```

**Step 5: Build to verify**

Run: `npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add src/cli/sync-command.ts
git commit -m "feat(cli): wire sync command to new report system"
```

---

## Task 12: Delete resource-converters.ts

**Files:**

- Delete: `src/settings/resource-converters.ts`

**Step 1: Verify no remaining usages**

Run: `grep -r "resource-converters" src/`
Expected: No results (sync-command.ts should no longer import it)

**Step 2: Delete the file**

```bash
rm src/settings/resource-converters.ts
```

**Step 3: Build to verify**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor(settings): remove unused resource-converters.ts"
```

---

## Task 13: Delete plan-formatter.ts

**Files:**

- Delete: `src/output/plan-formatter.ts`
- Modify: `src/output/index.ts`

**Step 1: Verify no remaining usages**

Run: `grep -r "plan-formatter" src/`
Expected: Only index.ts

**Step 2: Update index.ts**

Remove the plan-formatter export.

**Step 3: Delete the file**

```bash
rm src/output/plan-formatter.ts
```

**Step 4: Build to verify**

Run: `npm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(output): remove unused plan-formatter.ts"
```

---

## Task 14: Delete plan-summary.ts

**Files:**

- Delete: `src/output/plan-summary.ts`
- Modify: `src/output/index.ts`

**Step 1: Verify no remaining usages**

Run: `grep -r "plan-summary" src/`
Expected: Only index.ts

**Step 2: Update index.ts**

Remove the plan-summary export.

**Step 3: Delete the file**

```bash
rm src/output/plan-summary.ts
```

**Step 4: Build to verify**

Run: `npm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(output): remove unused plan-summary.ts"
```

---

## Task 15: Delete github-summary.ts

**Files:**

- Delete: `src/output/github-summary.ts`
- Modify: `src/output/index.ts`
- Check: `src/output/summary-utils.ts` for type references

**Step 1: Check summary-utils.ts for type dependencies**

Read summary-utils.ts to see if it imports from github-summary.ts.

**Step 2: Update summary-utils.ts if needed**

If it imports types like `RepoResult`, either move those types or remove them if unused.

**Step 3: Update index.ts**

Remove the github-summary export.

**Step 4: Delete the file**

```bash
rm src/output/github-summary.ts
```

**Step 5: Build to verify**

Run: `npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(output): remove unused github-summary.ts"
```

---

## Task 16: Update Output Index Exports

**Files:**

- Modify: `src/output/index.ts`

**Step 1: Add sync-report export**

```typescript
// src/output/index.ts
export * from "./sync-report.js";
export * from "./settings-report.js";
export * from "./summary-utils.js";
```

**Step 2: Build to verify**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/output/index.ts
git commit -m "chore(output): update index exports for sync-report"
```

---

## Task 17: Run All Tests

**Files:**

- None (verification only)

**Step 1: Run unit tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Fix any failing tests**

If tests fail due to removed modules, update the test imports.

**Step 3: Commit fixes**

```bash
git add -A
git commit -m "test: fix tests after sync output redesign"
```

---

## Task 18: Run Linting

**Files:**

- None (verification only)

**Step 1: Run linting**

Run: `./lint.sh`
Expected: No errors

**Step 2: Fix any lint issues**

**Step 3: Commit fixes**

```bash
git add -A
git commit -m "chore: fix lint issues from sync output redesign"
```

---

## Task 19: Manual Integration Test

**Files:**

- None (verification only)

**Step 1: Build**

Run: `npm run build`
Expected: No errors

**Step 2: Test with dry-run**

Run: `npm run dev -- sync --config examples/github-sync.yaml --dry-run`
Expected: Output shows repo-grouped format:

```
~ org/repo
    + .github/workflows/ci.yml
    ~ README.md

Plan: 2 files (1 to create, 1 to update)
```

**Step 3: Verify GitHub summary would work**

Set `GITHUB_STEP_SUMMARY=/tmp/test-summary.md` and run again, then check the file.

---

## Summary

After completing all tasks:

1. **New files created:**
   - `src/output/sync-report.ts` - Types and formatters
   - `src/cli/sync-report-builder.ts` - Builder function
   - `test/unit/sync-report-formatter.test.ts` - Tests
   - `test/unit/sync-report-builder.test.ts` - Tests

2. **Files modified:**
   - `src/cli/sync-command.ts` - Uses new report system
   - `src/sync/types.ts` - Added FileChangeDetail
   - `src/sync/repository-processor.ts` - Returns file changes
   - `src/sync/pr-merge-handler.ts` - Passes file changes
   - `src/output/index.ts` - Updated exports

3. **Files deleted:**
   - `src/output/plan-formatter.ts`
   - `src/output/plan-summary.ts`
   - `src/output/github-summary.ts`
   - `src/settings/resource-converters.ts`

**Output format now matches settings command:**

```
~ anthony-spruyt/repo-operator
    + .github/workflows/ci.yml
    ~ .github/CODEOWNERS
    - .github/old-workflow.yml

~ other-org/other-repo
    ~ README.md

Plan: 3 files (1 to create, 2 to update, 1 to delete)
```
