import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { diffLabels } from "../../../../src/settings/labels/diff.js";
import type { Label } from "../../../../src/config/types.js";
import type { GitHubLabel } from "../../../../src/settings/labels/types.js";

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

    test("errors when the rename target exists even if it would be deleted as an orphan", () => {
      const current = [
        makeGitHubLabel({ name: "old", color: "d73a4a" }),
        makeGitHubLabel({ id: 2, name: "new-name", color: "cccccc" }),
      ];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new-name" },
      };

      assert.throws(
        () => diffLabels(current, desired, true, false),
        /collision|collides|already exists/i
      );
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

  describe("rename re-run (idempotency)", () => {
    test("source missing and target exists is unchanged", () => {
      const current = [makeGitHubLabel({ name: "new", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new" },
      };

      const changes = diffLabels(current, desired, true, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
      assert.equal(changes[0].name, "new");
    });

    test("target is never deleted as an orphan when the source is gone", () => {
      const current = [
        makeGitHubLabel({ name: "new", color: "d73a4a" }),
        makeGitHubLabel({ id: 2, name: "stray", color: "000000" }),
      ];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new" },
      };

      const changes = diffLabels(current, desired, true, false);

      assert.deepEqual(
        changes.map((c) => [c.action, c.name]),
        [
          ["delete", "stray"],
          ["unchanged", "new"],
        ]
      );
    });

    test("target matches case-insensitively", () => {
      const current = [makeGitHubLabel({ name: "New", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new" },
      };

      const changes = diffLabels(current, desired, true, false);

      assert.deepEqual(
        changes.map((c) => c.action),
        ["unchanged"]
      );
    });

    test("target with a different color is updated without a rename", () => {
      const current = [makeGitHubLabel({ name: "new", color: "cccccc" })];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new" },
      };

      const changes = diffLabels(current, desired, true, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
      assert.equal(changes[0].name, "new");
      assert.equal(changes[0].newName, undefined);
      assert.deepEqual(changes[0].propertyChanges, [
        { property: "color", oldValue: "cccccc", newValue: "d73a4a" },
      ]);
    });

    test("target with a different description is updated", () => {
      const current = [
        makeGitHubLabel({ name: "new", color: "d73a4a", description: "a" }),
      ];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", description: "b", new_name: "new" },
      };

      const changes = diffLabels(current, desired, true, false);

      assert.equal(changes[0].action, "update");
      assert.deepEqual(changes[0].propertyChanges, [
        { property: "description", oldValue: "a", newValue: "b" },
      ]);
    });

    test("neither exists creates the label under new_name", () => {
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", description: "d", new_name: "new" },
      };

      const changes = diffLabels([], desired, true, false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "create");
      assert.equal(changes[0].name, "new");
      assert.deepEqual(changes[0].desired, {
        color: "d73a4a",
        description: "d",
      });
    });

    test("neither exists then re-run converges to unchanged", () => {
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new" },
      };

      const first = diffLabels([], desired, true, false);
      const created = makeGitHubLabel({ name: first[0].name, color: "d73a4a" });
      const second = diffLabels([created], desired, true, false);

      assert.deepEqual(
        second.map((c) => c.action),
        ["unchanged"]
      );
    });

    test("both exist still errors when the target is not removed", () => {
      const current = [
        makeGitHubLabel({ name: "old", color: "d73a4a" }),
        makeGitHubLabel({ id: 2, name: "new", color: "cccccc" }),
      ];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new" },
      };

      assert.throws(
        () => diffLabels(current, desired, false, false),
        /collision|collides/i
      );
    });

    test("old label recreated after a rename errors instead of deleting the target", () => {
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new" },
      };
      const run1 = [makeGitHubLabel({ name: "new", color: "d73a4a" })];
      assert.deepEqual(
        diffLabels(run1, desired, true, false).map((c) => c.action),
        ["unchanged"]
      );

      const run2 = [
        makeGitHubLabel({ name: "new", color: "d73a4a" }),
        makeGitHubLabel({ id: 2, name: "old", color: "d73a4a" }),
      ];
      assert.throws(
        () => diffLabels(run2, desired, true, false),
        /collision|collides|already exists/i
      );
    });

    test("target that is also a desired key is not duplicated", () => {
      const current = [makeGitHubLabel({ name: "new", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new" },
        new: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, true, false);

      assert.deepEqual(
        changes.map((c) => [c.action, c.name]),
        [["unchanged", "new"]]
      );
    });
  });

  describe("chain rename", () => {
    test("rejects a rename whose target is also renamed", () => {
      const current = [
        makeGitHubLabel({ name: "a", color: "aaaaaa" }),
        makeGitHubLabel({ id: 2, name: "b", color: "bbbbbb" }),
      ];
      const desired: Record<string, Label> = {
        a: { color: "aaaaaa", new_name: "b" },
        b: { color: "bbbbbb", new_name: "c" },
      };

      assert.throws(
        () => diffLabels(current, desired, false, false),
        /chain/i
      );
    });

    test("rejects a rename onto a kept new_name entry on both runs", () => {
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new" },
        x: { color: "d73a4a", new_name: "old" },
      };
      const run1 = [
        makeGitHubLabel({ name: "new", color: "d73a4a" }),
        makeGitHubLabel({ id: 2, name: "x", color: "d73a4a" }),
      ];
      const run2 = [
        makeGitHubLabel({ name: "new", color: "d73a4a" }),
        makeGitHubLabel({ id: 2, name: "old", color: "d73a4a" }),
      ];

      assert.throws(() => diffLabels(run1, desired, true, false), /chain/i);
      assert.throws(() => diffLabels(run2, desired, true, false), /chain/i);
    });
  });

  describe("rename name handling", () => {
    test("skips new_name when the current name already equals it", () => {
      const current = [makeGitHubLabel({ name: "Bug", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", new_name: "Bug" },
      };

      const changes = diffLabels(current, desired, true, false);

      assert.deepEqual(
        changes.map((c) => c.action),
        ["unchanged"]
      );
    });

    test("self rename is unchanged", () => {
      const current = [makeGitHubLabel({ name: "bug", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", new_name: "bug" },
      };

      const changes = diffLabels(current, desired, true, false);

      assert.deepEqual(
        changes.map((c) => c.action),
        ["unchanged"]
      );
    });

    test("case-only rename still updates when the casing differs", () => {
      const current = [makeGitHubLabel({ name: "bug", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", new_name: "Bug" },
      };

      const changes = diffLabels(current, desired, true, false);

      assert.equal(changes[0].action, "update");
      assert.equal(changes[0].newName, "Bug");
    });

    test("update targets the current label name, not the config casing", () => {
      const current = [makeGitHubLabel({ name: "bug", color: "cccccc" })];
      const desired: Record<string, Label> = {
        BUG: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, false, false);

      assert.equal(changes[0].action, "update");
      assert.equal(changes[0].name, "bug");
    });
  });
});
