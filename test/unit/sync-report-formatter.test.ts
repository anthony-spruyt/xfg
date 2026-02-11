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
});
