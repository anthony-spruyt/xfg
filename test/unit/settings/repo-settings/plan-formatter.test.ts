import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatRepoSettingsPlan,
  formatWarnings,
} from "../../../../src/settings/repo-settings/formatter.js";
import type { RepoSettingsChange } from "../../../../src/settings/repo-settings/diff.js";

describe("formatRepoSettingsPlan", () => {
  test("should format changed property", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "hasWiki",
        action: "update",
        oldValue: true,
        newValue: false,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.ok(result.lines.some((l) => l.includes("hasWiki")));
    assert.ok(
      result.lines.some((l) => l.includes("true") && l.includes("false"))
    );
    assert.equal(result.updates, 1);
    assert.equal(result.creates, 0);
  });

  test("should format added property", () => {
    const changes: RepoSettingsChange[] = [
      { property: "allowAutoMerge", action: "create", newValue: true },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.ok(result.lines.some((l) => l.includes("allowAutoMerge")));
    assert.equal(result.creates, 1);
    assert.equal(result.updates, 0);
  });

  test("should return empty result for no changes", () => {
    const result = formatRepoSettingsPlan([]);

    assert.equal(result.lines.length, 0);
    assert.equal(result.updates, 0);
    assert.equal(result.creates, 0);
    assert.equal(result.warnings.length, 0);
  });

  test("should generate warning for visibility change", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "visibility",
        action: "update",
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
        action: "update",
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
        action: "update",
        oldValue: true,
        newValue: false,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.ok(result.warnings.some((w) => w.includes("hasIssues")));
    assert.ok(result.warnings.some((w) => w.includes("hide existing content")));
  });

  test("should generate warning for defaultBranch change", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "defaultBranch",
        action: "update",
        oldValue: "main",
        newValue: "develop",
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.ok(result.warnings.some((w) => w.includes("default branch")));
  });

  test("should format multiple changes", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "hasWiki",
        action: "update",
        oldValue: true,
        newValue: false,
      },
      { property: "allowAutoMerge", action: "create", newValue: true },
      {
        property: "allowSquashMerge",
        action: "update",
        oldValue: false,
        newValue: true,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.equal(result.lines.length, 3);
    assert.equal(result.creates, 1);
    assert.equal(result.updates, 2);
  });

  describe("entries population", () => {
    test("populates entry for add action", () => {
      const changes: RepoSettingsChange[] = [
        { property: "allowAutoMerge", action: "create", newValue: true },
      ];

      const result = formatRepoSettingsPlan(changes);

      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].property, "allowAutoMerge");
      assert.equal(result.entries[0].action, "create");
    });

    test("populates entry for change action", () => {
      const changes: RepoSettingsChange[] = [
        {
          property: "hasWiki",
          action: "update",
          oldValue: true,
          newValue: false,
        },
      ];

      const result = formatRepoSettingsPlan(changes);

      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].property, "hasWiki");
      assert.equal(result.entries[0].action, "update");
    });

    test("populates entries for mixed actions", () => {
      const changes: RepoSettingsChange[] = [
        {
          property: "hasWiki",
          action: "update",
          oldValue: true,
          newValue: false,
        },
        { property: "allowAutoMerge", action: "create", newValue: true },
        {
          property: "allowSquashMerge",
          action: "update",
          oldValue: false,
          newValue: true,
        },
      ];

      const result = formatRepoSettingsPlan(changes);

      assert.equal(result.entries.length, 3);
      assert.equal(result.entries[0].property, "hasWiki");
      assert.equal(result.entries[0].action, "update");
      assert.equal(result.entries[1].property, "allowAutoMerge");
      assert.equal(result.entries[1].action, "create");
      assert.equal(result.entries[2].property, "allowSquashMerge");
      assert.equal(result.entries[2].action, "update");
    });

    test("returns empty entries for empty changes", () => {
      const result = formatRepoSettingsPlan([]);

      assert.equal(result.entries.length, 0);
    });
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
