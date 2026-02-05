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

  describe("nested objects", () => {
    test("detects changes in nested properties", () => {
      const current = {
        rules: {
          pull_request: {
            required_approving_review_count: 1,
          },
        },
      };
      const desired = {
        rules: {
          pull_request: {
            required_approving_review_count: 2,
          },
        },
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0].path, [
        "rules",
        "pull_request",
        "required_approving_review_count",
      ]);
      assert.equal(diffs[0].action, "change");
      assert.equal(diffs[0].oldValue, 1);
      assert.equal(diffs[0].newValue, 2);
    });

    test("detects added nested property", () => {
      const current = {
        rules: {
          pull_request: {
            required_approving_review_count: 1,
          },
        },
      };
      const desired = {
        rules: {
          pull_request: {
            required_approving_review_count: 1,
            dismiss_stale_reviews_on_push: true,
          },
        },
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0].path, [
        "rules",
        "pull_request",
        "dismiss_stale_reviews_on_push",
      ]);
      assert.equal(diffs[0].action, "add");
    });
  });

  describe("arrays", () => {
    test("detects changed array", () => {
      const current = {
        conditions: {
          ref_name: {
            include: ["~DEFAULT_BRANCH"],
          },
        },
      };
      const desired = {
        conditions: {
          ref_name: {
            include: ["~DEFAULT_BRANCH", "release/*"],
          },
        },
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0].path, ["conditions", "ref_name", "include"]);
      assert.equal(diffs[0].action, "change");
    });

    test("treats identical arrays as unchanged", () => {
      const current = {
        conditions: { ref_name: { include: ["main", "develop"] } },
      };
      const desired = {
        conditions: { ref_name: { include: ["main", "develop"] } },
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 0);
    });
  });
});
