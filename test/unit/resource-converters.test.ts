import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  rulesetResultToResources,
  syncResultToResources,
  repoSettingsResultToResources,
} from "../../src/settings/resource-converters.js";

describe("resource-converters", () => {
  describe("rulesetResultToResources", () => {
    test("converts create entries to resources", () => {
      const result = {
        planOutput: {
          entries: [{ name: "branch-protection", action: "create" }],
        },
      };

      const resources = rulesetResultToResources("org/repo", result);

      assert.equal(resources.length, 1);
      assert.equal(resources[0].type, "ruleset");
      assert.equal(resources[0].repo, "org/repo");
      assert.equal(resources[0].name, "branch-protection");
      assert.equal(resources[0].action, "create");
    });

    test("converts update entries to resources", () => {
      const result = {
        planOutput: {
          entries: [{ name: "pr-rules", action: "update" }],
        },
      };

      const resources = rulesetResultToResources("org/repo", result);

      assert.equal(resources.length, 1);
      assert.equal(resources[0].action, "update");
    });

    test("converts delete entries to resources", () => {
      const result = {
        planOutput: {
          entries: [{ name: "old-rule", action: "delete" }],
        },
      };

      const resources = rulesetResultToResources("org/repo", result);

      assert.equal(resources.length, 1);
      assert.equal(resources[0].action, "delete");
    });

    test("converts unknown actions to unchanged", () => {
      const result = {
        planOutput: {
          entries: [{ name: "existing-rule", action: "noop" }],
        },
      };

      const resources = rulesetResultToResources("org/repo", result);

      assert.equal(resources.length, 1);
      assert.equal(resources[0].action, "unchanged");
    });

    test("handles multiple entries", () => {
      const result = {
        planOutput: {
          entries: [
            { name: "rule1", action: "create" },
            { name: "rule2", action: "update" },
            { name: "rule3", action: "delete" },
          ],
        },
      };

      const resources = rulesetResultToResources("org/repo", result);

      assert.equal(resources.length, 3);
      assert.equal(resources[0].action, "create");
      assert.equal(resources[1].action, "update");
      assert.equal(resources[2].action, "delete");
    });

    test("returns empty array when no planOutput", () => {
      const result = {};

      const resources = rulesetResultToResources("org/repo", result);

      assert.equal(resources.length, 0);
    });

    test("returns empty array when no entries", () => {
      const result = { planOutput: {} };

      const resources = rulesetResultToResources("org/repo", result);

      assert.equal(resources.length, 0);
    });

    test("includes plan lines in first resource details", () => {
      const result = {
        planOutput: {
          entries: [
            { name: "rule1", action: "create" },
            { name: "rule2", action: "update" },
          ],
          lines: ["+ ruleset.rule1", "  name: test", "~ ruleset.rule2"],
        },
      };

      const resources = rulesetResultToResources("org/repo", result);

      assert.equal(resources.length, 2);
      assert.ok(resources[0].details?.diff);
      assert.deepEqual(resources[0].details?.diff, [
        "+ ruleset.rule1",
        "  name: test",
        "~ ruleset.rule2",
      ]);
      assert.equal(resources[1].details, undefined);
    });

    test("no details when no plan lines", () => {
      const result = {
        planOutput: {
          entries: [{ name: "rule1", action: "create" }],
          lines: [],
        },
      };

      const resources = rulesetResultToResources("org/repo", result);

      assert.equal(resources[0].details, undefined);
    });
  });

  describe("syncResultToResources", () => {
    const repoConfig = {
      files: [{ fileName: "ci.yml" }, { fileName: "lint.yml" }],
    };

    test("marks all files as unchanged when skipped", () => {
      const result = { skipped: true };

      const resources = syncResultToResources("org/repo", repoConfig, result);

      assert.equal(resources.length, 2);
      assert.ok(resources.every((r) => r.action === "unchanged"));
      assert.ok(resources.every((r) => r.type === "file"));
    });

    test("returns empty array when no diffStats", () => {
      const result = { skipped: false };

      const resources = syncResultToResources("org/repo", repoConfig, result);

      assert.equal(resources.length, 0);
    });

    test("marks files as create when newCount > 0", () => {
      const result = {
        skipped: false,
        diffStats: { newCount: 2, modifiedCount: 0, unchangedCount: 0 },
      };

      const resources = syncResultToResources("org/repo", repoConfig, result);

      assert.equal(resources.length, 2);
      assert.ok(resources.every((r) => r.action === "create"));
    });

    test("marks files as update when modifiedCount > 0", () => {
      const result = {
        skipped: false,
        diffStats: { newCount: 0, modifiedCount: 1, unchangedCount: 0 },
      };

      const resources = syncResultToResources("org/repo", repoConfig, result);

      assert.equal(resources.length, 2);
      assert.ok(resources.every((r) => r.action === "update"));
    });

    test("marks files as delete when deletedCount > 0", () => {
      const result = {
        skipped: false,
        diffStats: {
          newCount: 0,
          modifiedCount: 0,
          unchangedCount: 0,
          deletedCount: 1,
        },
      };

      const resources = syncResultToResources("org/repo", repoConfig, result);

      assert.equal(resources.length, 2);
      assert.ok(resources.every((r) => r.action === "delete"));
    });

    test("marks files as unchanged when all counts are 0", () => {
      const result = {
        skipped: false,
        diffStats: { newCount: 0, modifiedCount: 0, unchangedCount: 2 },
      };

      const resources = syncResultToResources("org/repo", repoConfig, result);

      assert.equal(resources.length, 2);
      assert.ok(resources.every((r) => r.action === "unchanged"));
    });

    test("prioritizes create over update", () => {
      const result = {
        skipped: false,
        diffStats: { newCount: 1, modifiedCount: 1, unchangedCount: 0 },
      };

      const resources = syncResultToResources("org/repo", repoConfig, result);

      assert.ok(resources.every((r) => r.action === "create"));
    });

    test("prioritizes update over delete", () => {
      const result = {
        skipped: false,
        diffStats: {
          newCount: 0,
          modifiedCount: 1,
          unchangedCount: 0,
          deletedCount: 1,
        },
      };

      const resources = syncResultToResources("org/repo", repoConfig, result);

      assert.ok(resources.every((r) => r.action === "update"));
    });
  });

  describe("repoSettingsResultToResources", () => {
    test("converts add entries to create resources", () => {
      const result = {
        planOutput: {
          entries: [{ property: "description", action: "add" }],
        },
      };

      const resources = repoSettingsResultToResources("org/repo", result);

      assert.equal(resources.length, 1);
      assert.equal(resources[0].type, "setting");
      assert.equal(resources[0].repo, "org/repo");
      assert.equal(resources[0].name, "description");
      assert.equal(resources[0].action, "create");
    });

    test("converts change entries to update resources", () => {
      const result = {
        planOutput: {
          entries: [{ property: "visibility", action: "change" }],
        },
      };

      const resources = repoSettingsResultToResources("org/repo", result);

      assert.equal(resources.length, 1);
      assert.equal(resources[0].action, "update");
    });

    test("converts any non-add action to update", () => {
      const result = {
        planOutput: {
          entries: [
            { property: "prop1", action: "modify" },
            { property: "prop2", action: "update" },
          ],
        },
      };

      const resources = repoSettingsResultToResources("org/repo", result);

      assert.ok(resources.every((r) => r.action === "update"));
    });

    test("handles multiple entries", () => {
      const result = {
        planOutput: {
          entries: [
            { property: "description", action: "add" },
            { property: "homepage", action: "change" },
            { property: "topics", action: "add" },
          ],
        },
      };

      const resources = repoSettingsResultToResources("org/repo", result);

      assert.equal(resources.length, 3);
      assert.equal(resources[0].action, "create");
      assert.equal(resources[1].action, "update");
      assert.equal(resources[2].action, "create");
    });

    test("returns empty array when no planOutput", () => {
      const result = {};

      const resources = repoSettingsResultToResources("org/repo", result);

      assert.equal(resources.length, 0);
    });

    test("returns empty array when no entries", () => {
      const result = { planOutput: {} };

      const resources = repoSettingsResultToResources("org/repo", result);

      assert.equal(resources.length, 0);
    });

    test("includes plan lines in first resource details", () => {
      const result = {
        planOutput: {
          entries: [
            { property: "description", action: "add" },
            { property: "topics", action: "change" },
          ],
          lines: ["+ description: New description", "~ topics: [new, topics]"],
        },
      };

      const resources = repoSettingsResultToResources("org/repo", result);

      assert.equal(resources.length, 2);
      assert.ok(resources[0].details?.diff);
      assert.deepEqual(resources[0].details?.diff, [
        "+ description: New description",
        "~ topics: [new, topics]",
      ]);
      assert.equal(resources[1].details, undefined);
    });
  });
});
