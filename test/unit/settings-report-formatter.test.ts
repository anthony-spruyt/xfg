import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import type {
  SettingsReport,
  RepoChanges,
  SettingChange,
  RulesetChange,
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
