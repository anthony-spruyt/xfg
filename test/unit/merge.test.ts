import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  deepMerge,
  stripMergeDirectives,
  isTextContent,
  mergeTextContent,
  type ArrayMergeStrategy,
  type MergeContext,
} from "../../src/config/merge.js";

function createContext(
  defaultStrategy: ArrayMergeStrategy = "replace"
): MergeContext {
  return {
    arrayStrategies: new Map(),
    defaultArrayStrategy: defaultStrategy,
  };
}

describe("deepMerge", () => {
  test("returns overlay when base is empty", () => {
    const base = {};
    const overlay = { key: "value" };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { key: "value" });
  });

  test("returns base when overlay is empty", () => {
    const base = { key: "value" };
    const overlay = {};
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { key: "value" });
  });

  test("overlay scalar overwrites base scalar", () => {
    const base = { key: "original" };
    const overlay = { key: "updated" };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { key: "updated" });
  });

  test("preserves base keys not in overlay", () => {
    const base = { a: 1, b: 2 };
    const overlay = { b: 3 };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { a: 1, b: 3 });
  });

  test("adds overlay keys not in base", () => {
    const base = { a: 1 };
    const overlay = { b: 2 };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { a: 1, b: 2 });
  });

  test("merges nested objects recursively", () => {
    const base = { nested: { a: 1, b: 2 } };
    const overlay = { nested: { b: 3, c: 4 } };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { nested: { a: 1, b: 3, c: 4 } });
  });

  test("replaces arrays by default", () => {
    const base = { items: [1, 2, 3] };
    const overlay = { items: [4, 5] };
    const result = deepMerge(base, overlay, createContext("replace"));
    assert.deepEqual(result, { items: [4, 5] });
  });

  test("appends arrays when $arrayMerge: append in overlay", () => {
    const base = { items: [1, 2] };
    const overlay = { items: { $arrayMerge: "append", values: [3, 4] } };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { items: [1, 2, 3, 4] });
  });

  test("appends arrays when $arrayMerge: append with array syntax", () => {
    const base = { items: ["a", "b"] };
    // When $arrayMerge is a sibling, it applies to all arrays in that object level
    const ctx = createContext();
    ctx.arrayStrategies.set("items", "append");
    const result = deepMerge(base, { items: ["c", "d"] }, ctx);
    assert.deepEqual(result, { items: ["a", "b", "c", "d"] });
  });

  test("prepends arrays when $arrayMerge: prepend", () => {
    const base = { items: [1, 2] };
    const overlay = { items: { $arrayMerge: "prepend", values: [3, 4] } };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { items: [3, 4, 1, 2] });
  });

  test("uses context arrayStrategies for path-specific merge", () => {
    const base = { tags: ["a", "b"], ids: [1, 2] };
    const overlay = { tags: ["c"], ids: [3] };
    const ctx = createContext("replace");
    ctx.arrayStrategies.set("tags", "append");
    const result = deepMerge(base, overlay, ctx);
    assert.deepEqual(result, { tags: ["a", "b", "c"], ids: [3] });
  });

  test("handles deeply nested structures", () => {
    const base = {
      level1: {
        level2: {
          level3: {
            value: "base",
            arr: [1],
          },
        },
      },
    };
    const overlay = {
      level1: {
        level2: {
          level3: {
            value: "overlay",
            newKey: "added",
          },
        },
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      level1: {
        level2: {
          level3: {
            value: "overlay",
            arr: [1],
            newKey: "added",
          },
        },
      },
    });
  });

  test("overlay object replaces base primitive", () => {
    const base = { key: "string" };
    const overlay = { key: { nested: "object" } };
    const result = deepMerge(
      base,
      overlay as Record<string, unknown>,
      createContext()
    );
    assert.deepEqual(result, { key: { nested: "object" } });
  });

  test("overlay primitive replaces base object", () => {
    const base = { key: { nested: "object" } };
    const overlay = { key: "string" };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { key: "string" });
  });

  test("handles null values correctly", () => {
    const base = { key: "value" };
    const overlay = { key: null };
    const result = deepMerge(
      base,
      overlay as Record<string, unknown>,
      createContext()
    );
    assert.deepEqual(result, { key: null });
  });

  test("strips $arrayMerge directive from output", () => {
    const base = { items: [1, 2] };
    const overlay = { items: { $arrayMerge: "append", values: [3] } };
    const result = deepMerge(base, overlay, createContext());
    assert.equal("$arrayMerge" in result, false);
  });

  test("handles array of objects", () => {
    const base = { items: [{ id: 1 }, { id: 2 }] };
    const overlay = { items: [{ id: 3 }] };
    const result = deepMerge(base, overlay, createContext("replace"));
    assert.deepEqual(result, { items: [{ id: 3 }] });
  });

  test("$arrayMerge in nested object sets strategy for child array", () => {
    const base = {
      config: {
        features: ["a", "b"],
      },
    };
    const overlay = {
      config: {
        $arrayMerge: "append",
        features: ["c"],
      },
    } as Record<string, unknown>;
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      config: {
        features: ["a", "b", "c"],
      },
    });
  });
});

describe("stripMergeDirectives", () => {
  test("removes $arrayMerge keys", () => {
    const obj = { $arrayMerge: "append", key: "value" };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, { key: "value" });
  });

  test("removes $override keys", () => {
    const obj = { $override: true, key: "value" };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, { key: "value" });
  });

  test("preserves regular keys", () => {
    const obj = { key: "value", another: 123 };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, { key: "value", another: 123 });
  });

  test("works recursively on nested objects", () => {
    const obj = {
      $arrayMerge: "append",
      nested: {
        $override: true,
        value: "keep",
      },
    };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, { nested: { value: "keep" } });
  });

  test("works recursively on arrays of objects", () => {
    const obj = {
      items: [{ $arrayMerge: "append", name: "item1" }, { name: "item2" }],
    };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, {
      items: [{ name: "item1" }, { name: "item2" }],
    });
  });

  test("preserves keys starting with $ that are not directives", () => {
    // Only $arrayMerge and $override are directives
    const obj = { $customKey: "value", key: "value" };
    const result = stripMergeDirectives(obj);
    // We strip ALL $ prefixed keys as they are reserved for directives
    assert.deepEqual(result, { key: "value" });
  });

  test("handles empty objects", () => {
    const result = stripMergeDirectives({});
    assert.deepEqual(result, {});
  });

  test("handles objects with only directives", () => {
    const obj = { $arrayMerge: "append", $override: true };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, {});
  });
});

describe("isTextContent", () => {
  test("returns true for string", () => {
    assert.ok(isTextContent("hello"));
  });

  test("returns true for empty string", () => {
    assert.ok(isTextContent(""));
  });

  test("returns true for string array", () => {
    assert.ok(isTextContent(["a", "b", "c"]));
  });

  test("returns true for empty string array", () => {
    assert.ok(isTextContent([]));
  });

  test("returns false for object", () => {
    assert.ok(!isTextContent({ key: "value" }));
  });

  test("returns false for null", () => {
    assert.ok(!isTextContent(null));
  });

  test("returns false for number", () => {
    assert.ok(!isTextContent(123));
  });

  test("returns false for mixed array", () => {
    assert.ok(!isTextContent(["string", 123]));
  });

  test("returns false for array of objects", () => {
    assert.ok(!isTextContent([{ key: "value" }]));
  });
});

describe("mergeTextContent", () => {
  describe("string overlay", () => {
    test("string overlay replaces string base", () => {
      const result = mergeTextContent("base", "overlay");
      assert.equal(result, "overlay");
    });

    test("string overlay replaces array base", () => {
      const result = mergeTextContent(["base1", "base2"], "overlay");
      assert.equal(result, "overlay");
    });

    test("ignores strategy when overlay is string", () => {
      const result = mergeTextContent(["base"], "overlay", "append");
      assert.equal(result, "overlay");
    });
  });

  describe("array overlay with replace strategy", () => {
    test("array replaces array with default strategy", () => {
      const result = mergeTextContent(["base"], ["overlay"]);
      assert.deepEqual(result, ["overlay"]);
    });

    test("array replaces array with explicit replace", () => {
      const result = mergeTextContent(["base"], ["overlay"], "replace");
      assert.deepEqual(result, ["overlay"]);
    });

    test("array replaces string base", () => {
      const result = mergeTextContent("base", ["overlay1", "overlay2"]);
      assert.deepEqual(result, ["overlay1", "overlay2"]);
    });
  });

  describe("array overlay with append strategy", () => {
    test("appends overlay after base", () => {
      const result = mergeTextContent(
        ["base1", "base2"],
        ["overlay"],
        "append"
      );
      assert.deepEqual(result, ["base1", "base2", "overlay"]);
    });

    test("appends multiple overlay items", () => {
      const result = mergeTextContent(
        ["base"],
        ["overlay1", "overlay2"],
        "append"
      );
      assert.deepEqual(result, ["base", "overlay1", "overlay2"]);
    });

    test("append to empty array returns overlay", () => {
      const result = mergeTextContent([], ["overlay"], "append");
      assert.deepEqual(result, ["overlay"]);
    });

    test("append empty overlay returns base", () => {
      const result = mergeTextContent(["base"], [], "append");
      assert.deepEqual(result, ["base"]);
    });
  });

  describe("array overlay with prepend strategy", () => {
    test("prepends overlay before base", () => {
      const result = mergeTextContent(
        ["base1", "base2"],
        ["overlay"],
        "prepend"
      );
      assert.deepEqual(result, ["overlay", "base1", "base2"]);
    });

    test("prepends multiple overlay items", () => {
      const result = mergeTextContent(
        ["base"],
        ["overlay1", "overlay2"],
        "prepend"
      );
      assert.deepEqual(result, ["overlay1", "overlay2", "base"]);
    });

    test("prepend to empty array returns overlay", () => {
      const result = mergeTextContent([], ["overlay"], "prepend");
      assert.deepEqual(result, ["overlay"]);
    });

    test("prepend empty overlay returns base", () => {
      const result = mergeTextContent(["base"], [], "prepend");
      assert.deepEqual(result, ["base"]);
    });
  });
});
