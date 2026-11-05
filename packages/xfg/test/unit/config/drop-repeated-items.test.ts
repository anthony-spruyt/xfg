import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { dropRepeatedItems } from "../../../src/config/drop-repeated-items.js";

describe("dropRepeatedItems", () => {
  test("keeps the first of repeated strings", () => {
    assert.deepStrictEqual(dropRepeatedItems(["b", "a", "b", "a"]), ["b", "a"]);
  });

  test("keeps the first of repeated numbers and booleans", () => {
    assert.deepStrictEqual(dropRepeatedItems([1, 2, 1, true, true]), [
      1,
      2,
      true,
    ]);
  });

  test("tells 1 from '1'", () => {
    assert.deepStrictEqual(dropRepeatedItems([1, "1"]), [1, "1"]);
  });

  test("walks nested objects and arrays", () => {
    assert.deepStrictEqual(
      dropRepeatedItems({ a: { b: ["x", "x"] }, c: [{ d: ["y", "y"] }] }),
      { a: { b: ["x"] }, c: [{ d: ["y"] }] }
    );
  });

  test("keeps objects that look alike", () => {
    const list = [{ id: 1 }, { id: 1 }];
    assert.deepStrictEqual(dropRepeatedItems(list), list);
  });

  test("leaves other values alone", () => {
    assert.strictEqual(dropRepeatedItems("a"), "a");
    assert.strictEqual(dropRepeatedItems(null), null);
    assert.strictEqual(dropRepeatedItems(undefined), undefined);
    assert.deepStrictEqual(dropRepeatedItems([]), []);
  });

  test("does not change its input", () => {
    const input = { list: ["a", "a"] };
    dropRepeatedItems(input);
    assert.deepStrictEqual(input, { list: ["a", "a"] });
  });
});
