// test/unit/sync-report-formatter.test.ts
import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatSyncReportCLI,
  formatSyncReportMarkdown,
  writeSyncReportSummary,
  type SyncReport,
  type RepoFileChanges,
  type FileChange,
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
    assert.ok(
      output.includes("old-workflow.yml"),
      "should include deleted file"
    );
    assert.ok(output.includes("3 files"), "should include summary");
  });

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
    assert.ok(
      output.includes("Connection refused"),
      "should show error message"
    );
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
});

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
