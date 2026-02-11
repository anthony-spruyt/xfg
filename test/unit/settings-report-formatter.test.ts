import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatSettingsReportCLI,
  type SettingsReport,
  type RepoChanges,
  type SettingChange,
  type RulesetChange,
} from "../../src/output/settings-report.js";

describe("settings-report types", () => {
  test("SettingsReport structure is correct", () => {
    const report: SettingsReport = {
      repos: [],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };
    assert.ok(report);
  });

  test("RepoChanges structure is correct", () => {
    const repoChanges: RepoChanges = {
      repoName: "org/repo",
      settings: [],
      rulesets: [],
    };
    assert.ok(repoChanges);
  });

  test("SettingChange structure is correct", () => {
    const change: SettingChange = {
      name: "deleteBranchOnMerge",
      action: "change",
      oldValue: false,
      newValue: true,
    };
    assert.ok(change);
  });

  test("RulesetChange structure is correct", () => {
    const change: RulesetChange = {
      name: "branch-protection",
      action: "update",
      propertyDiffs: [],
    };
    assert.ok(change);
  });
});

describe("formatSettingsReportCLI", () => {
  test("renders repo with settings changes only", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "deleteBranchOnMerge",
              action: "change",
              oldValue: false,
              newValue: true,
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("org/repo"), "should include repo name");
    assert.ok(
      output.includes("deleteBranchOnMerge"),
      "should include setting name"
    );
    assert.ok(output.includes("false"), "should include old value");
    assert.ok(output.includes("true"), "should include new value");
    assert.ok(output.includes("1 setting"), "should include summary");
  });

  test("renders setting add action", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "hasWiki",
              action: "add",
              newValue: true,
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 1, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("hasWiki"), "should include setting name");
    assert.ok(output.includes("true"), "should include new value");
  });

  test("renders empty report as no changes", () => {
    const report: SettingsReport = {
      repos: [],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("No changes"), "should show no changes message");
  });

  test("renders multiple repos with blank lines between", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo1",
          settings: [{ name: "hasWiki", action: "add", newValue: true }],
          rulesets: [],
        },
        {
          repoName: "org/repo2",
          settings: [
            {
              name: "deleteBranchOnMerge",
              action: "change",
              oldValue: false,
              newValue: true,
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 1, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("org/repo1"), "should include first repo");
    assert.ok(output.includes("org/repo2"), "should include second repo");
    // Verify blank line between repos (repo1 content, blank, repo2 header)
    const repo1Index = lines.findIndex((l) => l.includes("org/repo1"));
    const repo2Index = lines.findIndex((l) => l.includes("org/repo2"));
    assert.ok(
      repo2Index > repo1Index + 2,
      "should have separation between repos"
    );
  });

  test("renders repo with error", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/failed-repo",
          settings: [],
          rulesets: [],
          error: "Connection refused",
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("org/failed-repo"), "should include repo name");
    assert.ok(output.includes("Error:"), "should show error label");
    assert.ok(
      output.includes("Connection refused"),
      "should show error message"
    );
  });
});
