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
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 1, update: 0, delete: 0 },
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
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 1, delete: 0 },
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
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 1 },
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
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 1, delete: 0 },
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
        },
      ],
      totals: {
        settings: { add: 0, change: 2 },
        rulesets: { create: 0, update: 0, delete: 0 },
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
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 1, update: 0, delete: 0 },
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
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
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
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
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
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
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
        },
      ],
      totals: {
        settings: { add: 0, change: 2 },
        rulesets: { create: 0, update: 0, delete: 0 },
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
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 1, update: 0, delete: 0 },
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
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
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
      },
    };

    writeSettingsReportSummary(report, false);

    assert.ok(!existsSync(tempFile));
  });
});
