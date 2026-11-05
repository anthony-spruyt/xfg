import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  arrayValues,
  isArrayMergeDirective,
} from "../../../src/config/array-directive.js";
import { deepMerge, createMergeContext } from "../../../src/config/merge.js";

describe("isArrayMergeDirective", () => {
  for (const strategy of ["append", "prepend", "replace", "merge"]) {
    test(`accepts ${strategy} with $values`, () => {
      assert.equal(
        isArrayMergeDirective({ $arrayMerge: strategy, $values: [] }),
        true
      );
    });
  }

  test("rejects an unknown strategy", () => {
    assert.equal(
      isArrayMergeDirective({ $arrayMerge: "union", $values: [] }),
      false
    );
  });

  test("rejects $values that is not an array", () => {
    assert.equal(
      isArrayMergeDirective({ $arrayMerge: "append", $values: "a" }),
      false
    );
    assert.equal(isArrayMergeDirective({ $arrayMerge: "append" }), false);
  });

  test("rejects an object that mixes directive and other keys", () => {
    assert.equal(
      isArrayMergeDirective({ $arrayMerge: "append", $values: [], extra: 1 }),
      false
    );
  });

  test("rejects values that are not plain objects", () => {
    for (const value of [undefined, null, "append", 1, [], {}]) {
      assert.equal(isArrayMergeDirective(value), false);
    }
  });

  describe("$matchBy", () => {
    test("accepts merge with a key every item holds", () => {
      assert.equal(
        isArrayMergeDirective({
          $arrayMerge: "merge",
          $matchBy: "name",
          $values: [{ name: "a" }, { name: "b" }],
        }),
        true
      );
    });

    test("rejects an empty $matchBy", () => {
      assert.equal(
        isArrayMergeDirective({
          $arrayMerge: "merge",
          $matchBy: "",
          $values: [],
        }),
        false
      );
    });

    test("rejects a $matchBy that is not a string", () => {
      assert.equal(
        isArrayMergeDirective({
          $arrayMerge: "merge",
          $matchBy: 1,
          $values: [],
        }),
        false
      );
    });

    test("rejects $matchBy with a strategy other than merge", () => {
      assert.equal(
        isArrayMergeDirective({
          $arrayMerge: "append",
          $matchBy: "name",
          $values: [{ name: "a" }],
        }),
        false
      );
    });

    test("rejects $matchBy over items that are not objects", () => {
      assert.equal(
        isArrayMergeDirective({
          $arrayMerge: "merge",
          $matchBy: "name",
          $values: ["a"],
        }),
        false
      );
    });

    test("rejects $matchBy over an item without that key", () => {
      assert.equal(
        isArrayMergeDirective({
          $arrayMerge: "merge",
          $matchBy: "name",
          $values: [{ other: "a" }],
        }),
        false
      );
    });

    test("rejects $matchBy over items that share a value", () => {
      assert.equal(
        isArrayMergeDirective({
          $arrayMerge: "merge",
          $matchBy: "name",
          $values: [{ name: "a" }, { name: "a" }],
        }),
        false
      );
    });

    test("rejects a $matchBy value that is not a string, number, boolean or null", () => {
      for (const name of [{ id: 1 }, ["a"]]) {
        assert.equal(
          isArrayMergeDirective({
            $arrayMerge: "merge",
            $matchBy: "name",
            $values: [{ name }],
          }),
          false
        );
      }
    });

    test("accepts string, number, boolean and null $matchBy values", () => {
      assert.equal(
        isArrayMergeDirective({
          $arrayMerge: "merge",
          $matchBy: "name",
          $values: [{ name: "a" }, { name: 1 }, { name: true }, { name: null }],
        }),
        true
      );
    });
  });

  test("agrees with deepMerge on every directive it rejects for $matchBy", () => {
    const rejected = [
      { $arrayMerge: "merge", $matchBy: "", $values: [] },
      { $arrayMerge: "append", $matchBy: "name", $values: [{ name: "a" }] },
      { $arrayMerge: "merge", $matchBy: "name", $values: ["a"] },
      {
        $arrayMerge: "merge",
        $matchBy: "name",
        $values: [{ name: "a" }, { name: "a" }],
      },
      { $arrayMerge: "merge", $matchBy: "name", $values: [{ name: { a: 1 } }] },
    ];
    for (const directive of rejected) {
      assert.equal(isArrayMergeDirective(directive), false);
      assert.throws(() =>
        deepMerge(
          { list: [{ name: "a" }] },
          { list: directive },
          createMergeContext("replace", "check")
        )
      );
    }
  });
});

describe("arrayValues", () => {
  test("returns an array as it is", () => {
    const list = ["a", "b"];
    assert.strictEqual(arrayValues(list), list);
  });

  test("returns the $values of a directive", () => {
    assert.deepStrictEqual(
      arrayValues({ $arrayMerge: "append", $values: ["a"] }),
      ["a"]
    );
  });

  test("returns null for anything else", () => {
    for (const value of [
      undefined,
      null,
      "a",
      1,
      {},
      { $arrayMerge: "union", $values: [] },
    ]) {
      assert.strictEqual(arrayValues(value), null);
    }
  });
});
