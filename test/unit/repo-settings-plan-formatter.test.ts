import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatRepoSettingsPlan,
  formatWarnings,
} from "../../src/repo-settings-plan-formatter.js";
import type { RepoSettingsChange } from "../../src/repo-settings-diff.js";

describe("formatRepoSettingsPlan", () => {
  test("should format changed property", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "hasWiki",
        action: "change",
        oldValue: true,
        newValue: false,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.ok(result.lines.some((l) => l.includes("hasWiki")));
    assert.ok(
      result.lines.some((l) => l.includes("true") && l.includes("false"))
    );
    assert.equal(result.changes, 1);
    assert.equal(result.adds, 0);
  });

  test("should format added property", () => {
    const changes: RepoSettingsChange[] = [
      { property: "allowAutoMerge", action: "add", newValue: true },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.ok(result.lines.some((l) => l.includes("allowAutoMerge")));
    assert.equal(result.adds, 1);
    assert.equal(result.changes, 0);
  });

  test("should return empty result for no changes", () => {
    const result = formatRepoSettingsPlan([]);

    assert.equal(result.lines.length, 0);
    assert.equal(result.changes, 0);
    assert.equal(result.adds, 0);
    assert.equal(result.warnings.length, 0);
  });

  test("should generate warning for visibility change", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "visibility",
        action: "change",
        oldValue: "private",
        newValue: "public",
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.ok(result.warnings.some((w) => w.includes("visibility")));
    assert.ok(result.warnings.some((w) => w.includes("expose or hide")));
  });

  test("should generate warning for archiving", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "archived",
        action: "change",
        oldValue: false,
        newValue: true,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.ok(result.warnings.some((w) => w.includes("archiving")));
    assert.ok(result.warnings.some((w) => w.includes("read-only")));
  });

  test("should generate warning for disabling issues", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "hasIssues",
        action: "change",
        oldValue: true,
        newValue: false,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.ok(result.warnings.some((w) => w.includes("hasIssues")));
    assert.ok(result.warnings.some((w) => w.includes("hide existing content")));
  });

  test("should format multiple changes", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "hasWiki",
        action: "change",
        oldValue: true,
        newValue: false,
      },
      { property: "allowAutoMerge", action: "add", newValue: true },
      {
        property: "allowSquashMerge",
        action: "change",
        oldValue: false,
        newValue: true,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.equal(result.lines.length, 3);
    assert.equal(result.adds, 1);
    assert.equal(result.changes, 2);
  });
});

describe("formatWarnings", () => {
  test("should format warnings with emoji", () => {
    const warnings = ["test warning 1", "test warning 2"];
    const formatted = formatWarnings(warnings);

    assert.equal(formatted.length, 2);
    assert.ok(formatted[0].includes("Warning"));
    assert.ok(formatted[0].includes("test warning 1"));
    assert.ok(formatted[1].includes("test warning 2"));
  });

  test("should return empty array for no warnings", () => {
    const formatted = formatWarnings([]);
    assert.equal(formatted.length, 0);
  });
});
