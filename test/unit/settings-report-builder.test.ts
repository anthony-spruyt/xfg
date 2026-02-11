import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { buildSettingsReport } from "../../src/cli/settings-report-builder.js";

describe("buildSettingsReport", () => {
  test("converts settings processor result to SettingsReport", () => {
    const results = [
      {
        repoName: "org/repo",
        settingsResult: {
          planOutput: {
            entries: [
              {
                property: "deleteBranchOnMerge",
                action: "change" as const,
                oldValue: false,
                newValue: true,
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.repos.length, 1);
    assert.equal(report.repos[0].repoName, "org/repo");
    assert.equal(report.repos[0].settings.length, 1);
    assert.equal(report.repos[0].settings[0].name, "deleteBranchOnMerge");
    assert.equal(report.repos[0].settings[0].action, "change");
    assert.equal(report.totals.settings.change, 1);
  });

  test("converts ruleset processor result to SettingsReport", () => {
    const results = [
      {
        repoName: "org/repo",
        rulesetResult: {
          planOutput: {
            entries: [
              {
                name: "branch-protection",
                action: "update" as const,
                propertyDiffs: [
                  {
                    path: ["enforcement"],
                    action: "change" as const,
                    oldValue: "active",
                    newValue: "evaluate",
                  },
                ],
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.repos.length, 1);
    assert.equal(report.repos[0].rulesets.length, 1);
    assert.equal(report.repos[0].rulesets[0].name, "branch-protection");
    assert.equal(report.repos[0].rulesets[0].action, "update");
    assert.equal(report.totals.rulesets.update, 1);
  });

  test("includes error in repo entry", () => {
    const results = [
      {
        repoName: "org/repo",
        error: "Connection failed",
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.repos.length, 1);
    assert.equal(report.repos[0].error, "Connection failed");
  });

  test("aggregates totals correctly", () => {
    const results = [
      {
        repoName: "org/repo1",
        settingsResult: {
          planOutput: {
            entries: [
              { property: "p1", action: "add" as const, newValue: true },
              {
                property: "p2",
                action: "change" as const,
                oldValue: 1,
                newValue: 2,
              },
            ],
          },
        },
        rulesetResult: {
          planOutput: {
            entries: [{ name: "r1", action: "create" as const }],
          },
        },
      },
      {
        repoName: "org/repo2",
        rulesetResult: {
          planOutput: {
            entries: [{ name: "r2", action: "delete" as const }],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.totals.settings.add, 1);
    assert.equal(report.totals.settings.change, 1);
    assert.equal(report.totals.rulesets.create, 1);
    assert.equal(report.totals.rulesets.delete, 1);
  });
});
