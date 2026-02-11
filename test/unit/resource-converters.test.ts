import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { syncResultToResources } from "../../src/settings/resource-converters.js";

describe("resource-converters", () => {
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
});
