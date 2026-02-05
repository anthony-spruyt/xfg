// test/unit/ruleset-plan-formatter.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  computePropertyDiffs,
  PropertyDiff,
} from "../../src/ruleset-plan-formatter.js";

describe("computePropertyDiffs", () => {
  describe("scalar changes", () => {
    test("detects changed scalar value", () => {
      const current = { enforcement: "disabled" };
      const desired = { enforcement: "active" };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0], {
        path: ["enforcement"],
        action: "change",
        oldValue: "disabled",
        newValue: "active",
      });
    });

    test("detects added scalar property", () => {
      const current = {};
      const desired = { enforcement: "active" };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0], {
        path: ["enforcement"],
        action: "add",
        newValue: "active",
      });
    });

    test("detects removed scalar property", () => {
      const current = { enforcement: "active" };
      const desired = {};

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0], {
        path: ["enforcement"],
        action: "remove",
        oldValue: "active",
      });
    });
  });
});
