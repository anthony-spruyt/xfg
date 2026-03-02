import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { diffLabels } from "../../src/settings/labels/diff.js";
import type { Label } from "../../src/config/types.js";
import type { GitHubLabel } from "../../src/settings/labels/types.js";

function makeGitHubLabel(
  overrides: Partial<GitHubLabel> & { name: string; color: string }
): GitHubLabel {
  return { id: 1, description: null, default: false, ...overrides };
}

describe("diffLabels", () => {
  describe("create", () => {
    test("identifies labels in desired but not in current as create", () => {
      const current: GitHubLabel[] = [];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "Something isn't working" },
      };

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "create");
      assert.equal(changes[0].name, "bug");
    });
  });

  describe("update", () => {
    test("identifies labels with different color as update", () => {
      const current = [makeGitHubLabel({ name: "bug", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        bug: { color: "ff0000" },
      };

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
      assert.equal(changes[0].name, "bug");
    });

    test("identifies labels with different description as update", () => {
      const current = [
        makeGitHubLabel({
          name: "bug",
          color: "d73a4a",
          description: "Old desc",
        }),
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "New desc" },
      };

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
    });

    test("rename via new_name produces update", () => {
      const current = [makeGitHubLabel({ name: "old-name", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        "old-name": { color: "d73a4a", new_name: "new-name" },
      };

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
      assert.equal(changes[0].newName, "new-name");
    });
  });

  describe("delete", () => {
    test("deletes current labels not in desired when deleteOrphaned is true", () => {
      const current = [makeGitHubLabel({ name: "stale", color: "cccccc" })];
      const desired: Record<string, Label> = {};

      const changes = diffLabels(current, desired, true, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "delete");
      assert.equal(changes[0].name, "stale");
    });

    test("does not delete when noDelete is true", () => {
      const current = [makeGitHubLabel({ name: "stale", color: "cccccc" })];
      const desired: Record<string, Label> = {};

      const changes = diffLabels(current, desired, true, true);

      assert.equal(changes.length, 0);
    });

    test("does not delete labels when deleteOrphaned is false", () => {
      const current = [makeGitHubLabel({ name: "unmanaged", color: "cccccc" })];
      const desired: Record<string, Label> = {};

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes.length, 0);
    });
  });

  describe("unchanged", () => {
    test("identifies matching labels as unchanged", () => {
      const current = [
        makeGitHubLabel({
          name: "bug",
          color: "d73a4a",
          description: "Something isn't working",
        }),
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "Something isn't working" },
      };

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
    });
  });

  describe("case insensitive matching", () => {
    test("matches label names case-insensitively", () => {
      const current = [makeGitHubLabel({ name: "Bug", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
    });

    test("color comparison is case-insensitive", () => {
      const current = [makeGitHubLabel({ name: "bug", color: "D73A4A" })];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
    });
  });

  describe("description null/undefined equivalence", () => {
    test("null description matches undefined (no update)", () => {
      const current = [
        makeGitHubLabel({ name: "bug", color: "d73a4a", description: null }),
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
    });

    test("null and empty string description are treated as equivalent (no update)", () => {
      const current = [
        makeGitHubLabel({
          name: "bug",
          color: "d73a4a",
          description: null,
        }),
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "" },
      };

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
    });

    test("explicit empty string description triggers update from non-empty", () => {
      const current = [
        makeGitHubLabel({
          name: "bug",
          color: "d73a4a",
          description: "has desc",
        }),
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "" },
      };

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
    });
  });

  describe("rename collision detection", () => {
    test("errors when new_name collides with existing label not being removed", () => {
      const current = [
        makeGitHubLabel({ name: "old", color: "d73a4a" }),
        makeGitHubLabel({ id: 2, name: "new-name", color: "cccccc" }),
      ];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new-name" },
        "new-name": { color: "cccccc" },
      };

      assert.throws(
        () => diffLabels(current, desired, false, false),
        /collision|collides/i
      );
    });

    test("allows rename when target name is being deleted", () => {
      const current = [
        makeGitHubLabel({ name: "old", color: "d73a4a" }),
        makeGitHubLabel({ id: 2, name: "new-name", color: "cccccc" }),
      ];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new-name" },
      };

      // "new-name" is not in desired and deleteOrphaned is true -> will be deleted
      const changes = diffLabels(current, desired, true, false);

      // Should not throw
      const deleteChange = changes.find((c) => c.action === "delete");
      const updateChange = changes.find((c) => c.action === "update");
      assert.ok(deleteChange);
      assert.ok(updateChange);
    });

    test("errors on duplicate rename targets", () => {
      const current = [
        makeGitHubLabel({ name: "a", color: "aaaaaa" }),
        makeGitHubLabel({ id: 2, name: "b", color: "bbbbbb" }),
      ];
      const desired: Record<string, Label> = {
        a: { color: "aaaaaa", new_name: "target" },
        b: { color: "bbbbbb", new_name: "target" },
      };

      assert.throws(
        () => diffLabels(current, desired, false, false),
        /collision|duplicate/i
      );
    });
  });

  describe("ordering", () => {
    test("orders changes: deletes first, then updates, then creates", () => {
      const current = [
        makeGitHubLabel({ name: "delete-me", color: "cccccc" }),
        makeGitHubLabel({ id: 2, name: "update-me", color: "aaaaaa" }),
      ];
      const desired: Record<string, Label> = {
        "update-me": { color: "ffffff" },
        "create-me": { color: "000000" },
      };

      const changes = diffLabels(current, desired, true, false);

      const actions = changes.map((c) => c.action);
      assert.deepEqual(actions, ["delete", "update", "create"]);
    });

    test("unchanged entries sort after create", () => {
      const current = [makeGitHubLabel({ name: "unchanged", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        unchanged: { color: "d73a4a" },
        "new-one": { color: "000000" },
      };

      const changes = diffLabels(current, desired, false, false);

      const actions = changes.map((c) => c.action);
      assert.deepEqual(actions, ["create", "unchanged"]);
    });
  });

  describe("chain rename", () => {
    test("allows chain rename where target label is itself being renamed away", () => {
      const current = [
        makeGitHubLabel({ name: "a", color: "aaaaaa" }),
        makeGitHubLabel({ id: 2, name: "b", color: "bbbbbb" }),
      ];
      const desired: Record<string, Label> = {
        a: { color: "aaaaaa", new_name: "b" },
        b: { color: "bbbbbb", new_name: "c" },
      };

      // Should not throw — "b" is being renamed to "c", so "a" can take "b"
      const changes = diffLabels(current, desired, false, false);

      const updates = changes.filter((c) => c.action === "update");
      assert.equal(updates.length, 2);
    });
  });
});
