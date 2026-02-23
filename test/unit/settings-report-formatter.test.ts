import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatSettingsReportCLI,
  formatSettingsReportMarkdown,
  writeSettingsReportSummary,
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
        labels: { create: 0, update: 0, delete: 0 },
      },
    };
    assert.ok(report);
  });

  test("RepoChanges structure is correct", () => {
    const repoChanges: RepoChanges = {
      repoName: "org/repo",
      settings: [],
      rulesets: [],
      labels: [],
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
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
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
          labels: [],
        },
      ],
      totals: {
        settings: { add: 1, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
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
        labels: { create: 0, update: 0, delete: 0 },
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
          labels: [],
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
          labels: [],
        },
      ],
      totals: {
        settings: { add: 1, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
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
          labels: [],
          error: "Connection refused",
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
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

  test("renders ruleset create with full config tree", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [
            {
              name: "ci-bypass",
              action: "create",
              config: {
                name: "ci-bypass",
                target: "branch",
                enforcement: "active",
                conditions: {
                  ref_name: {
                    include: ["refs/heads/main"],
                    exclude: [],
                  },
                },
              },
            },
          ],
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 1, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(
      output.includes('ruleset "ci-bypass"'),
      "should include ruleset name in header"
    );
    assert.ok(output.includes("enforcement"), "should include properties");
    assert.ok(output.includes("active"), "should include property values");
    // Verify "name" is NOT in tree output (it's in the header, not duplicated in tree)
    const treeLines = lines.filter((l) => l.includes("+ name:"));
    assert.equal(
      treeLines.length,
      0,
      "should not include 'name' property in tree (it's in header)"
    );
  });

  test("renders ruleset update with property diffs", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [
            {
              name: "branch-protection",
              action: "update",
              propertyDiffs: [
                {
                  path: ["enforcement"],
                  action: "change",
                  oldValue: "active",
                  newValue: "evaluate",
                },
              ],
            },
          ],
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 1, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(
      output.includes('ruleset "branch-protection"'),
      "should include ruleset name"
    );
    assert.ok(
      output.includes("enforcement"),
      "should include changed property"
    );
    assert.ok(output.includes("active"), "should include old value");
    assert.ok(output.includes("evaluate"), "should include new value");
  });

  test("renders ruleset delete", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [
            {
              name: "old-ruleset",
              action: "delete",
            },
          ],
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 1 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(
      output.includes('ruleset "old-ruleset"'),
      "should include ruleset name"
    );
  });

  test("renders mixed settings and rulesets", () => {
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
          rulesets: [
            {
              name: "branch-protection",
              action: "update",
              propertyDiffs: [
                {
                  path: ["enforcement"],
                  action: "change",
                  oldValue: "active",
                  newValue: "evaluate",
                },
              ],
            },
          ],
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 1, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("deleteBranchOnMerge"), "should include setting");
    assert.ok(output.includes("branch-protection"), "should include ruleset");
  });

  test("skips settings where both oldValue and newValue are undefined", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "has_issues",
              action: "change",
              oldValue: undefined,
              newValue: undefined,
            },
            {
              name: "deleteBranchOnMerge",
              action: "change",
              oldValue: false,
              newValue: true,
            },
          ],
          rulesets: [],
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 2 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(
      !output.includes("has_issues"),
      "should NOT include setting with both values undefined"
    );
    assert.ok(
      output.includes("deleteBranchOnMerge"),
      "should include valid setting"
    );
  });

  test("renders rules array items as broken down properties", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [
            {
              name: "branch-protection",
              action: "create",
              config: {
                name: "branch-protection",
                target: "branch",
                enforcement: "active",
                rules: [
                  {
                    type: "pull_request",
                    parameters: {
                      requiredApprovingReviewCount: 1,
                    },
                  },
                ],
              },
            },
          ],
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 1, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    // Should NOT contain JSON blob format
    assert.ok(
      !output.includes('{"type":"pull_request"'),
      "should NOT show rules as JSON blob"
    );
    // Should contain broken down properties
    assert.ok(output.includes("type:"), "should show type property");
    assert.ok(
      output.includes("pull_request") || output.includes('"pull_request"'),
      "should show type value"
    );
    assert.ok(
      output.includes("parameters:") ||
        output.includes("requiredApprovingReviewCount"),
      "should show parameters"
    );
  });

  test("renders label create with color and description", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "bug",
              action: "create",
              config: {
                color: "d73a4a",
                description: "Something isn't working",
              },
            },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes('label "bug"'), "should include label name");
    assert.ok(output.includes('color: "d73a4a"'), "should include color");
    assert.ok(
      output.includes('description: "Something isn\'t working"'),
      "should include description"
    );
  });

  test("renders label create with color only (no description)", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "priority",
              action: "create",
              config: {
                color: "ff0000",
              },
            },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes('label "priority"'), "should include label name");
    assert.ok(output.includes('color: "ff0000"'), "should include color");
    assert.ok(
      !output.includes("description:"),
      "should NOT include description when not set"
    );
  });

  test("renders label update with newName (rename)", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "bug",
              action: "update",
              newName: "defect",
              propertyChanges: [
                { property: "new_name", newValue: "defect" },
                { property: "color", oldValue: "d73a4a", newValue: "ff0000" },
              ],
            },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 1, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(
      output.includes('label "bug"'),
      "should include original label name"
    );
    assert.ok(output.includes('"defect"'), "should include new label name");
    assert.ok(output.includes("\u2192"), "should include arrow for rename");
    assert.ok(
      output.includes('color: "d73a4a" \u2192 "ff0000"'),
      "should include color change"
    );
    assert.ok(
      !output.includes("new_name:"),
      "should skip new_name property in property changes"
    );
  });

  test("renders label update without newName, with propertyChanges", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "enhancement",
              action: "update",
              propertyChanges: [
                { property: "color", oldValue: "a2eeef", newValue: "0075ca" },
                { property: "description", newValue: "New feature request" },
              ],
            },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 1, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(
      output.includes('label "enhancement"'),
      "should include label name"
    );
    assert.ok(
      output.includes('color: "a2eeef" \u2192 "0075ca"'),
      "should include color change with old and new values"
    );
    assert.ok(
      output.includes('description: "New feature request"'),
      "should include description with new value only"
    );
  });

  test("renders label delete", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "wontfix",
              action: "delete",
            },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 1 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes('label "wontfix"'), "should include label name");
  });

  test("formatSummary renders singular label count", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            { name: "bug", action: "create", config: { color: "d73a4a" } },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(
      output.includes("1 label"),
      "should use singular 'label' for count of 1"
    );
    assert.ok(
      !output.includes("1 labels"),
      "should NOT use plural 'labels' for count of 1"
    );
  });

  test("formatSummary renders plural labels count", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            { name: "bug", action: "create", config: { color: "d73a4a" } },
            { name: "wontfix", action: "delete" },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 0, delete: 1 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(
      output.includes("2 labels"),
      "should use plural 'labels' for count of 2"
    );
  });
});

describe("formatSettingsReportMarkdown", () => {
  test("includes dry run warning when dryRun=true", () => {
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
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, true);

    assert.ok(
      markdown.includes("## xfg Plan"),
      "should include xfg Plan title for dry run"
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
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    assert.ok(markdown.includes("```diff"), "should have diff code block");
    assert.ok(markdown.includes("org/repo"), "should include repo name");
    assert.ok(
      markdown.includes("deleteBranchOnMerge"),
      "should include setting"
    );
  });

  test("includes plan summary as bold text", () => {
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
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    assert.ok(markdown.includes("**Plan:"), "should have bold plan summary");
  });

  test("no dry run warning when dryRun=false", () => {
    const report: SettingsReport = {
      repos: [],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    assert.ok(!markdown.includes("[!WARNING]"), "should not include warning");
    assert.ok(!markdown.includes("xfg Plan"), "should not have Plan title");
  });

  test("skips settings where both oldValue and newValue are undefined", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "has_issues",
              action: "change",
              oldValue: undefined,
              newValue: undefined,
            },
            {
              name: "deleteBranchOnMerge",
              action: "change",
              oldValue: false,
              newValue: true,
            },
          ],
          rulesets: [],
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 2 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    assert.ok(
      !markdown.includes("has_issues"),
      "should NOT include setting with both values undefined"
    );
    assert.ok(
      markdown.includes("deleteBranchOnMerge"),
      "should include valid setting"
    );
  });

  test("renders rules array items as broken down properties", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [
            {
              name: "branch-protection",
              action: "create",
              config: {
                name: "branch-protection",
                target: "branch",
                enforcement: "active",
                rules: [
                  {
                    type: "pull_request",
                    parameters: {
                      requiredApprovingReviewCount: 1,
                    },
                  },
                ],
              },
            },
          ],
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 1, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    // Should NOT contain JSON blob format
    assert.ok(
      !markdown.includes('{"type":"pull_request"'),
      "should NOT show rules as JSON blob"
    );
    // Should contain broken down properties
    assert.ok(markdown.includes("type:"), "should show type property");
    assert.ok(
      markdown.includes("pull_request") || markdown.includes('"pull_request"'),
      "should show type value"
    );
  });

  test("renders label create in markdown diff format", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "bug",
              action: "create",
              config: {
                color: "d73a4a",
                description: "Something isn't working",
              },
            },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 0, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    assert.ok(markdown.includes("```diff"), "should have diff code block");
    assert.ok(
      markdown.includes('+ label "bug"'),
      "should include label create line"
    );
    assert.ok(markdown.includes('+   color: "d73a4a"'), "should include color");
    assert.ok(
      markdown.includes('+   description: "Something isn\'t working"'),
      "should include description"
    );
  });

  test("renders label update with rename in markdown", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "bug",
              action: "update",
              newName: "defect",
              propertyChanges: [
                { property: "new_name", newValue: "defect" },
                { property: "color", oldValue: "d73a4a", newValue: "ff0000" },
              ],
            },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 1, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    assert.ok(
      markdown.includes('! label "bug" \u2192 "defect"'),
      "should include rename with arrow"
    );
    assert.ok(
      markdown.includes('!   color: "d73a4a" \u2192 "ff0000"'),
      "should include color change"
    );
    assert.ok(
      !markdown.includes("new_name:"),
      "should skip new_name property in property changes"
    );
  });

  test("renders label delete in markdown", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "wontfix",
              action: "delete",
            },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 1 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    assert.ok(
      markdown.includes('- label "wontfix"'),
      "should include label delete line"
    );
  });

  test("renders labels summary in markdown", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            { name: "bug", action: "create", config: { color: "d73a4a" } },
            { name: "old", action: "delete" },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 0, delete: 1 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    assert.ok(
      markdown.includes("**Plan: 2 labels"),
      "should include bold labels summary"
    );
    assert.ok(markdown.includes("1 to create"), "should include create count");
    assert.ok(markdown.includes("1 to delete"), "should include delete count");
  });
});

describe("writeSettingsReportSummary", () => {
  let tempFile: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempFile = join(tmpdir(), `settings-report-test-${Date.now()}.md`);
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
          labels: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    writeSettingsReportSummary(report, false);

    assert.ok(existsSync(tempFile));
    const content = readFileSync(tempFile, "utf-8");
    assert.ok(content.includes("xfg Apply"));
  });

  test("no-ops when env var not set", () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    const report: SettingsReport = {
      repos: [],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
      },
    };

    writeSettingsReportSummary(report, false);

    assert.ok(!existsSync(tempFile));
  });
});
