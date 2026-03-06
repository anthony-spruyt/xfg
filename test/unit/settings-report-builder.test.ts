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
                action: "update" as const,
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
    assert.equal(report.repos[0].settings[0].action, "update");
    assert.equal(report.totals.settings.update, 1);
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
              { property: "p1", action: "create" as const, newValue: true },
              {
                property: "p2",
                action: "update" as const,
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

    assert.equal(report.totals.settings.create, 1);
    assert.equal(report.totals.settings.update, 1);
    assert.equal(report.totals.rulesets.create, 1);
    assert.equal(report.totals.rulesets.delete, 1);
  });

  test("converts labelsResult with create/update/delete entries", () => {
    const results = [
      {
        repoName: "org/repo",
        labelsResult: {
          planOutput: {
            entries: [
              {
                name: "bug",
                action: "create" as const,
                config: { color: "d73a4a", description: "Something is broken" },
              },
              {
                name: "old-name",
                action: "update" as const,
                newName: "new-name",
                propertyChanges: [
                  {
                    property: "color",
                    oldValue: "ffffff",
                    newValue: "000000",
                  },
                ],
              },
              {
                name: "stale",
                action: "delete" as const,
              },
              {
                name: "keep-me",
                action: "unchanged" as const,
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    // Unchanged entries should be filtered out
    assert.equal(report.repos[0].labels.length, 3);

    // Verify create entry
    const createLabel = report.repos[0].labels[0];
    assert.equal(createLabel.name, "bug");
    assert.equal(createLabel.action, "create");
    assert.deepEqual(createLabel.config, {
      color: "d73a4a",
      description: "Something is broken",
    });

    // Verify update entry
    const updateLabel = report.repos[0].labels[1];
    assert.equal(updateLabel.name, "old-name");
    assert.equal(updateLabel.action, "update");
    assert.equal(updateLabel.newName, "new-name");
    assert.deepEqual(updateLabel.propertyChanges, [
      { property: "color", oldValue: "ffffff", newValue: "000000" },
    ]);

    // Verify delete entry
    const deleteLabel = report.repos[0].labels[2];
    assert.equal(deleteLabel.name, "stale");
    assert.equal(deleteLabel.action, "delete");

    // Verify totals
    assert.equal(report.totals.labels.create, 1);
    assert.equal(report.totals.labels.update, 1);
    assert.equal(report.totals.labels.delete, 1);
  });

  test("aggregates label totals across multiple repos", () => {
    const results = [
      {
        repoName: "org/repo1",
        labelsResult: {
          planOutput: {
            entries: [
              {
                name: "bug",
                action: "create" as const,
                config: { color: "d73a4a" },
              },
              {
                name: "feature",
                action: "create" as const,
                config: { color: "0075ca" },
              },
            ],
          },
        },
      },
      {
        repoName: "org/repo2",
        labelsResult: {
          planOutput: {
            entries: [
              {
                name: "old",
                action: "delete" as const,
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.totals.labels.create, 2);
    assert.equal(report.totals.labels.update, 0);
    assert.equal(report.totals.labels.delete, 1);
  });

  test("initializes labels as empty array when no labelsResult", () => {
    const results = [
      {
        repoName: "org/repo",
        settingsResult: {
          planOutput: {
            entries: [
              {
                property: "hasWiki",
                action: "update" as const,
                oldValue: true,
                newValue: false,
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    assert.deepEqual(report.repos[0].labels, []);
    assert.equal(report.totals.labels.create, 0);
    assert.equal(report.totals.labels.update, 0);
    assert.equal(report.totals.labels.delete, 0);
  });

  test("skips settings where both oldValue and newValue are undefined", () => {
    const results = [
      {
        repoName: "org/repo",
        settingsResult: {
          planOutput: {
            entries: [
              {
                property: "has_issues",
                action: "update" as const,
                oldValue: undefined,
                newValue: undefined,
              },
              {
                property: "deleteBranchOnMerge",
                action: "update" as const,
                oldValue: false,
                newValue: true,
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    // Should only include the valid setting, not the undefined one
    assert.equal(report.repos[0].settings.length, 1);
    assert.equal(report.repos[0].settings[0].name, "deleteBranchOnMerge");
    // Totals should only count the valid setting
    assert.equal(report.totals.settings.update, 1);
  });
});
