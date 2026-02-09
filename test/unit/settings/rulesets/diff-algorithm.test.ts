// test/unit/settings/rulesets/diff-algorithm.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  computePropertyDiffs,
  deepEqual,
  isObject,
  isArrayOfObjects,
} from "../../../../src/settings/rulesets/index.js";

describe("diff-algorithm", () => {
  describe("isObject", () => {
    test("returns true for plain objects", () => {
      assert.equal(isObject({}), true);
      assert.equal(isObject({ a: 1 }), true);
    });

    test("returns false for arrays", () => {
      assert.equal(isObject([]), false);
      assert.equal(isObject([1, 2]), false);
    });

    test("returns false for null", () => {
      assert.equal(isObject(null), false);
    });

    test("returns false for primitives", () => {
      assert.equal(isObject("string"), false);
      assert.equal(isObject(42), false);
      assert.equal(isObject(true), false);
      assert.equal(isObject(undefined), false);
    });
  });

  describe("deepEqual", () => {
    test("returns true for identical primitives", () => {
      assert.equal(deepEqual(1, 1), true);
      assert.equal(deepEqual("a", "a"), true);
      assert.equal(deepEqual(true, true), true);
    });

    test("returns false for different primitives", () => {
      assert.equal(deepEqual(1, 2), false);
      assert.equal(deepEqual("a", "b"), false);
    });

    test("returns true for identical arrays", () => {
      assert.equal(deepEqual([1, 2, 3], [1, 2, 3]), true);
    });

    test("returns false for different arrays", () => {
      assert.equal(deepEqual([1, 2], [1, 2, 3]), false);
      assert.equal(deepEqual([1, 2], [1, 3]), false);
    });

    test("returns true for identical objects", () => {
      assert.equal(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
    });

    test("returns false for different objects", () => {
      assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
      assert.equal(deepEqual({ a: 1 }, { b: 1 }), false);
    });

    test("handles nested structures", () => {
      const a = { x: { y: [1, 2, { z: 3 }] } };
      const b = { x: { y: [1, 2, { z: 3 }] } };
      const c = { x: { y: [1, 2, { z: 4 }] } };
      assert.equal(deepEqual(a, b), true);
      assert.equal(deepEqual(a, c), false);
    });

    test("handles null and undefined", () => {
      assert.equal(deepEqual(null, null), true);
      assert.equal(deepEqual(undefined, undefined), true);
      assert.equal(deepEqual(null, undefined), false);
    });
  });

  describe("isArrayOfObjects", () => {
    test("returns true for array of objects", () => {
      assert.equal(isArrayOfObjects([{ a: 1 }, { b: 2 }]), true);
    });

    test("returns false for empty array", () => {
      assert.equal(isArrayOfObjects([]), false);
    });

    test("returns false for array of primitives", () => {
      assert.equal(isArrayOfObjects([1, 2, 3]), false);
      assert.equal(isArrayOfObjects(["a", "b"]), false);
    });

    test("returns false for mixed array", () => {
      assert.equal(isArrayOfObjects([{ a: 1 }, "string"]), false);
    });
  });

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
    });

    describe("arrays", () => {
      test("recurses into arrays of objects matching by type", () => {
        const current = {
          rules: [
            {
              type: "pull_request",
              parameters: { required_approving_review_count: 1 },
            },
            { type: "required_signatures" },
          ],
        };
        const desired = {
          rules: [
            {
              type: "pull_request",
              parameters: { required_approving_review_count: 2 },
            },
            { type: "required_signatures" },
          ],
        };

        const diffs = computePropertyDiffs(current, desired);

        assert.equal(diffs.length, 1);
        assert.deepEqual(diffs[0].path, [
          "rules",
          "[0] (pull_request)",
          "parameters",
          "required_approving_review_count",
        ]);
        assert.equal(diffs[0].action, "change");
      });

      test("detects added array item", () => {
        const current = { rules: [{ type: "pull_request" }] };
        const desired = {
          rules: [{ type: "pull_request" }, { type: "required_signatures" }],
        };

        const diffs = computePropertyDiffs(current, desired);

        assert.ok(diffs.some((d) => d.action === "add"));
      });

      test("detects removed array item", () => {
        const current = {
          rules: [{ type: "pull_request" }, { type: "required_signatures" }],
        };
        const desired = { rules: [{ type: "pull_request" }] };

        const diffs = computePropertyDiffs(current, desired);

        assert.ok(diffs.some((d) => d.action === "remove"));
      });

      test("falls back to index matching for arrays without type field", () => {
        const current = {
          bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole" }],
        };
        const desired = {
          bypass_actors: [{ actor_id: 5, actor_type: "Team" }],
        };

        const diffs = computePropertyDiffs(current, desired);

        assert.ok(
          diffs.some(
            (d) => d.path.includes("actor_type") && d.action === "change"
          )
        );
      });
    });
  });
});
