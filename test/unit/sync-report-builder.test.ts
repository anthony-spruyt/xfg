// test/unit/sync-report-builder.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { buildSyncReport } from "../../src/cli/sync-report-builder.js";

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
