// test/unit/sync-report-formatter.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatSyncReportCLI,
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
