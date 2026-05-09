import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildLifecycleReport } from "../../../src/cli/lifecycle-report-builder.js";

describe("buildLifecycleReport", () => {
  test("empty input returns zero totals", () => {
    const report = buildLifecycleReport([]);
    assert.deepStrictEqual(report.totals, {
      created: 0,
      forked: 0,
      migrated: 0,
      existed: 0,
    });
    assert.equal(report.actions.length, 0);
  });

  test("counts each action type", () => {
    const report = buildLifecycleReport([
      { repoName: "a", action: "created" },
      { repoName: "b", action: "existed" },
      { repoName: "c", action: "forked", upstream: "org/upstream" },
      { repoName: "d", action: "existed" },
    ]);
    assert.equal(report.totals.created, 1);
    assert.equal(report.totals.existed, 2);
    assert.equal(report.totals.forked, 1);
    assert.equal(report.totals.migrated, 0);
    assert.equal(report.actions.length, 4);
  });

  test("preserves upstream and source fields", () => {
    const report = buildLifecycleReport([
      {
        repoName: "fork-repo",
        action: "forked",
        upstream: "org/upstream",
        source: "org/source",
      },
    ]);
    assert.equal(report.actions[0].upstream, "org/upstream");
    assert.equal(report.actions[0].source, "org/source");
  });

  test("preserves settings field", () => {
    const report = buildLifecycleReport([
      {
        repoName: "new-repo",
        action: "created",
        settings: { visibility: "private", description: "test" },
      },
    ]);
    assert.deepStrictEqual(report.actions[0].settings, {
      visibility: "private",
      description: "test",
    });
  });
});
