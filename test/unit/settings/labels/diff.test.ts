import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { diffLabels } from "../../../../src/settings/labels/diff.js";
import type { Label } from "../../../../src/config/types.js";
import type { GitHubLabel } from "../../../../src/settings/labels/types.js";

describe("diffLabels", () => {
  describe("desired-state orphan detection", () => {
    test("deleteOrphaned: true deletes ALL current labels not in desired", () => {
      const current: GitHubLabel[] = [
        {
          id: 1,
          name: "bug",
          color: "d73a4a",
          description: "",
          default: false,
        },
        {
          id: 2,
          name: "unmanaged-label",
          color: "000000",
          description: null,
          default: false,
        },
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, true, false);
      const deletes = changes.filter((c) => c.action === "delete");
      assert.strictEqual(deletes.length, 1);
      assert.strictEqual(deletes[0].name, "unmanaged-label");
    });

    test("deleteOrphaned: false preserves unmanaged labels", () => {
      const current: GitHubLabel[] = [
        {
          id: 1,
          name: "bug",
          color: "d73a4a",
          description: "",
          default: false,
        },
        {
          id: 2,
          name: "unmanaged",
          color: "000000",
          description: null,
          default: false,
        },
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, false, false);
      const deletes = changes.filter((c) => c.action === "delete");
      assert.strictEqual(deletes.length, 0);
    });
  });

  describe("create labels", () => {
    test("creates labels not present on repo", () => {
      const current: GitHubLabel[] = [];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "Bug reports" },
      };

      const changes = diffLabels(current, desired, false, false);
      const creates = changes.filter((c) => c.action === "create");
      assert.strictEqual(creates.length, 1);
      assert.strictEqual(creates[0].name, "bug");
    });
  });

  describe("update labels", () => {
    test("detects color changes", () => {
      const current: GitHubLabel[] = [
        {
          id: 1,
          name: "bug",
          color: "d73a4a",
          description: "",
          default: false,
        },
      ];
      const desired: Record<string, Label> = {
        bug: { color: "ff0000" },
      };

      const changes = diffLabels(current, desired, false, false);
      const updates = changes.filter((c) => c.action === "update");
      assert.strictEqual(updates.length, 1);
      assert.strictEqual(updates[0].propertyChanges![0].property, "color");
    });

    test("detects description changes", () => {
      const current: GitHubLabel[] = [
        {
          id: 1,
          name: "bug",
          color: "d73a4a",
          description: "old",
          default: false,
        },
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "new" },
      };

      const changes = diffLabels(current, desired, false, false);
      const updates = changes.filter((c) => c.action === "update");
      assert.strictEqual(updates.length, 1);
    });
  });

  describe("unchanged labels", () => {
    test("marks matching labels as unchanged", () => {
      const current: GitHubLabel[] = [
        {
          id: 1,
          name: "bug",
          color: "d73a4a",
          description: "",
          default: false,
        },
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, false, false);
      const unchanged = changes.filter((c) => c.action === "unchanged");
      assert.strictEqual(unchanged.length, 1);
    });
  });

  describe("noDelete flag", () => {
    test("noDelete suppresses deletions even when deleteOrphaned is true", () => {
      const current: GitHubLabel[] = [
        {
          id: 1,
          name: "bug",
          color: "d73a4a",
          description: "",
          default: false,
        },
        {
          id: 2,
          name: "orphan",
          color: "000000",
          description: null,
          default: false,
        },
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, true, true);
      const deletes = changes.filter((c) => c.action === "delete");
      assert.strictEqual(deletes.length, 0);
    });
  });

  describe("rename collision detection", () => {
    test("throws on duplicate rename targets", () => {
      const current: GitHubLabel[] = [
        {
          id: 1,
          name: "a",
          color: "000000",
          description: null,
          default: false,
        },
        {
          id: 2,
          name: "b",
          color: "000000",
          description: null,
          default: false,
        },
      ];
      const desired: Record<string, Label> = {
        a: { color: "000000", new_name: "c" },
        b: { color: "000000", new_name: "c" },
      };

      assert.throws(
        () => diffLabels(current, desired, false, false),
        /Rename collision/
      );
    });

    test("throws when rename target collides with existing label", () => {
      const current: GitHubLabel[] = [
        {
          id: 1,
          name: "a",
          color: "000000",
          description: null,
          default: false,
        },
        {
          id: 2,
          name: "b",
          color: "111111",
          description: null,
          default: false,
        },
      ];
      const desired: Record<string, Label> = {
        a: { color: "000000", new_name: "b" },
        b: { color: "111111" },
      };

      assert.throws(
        () => diffLabels(current, desired, false, false),
        /Rename collision/
      );
    });
  });

  describe("sort order", () => {
    test("returns changes in order: delete, update, create, unchanged", () => {
      const current: GitHubLabel[] = [
        {
          id: 1,
          name: "delete-me",
          color: "000000",
          description: null,
          default: false,
        },
        {
          id: 2,
          name: "update-me",
          color: "000000",
          description: null,
          default: false,
        },
        {
          id: 3,
          name: "keep-me",
          color: "aaaaaa",
          description: null,
          default: false,
        },
      ];
      const desired: Record<string, Label> = {
        "update-me": { color: "ffffff" },
        "keep-me": { color: "aaaaaa" },
        "new-label": { color: "bbbbbb" },
      };

      const changes = diffLabels(current, desired, true, false);
      const actions = changes.map((c) => c.action);
      assert.deepStrictEqual(actions, [
        "delete",
        "update",
        "create",
        "unchanged",
      ]);
    });
  });
});
