import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { buildSettingsReport } from "../../../src/cli/settings-report-builder.js";

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

  test("converts codeScanningResult with create entries into settings", () => {
    const results = [
      {
        repoName: "org/repo",
        codeScanningResult: {
          planOutput: {
            entries: [
              {
                property: "defaultSetup.state",
                action: "create" as const,
                newValue: "configured",
              },
              {
                property: "defaultSetup.languages",
                action: "create" as const,
                newValue: ["javascript", "typescript"],
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.repos[0].settings.length, 2);
    assert.equal(
      report.repos[0].settings[0].name,
      "codeScanning.defaultSetup.state"
    );
    assert.equal(report.repos[0].settings[0].action, "create");
    assert.equal(report.repos[0].settings[0].newValue, "configured");
    assert.equal(
      report.repos[0].settings[1].name,
      "codeScanning.defaultSetup.languages"
    );
    assert.deepEqual(report.repos[0].settings[1].newValue, [
      "javascript",
      "typescript",
    ]);
    assert.equal(report.totals.settings.create, 2);
    assert.equal(report.totals.settings.update, 0);
  });

  test("converts codeScanningResult with update entries into settings", () => {
    const results = [
      {
        repoName: "org/repo",
        codeScanningResult: {
          planOutput: {
            entries: [
              {
                property: "defaultSetup.state",
                action: "update" as const,
                oldValue: "not-configured",
                newValue: "configured",
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.repos[0].settings.length, 1);
    assert.equal(
      report.repos[0].settings[0].name,
      "codeScanning.defaultSetup.state"
    );
    assert.equal(report.repos[0].settings[0].action, "update");
    assert.equal(report.repos[0].settings[0].oldValue, "not-configured");
    assert.equal(report.repos[0].settings[0].newValue, "configured");
    assert.equal(report.totals.settings.create, 0);
    assert.equal(report.totals.settings.update, 1);
  });

  test("handles codeScanningResult with no planOutput gracefully", () => {
    const results = [
      {
        repoName: "org/repo",
        codeScanningResult: {},
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.repos[0].settings.length, 0);
    assert.equal(report.totals.settings.create, 0);
    assert.equal(report.totals.settings.update, 0);
  });

  test("accumulates code scanning totals with regular settings totals", () => {
    const results = [
      {
        repoName: "org/repo1",
        settingsResult: {
          planOutput: {
            entries: [
              {
                property: "deleteBranchOnMerge",
                action: "create" as const,
                newValue: true,
              },
            ],
          },
        },
        codeScanningResult: {
          planOutput: {
            entries: [
              {
                property: "defaultSetup.state",
                action: "create" as const,
                newValue: "configured",
              },
              {
                property: "defaultSetup.languages",
                action: "update" as const,
                oldValue: ["javascript"],
                newValue: ["javascript", "typescript"],
              },
            ],
          },
        },
      },
      {
        repoName: "org/repo2",
        codeScanningResult: {
          planOutput: {
            entries: [
              {
                property: "defaultSetup.state",
                action: "update" as const,
                oldValue: "not-configured",
                newValue: "configured",
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    // repo1: 1 settings create + 1 code scanning create = 2 creates, 1 code scanning update
    // repo2: 1 code scanning update
    assert.equal(report.totals.settings.create, 2);
    assert.equal(report.totals.settings.update, 2);

    // repo1 should have 3 settings entries (1 regular + 2 code scanning)
    assert.equal(report.repos[0].settings.length, 3);
    // repo2 should have 1 settings entry (code scanning)
    assert.equal(report.repos[1].settings.length, 1);
  });

  test("handles codeScanningResult entry with undefined newValue as null", () => {
    const results = [
      {
        repoName: "org/repo",
        codeScanningResult: {
          planOutput: {
            entries: [
              {
                property: "defaultSetup.state",
                action: "create" as const,
                newValue: undefined,
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.repos[0].settings.length, 1);
    assert.equal(report.repos[0].settings[0].newValue, null);
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
