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
});
