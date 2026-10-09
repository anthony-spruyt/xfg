import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  createMergeContext,
  deepMerge,
  stripMergeDirectives,
  isTextContent,
  mergeTextContent,
  findMatchKey,
  MATCH_KEY_CANDIDATES,
  type ArrayMergeStrategy,
  type MergeContext,
} from "../../../src/config/merge.js";

function createContext(
  defaultStrategy: ArrayMergeStrategy = "replace"
): MergeContext {
  return {
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

  test("appends arrays with $arrayMerge + $values directive", () => {
    const base = { items: [1, 2] };
    const overlay = { items: { $arrayMerge: "append", $values: [3, 4] } };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { items: [1, 2, 3, 4] });
  });

  test("prepends arrays with $arrayMerge + $values directive", () => {
    const base = { items: [1, 2] };
    const overlay = { items: { $arrayMerge: "prepend", $values: [3, 4] } };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { items: [3, 4, 1, 2] });
  });

  test("replaces arrays with $arrayMerge: replace + $values directive", () => {
    const base = { items: [1, 2, 3] };
    const overlay = { items: { $arrayMerge: "replace", $values: [4, 5] } };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { items: [4, 5] });
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

  test("$arrayMerge + $values produces merged array without directive keys", () => {
    const base = { items: [1, 2] };
    const overlay = { items: { $arrayMerge: "append", $values: [3] } };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { items: [1, 2, 3] });
  });

  test("handles array of objects", () => {
    const base = { items: [{ id: 1 }, { id: 2 }] };
    const overlay = { items: [{ id: 3 }] };
    const result = deepMerge(base, overlay, createContext("replace"));
    assert.deepEqual(result, { items: [{ id: 3 }] });
  });

  test("different strategies for sibling arrays", () => {
    const base = { features: ["a", "b"], tags: ["x", "y"] };
    const overlay = {
      features: { $arrayMerge: "append", $values: ["c"] },
      tags: { $arrayMerge: "prepend", $values: ["w"] },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      features: ["a", "b", "c"],
      tags: ["w", "x", "y"],
    });
  });

  test("$arrayMerge without $values falls through to normal merge", () => {
    const base = { items: [1, 2] };
    const overlay = { items: { $arrayMerge: "append", other: "key" } };
    const result = deepMerge(
      base,
      overlay as Record<string, unknown>,
      createContext()
    );
    // No $values, so the directive object replaces the base array (overlay wins).
    // $arrayMerge is NOT stripped here — stripMergeDirectives handles that later.
    assert.deepEqual(result, {
      items: { $arrayMerge: "append", other: "key" },
    });
  });

  test("$arrayMerge + $values with non-array base falls through to overlay wins", () => {
    const base = { items: "not-an-array" };
    const overlay = { items: { $arrayMerge: "append", $values: [1, 2] } };
    const result = deepMerge(
      base,
      overlay as Record<string, unknown>,
      createContext()
    );
    // Base is not an array, so the directive can't merge — overlay object wins as-is.
    // stripMergeDirectives (called by normalizer) will clean up $ keys later.
    assert.deepEqual(result, {
      items: { $arrayMerge: "append", $values: [1, 2] },
    });
  });

  test("$values is stripped from output after merge", () => {
    const base = { items: [1] };
    const overlay = { items: { $arrayMerge: "append", $values: [2] } };
    const result = deepMerge(base, overlay, createContext());
    const jsonStr = JSON.stringify(result);
    assert.ok(!jsonStr.includes("$values"));
  });

  test("preserves $schema key during merge", () => {
    const base = { $schema: "https://example.com/schema.json", key: "base" };
    const overlay = { key: "overlay" };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      $schema: "https://example.com/schema.json",
      key: "overlay",
    });
  });

  test("preserves $schema from overlay during merge", () => {
    const base = { key: "base" };
    const overlay = {
      $schema: "https://example.com/schema.json",
      key: "overlay",
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      $schema: "https://example.com/schema.json",
      key: "overlay",
    });
  });

  test("preserves multiple $-prefixed non-directive keys during merge", () => {
    const base = {
      $schema: "https://example.com/schema.json",
      $generated: "auto",
      key: "base",
    };
    const overlay = {
      $id: "my-config",
      key: "overlay",
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      $schema: "https://example.com/schema.json",
      $generated: "auto",
      $id: "my-config",
      key: "overlay",
    });
  });

  test("still strips $arrayMerge and $values directive keys", () => {
    const base = { items: [1, 2] };
    const overlay = { items: { $arrayMerge: "append", $values: [3] } };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { items: [1, 2, 3] });
  });

  test("resolves base directive before applying overlay directive (stacked directives)", () => {
    const base = {
      items: { $arrayMerge: "append", $values: [1, 2] },
    };
    const overlay = {
      items: { $arrayMerge: "append", $values: [3, 4] },
    };
    const result = deepMerge(base, overlay, createContext("replace"));
    assert.deepEqual(result, { items: [1, 2, 3, 4] });
  });

  test("resolves base directive when overlay is a plain array", () => {
    const base = {
      items: { $arrayMerge: "append", $values: [1, 2] },
    };
    const overlay = {
      items: [3, 4],
    };
    const result = deepMerge(base, overlay, createContext("replace"));
    // Plain array overlay replaces (default strategy) the resolved base
    assert.deepEqual(result, { items: [3, 4] });
  });
});

describe("findMatchKey", () => {
  test("returns 'type' when all items have type field", () => {
    const base = [{ type: "a" }, { type: "b" }];
    const overlay = [{ type: "c" }];
    assert.equal(findMatchKey(base, overlay), "type");
  });

  test("returns 'actor_id' when all items have actor_id field", () => {
    const base = [{ actor_id: 1 }, { actor_id: 2 }];
    const overlay = [{ actor_id: 3 }];
    assert.equal(findMatchKey(base, overlay), "actor_id");
  });

  test("prefers 'type' over 'actor_id' when both present", () => {
    const base = [{ type: "a", actor_id: 1 }];
    const overlay = [{ type: "b", actor_id: 2 }];
    assert.equal(findMatchKey(base, overlay), "type");
  });

  test("returns undefined for primitive arrays", () => {
    assert.equal(findMatchKey([1, 2], [3]), undefined);
  });

  test("returns undefined when not all items share key", () => {
    const base = [{ type: "a" }, { name: "b" }];
    const overlay = [{ type: "c" }];
    assert.equal(findMatchKey(base, overlay), undefined);
  });

  test("returns undefined for empty arrays", () => {
    assert.equal(findMatchKey([], []), undefined);
  });

  test("exports MATCH_KEY_CANDIDATES", () => {
    assert.deepEqual([...MATCH_KEY_CANDIDATES], ["type", "actor_id"]);
  });
});

describe("$arrayMerge: merge strategy", () => {
  test("deep-merges items matched by type key", () => {
    const base = {
      rules: [
        { type: "a", x: 1 },
        { type: "b", x: 2 },
      ],
    };
    const overlay = {
      rules: { $arrayMerge: "merge", $values: [{ type: "a", y: 3 }] },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      rules: [
        { type: "a", x: 1, y: 3 },
        { type: "b", x: 2 },
      ],
    });
  });

  test("falls back to append when no match key found", () => {
    const base = { items: [{ name: "a" }, { name: "b" }] };
    const overlay = {
      items: { $arrayMerge: "merge", $values: [{ name: "c" }] },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      items: [{ name: "a" }, { name: "b" }, { name: "c" }],
    });
  });

  test("handles mixed matched and unmatched items", () => {
    const base = {
      rules: [
        { type: "a", x: 1 },
        { type: "b", x: 2 },
      ],
    };
    const overlay = {
      rules: {
        $arrayMerge: "merge",
        $values: [
          { type: "a", y: 3 },
          { type: "c", z: 4 },
        ],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      rules: [
        { type: "a", x: 1, y: 3 },
        { type: "b", x: 2 },
        { type: "c", z: 4 },
      ],
    });
  });

  test("nested $arrayMerge: append inside matched items honored", () => {
    const base = {
      rules: [{ type: "rsc", parameters: { checks: ["ci"] } }],
    };
    const overlay = {
      rules: {
        $arrayMerge: "merge",
        $values: [
          {
            type: "rsc",
            parameters: {
              checks: { $arrayMerge: "append", $values: ["mergify"] },
            },
          },
        ],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      rules: [{ type: "rsc", parameters: { checks: ["ci", "mergify"] } }],
    });
  });

  test("matches by actor_id key", () => {
    const base = {
      actors: [
        { actor_id: 1, bypass_mode: "always" },
        { actor_id: 2, bypass_mode: "pull_request" },
      ],
    };
    const overlay = {
      actors: {
        $arrayMerge: "merge",
        $values: [{ actor_id: 1, bypass_mode: "pull_request" }],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      actors: [
        { actor_id: 1, bypass_mode: "pull_request" },
        { actor_id: 2, bypass_mode: "pull_request" },
      ],
    });
  });

  test("primitive arrays (no keys) fall back to append", () => {
    const base = { tags: [1, 2, 3] };
    const overlay = {
      tags: { $arrayMerge: "merge", $values: [4, 5] },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { tags: [1, 2, 3, 4, 5] });
  });

  test("stacked directives — base has $arrayMerge: merge directive", () => {
    const base = {
      rules: {
        $arrayMerge: "merge",
        $values: [
          { type: "a", x: 1 },
          { type: "b", x: 2 },
        ],
      },
    };
    const overlay = {
      rules: {
        $arrayMerge: "merge",
        $values: [{ type: "a", y: 3 }],
      },
    };
    const result = deepMerge(base, overlay, createContext("replace"));
    assert.deepEqual(result, {
      rules: [
        { type: "a", x: 1, y: 3 },
        { type: "b", x: 2 },
      ],
    });
  });

  test("overlay item overwrites scalar in matched base item", () => {
    const base = { rules: [{ type: "a", value: "old", keep: true }] };
    const overlay = {
      rules: {
        $arrayMerge: "merge",
        $values: [{ type: "a", value: "new" }],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      rules: [{ type: "a", value: "new", keep: true }],
    });
  });

  test("empty base array returns overlay items", () => {
    const base = { rules: [] as unknown[] };
    const overlay = {
      rules: {
        $arrayMerge: "merge",
        $values: [{ type: "a", x: 1 }],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { rules: [{ type: "a", x: 1 }] });
  });

  test("empty overlay array returns base items", () => {
    const base = { rules: [{ type: "a", x: 1 }] };
    const overlay = {
      rules: { $arrayMerge: "merge", $values: [] as unknown[] },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { rules: [{ type: "a", x: 1 }] });
  });

  test("duplicate keys in base — first occurrence wins", () => {
    const base = {
      rules: [
        { type: "a", x: 1 },
        { type: "a", x: 2 },
        { type: "b", x: 3 },
      ],
    };
    const overlay = {
      rules: {
        $arrayMerge: "merge",
        $values: [{ type: "a", y: 10 }],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      rules: [
        { type: "a", x: 1, y: 10 },
        { type: "a", x: 2 },
        { type: "b", x: 3 },
      ],
    });
  });

  test("merge as default mergeStrategy via context", () => {
    const base = {
      rules: [
        { type: "a", x: 1 },
        { type: "b", x: 2 },
      ],
    };
    const overlay = {
      rules: [{ type: "a", y: 3 }],
    };
    const result = deepMerge(base, overlay, createContext("merge"));
    assert.deepEqual(result, {
      rules: [
        { type: "a", x: 1, y: 3 },
        { type: "b", x: 2 },
      ],
    });
  });
});

describe("$matchBy directive", () => {
  test("deep-merges items matched by the chosen key", () => {
    const base = {
      queue_rules: [
        { name: "default", batch_size: 1 },
        { name: "hotfix", batch_size: 5 },
      ],
    };
    const overlay = {
      queue_rules: {
        $arrayMerge: "merge",
        $matchBy: "name",
        $values: [{ name: "hotfix", batch_size: 10 }],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      queue_rules: [
        { name: "default", batch_size: 1 },
        { name: "hotfix", batch_size: 10 },
      ],
    });
  });

  test("honors nested directives inside matched items", () => {
    const base = {
      queue_rules: [{ name: "default", merge_conditions: ["check-a"] }],
    };
    const overlay = {
      queue_rules: {
        $arrayMerge: "merge",
        $matchBy: "name",
        $values: [
          {
            name: "default",
            merge_conditions: { $arrayMerge: "append", $values: ["check-b"] },
          },
        ],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      queue_rules: [
        { name: "default", merge_conditions: ["check-a", "check-b"] },
      ],
    });
  });

  test("appends overlay items with no match", () => {
    const base = { queue_rules: [{ name: "default", batch_size: 1 }] };
    const overlay = {
      queue_rules: {
        $arrayMerge: "merge",
        $matchBy: "name",
        $values: [{ name: "lowprio", batch_size: 20 }],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      queue_rules: [
        { name: "default", batch_size: 1 },
        { name: "lowprio", batch_size: 20 },
      ],
    });
  });

  test("matches by the chosen key even when an auto-detect key is present", () => {
    const base = {
      steps: [
        { type: "run", name: "build", cmd: "make" },
        { type: "run", name: "test", cmd: "make test" },
      ],
    };
    const overlay = {
      steps: {
        $arrayMerge: "merge",
        $matchBy: "name",
        $values: [{ type: "run", name: "test", cmd: "npm test" }],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      steps: [
        { type: "run", name: "build", cmd: "make" },
        { type: "run", name: "test", cmd: "npm test" },
      ],
    });
  });

  test("does not match by name without $matchBy", () => {
    const base = { queue_rules: [{ name: "default", batch_size: 1 }] };
    const overlay = {
      queue_rules: {
        $arrayMerge: "merge",
        $values: [{ name: "default", batch_size: 10 }],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, {
      queue_rules: [
        { name: "default", batch_size: 1 },
        { name: "default", batch_size: 10 },
      ],
    });
  });

  test("strips $matchBy from merged output", () => {
    const base = { list: [{ name: "a", nested: { x: 1 } }] };
    const overlay = {
      list: {
        $arrayMerge: "merge",
        $matchBy: "name",
        $values: [{ name: "a", nested: { y: 2 } }],
      },
    };
    const result = deepMerge(base, overlay, createContext());
    assert.deepEqual(result, { list: [{ name: "a", nested: { x: 1, y: 2 } }] });
    assert.ok(!JSON.stringify(result).includes("$matchBy"));
  });

  describe("errors", () => {
    const queueRules = (values: unknown[], strategy = "merge") => ({
      queue_rules: { $arrayMerge: strategy, $matchBy: "name", $values: values },
    });

    for (const strategy of ["append", "prepend", "replace"]) {
      test(`rejects $matchBy with $arrayMerge: ${strategy}`, () => {
        assert.throws(
          () =>
            deepMerge(
              { queue_rules: [{ name: "a" }] },
              queueRules([{ name: "a" }], strategy),
              createContext()
            ),
          {
            name: "ValidationError",
            message: `queue_rules: $matchBy requires $arrayMerge: merge, got '${strategy}'`,
          }
        );
      });
    }

    test("rejects $matchBy without merge even when there is no base array", () => {
      assert.throws(
        () =>
          deepMerge({}, queueRules([{ name: "a" }], "append"), createContext()),
        {
          name: "ValidationError",
          message:
            "queue_rules: $matchBy requires $arrayMerge: merge, got 'append'",
        }
      );
    });

    test("rejects $matchBy without $arrayMerge", () => {
      assert.throws(
        () =>
          deepMerge(
            { queue_rules: [{ name: "a" }] },
            { queue_rules: { $matchBy: "name", $values: [{ name: "a" }] } },
            createContext()
          ),
        {
          name: "ValidationError",
          message:
            "queue_rules: $matchBy requires $arrayMerge: merge, got none",
        }
      );
    });

    test("shows a non-string $arrayMerge as JSON in the error", () => {
      assert.throws(
        () =>
          deepMerge(
            { queue_rules: [{ name: "a" }] },
            {
              queue_rules: {
                $arrayMerge: { mode: "merge" },
                $matchBy: "name",
                $values: [{ name: "a" }],
              },
            },
            createContext()
          ),
        {
          name: "ValidationError",
          message:
            'queue_rules: $matchBy requires $arrayMerge: merge, got {"mode":"merge"}',
        }
      );
    });

    test("rejects a $matchBy that is not a non-empty string", () => {
      for (const matchBy of ["", 42, null]) {
        assert.throws(
          () =>
            deepMerge(
              { list: [{ name: "a" }] },
              {
                list: { $arrayMerge: "merge", $matchBy: matchBy, $values: [] },
              },
              createContext()
            ),
          {
            name: "ValidationError",
            message: "list: $matchBy must be a non-empty string",
          }
        );
      }
    });

    test("rejects a base item missing the key", () => {
      assert.throws(
        () =>
          deepMerge(
            { queue_rules: [{ name: "a" }, { batch_size: 2 }] },
            queueRules([{ name: "a" }]),
            createContext()
          ),
        {
          name: "ValidationError",
          message: "queue_rules: base item 1 has no $matchBy key 'name'",
        }
      );
    });

    test("rejects an overlay item missing the key, including non-objects", () => {
      for (const item of [{ batch_size: 2 }, "name"]) {
        assert.throws(
          () =>
            deepMerge(
              { queue_rules: [{ name: "a" }] },
              queueRules([{ name: "a" }, item]),
              createContext()
            ),
          {
            name: "ValidationError",
            message: "queue_rules: overlay item 1 has no $matchBy key 'name'",
          }
        );
      }
    });

    test("rejects duplicate key values in the base array", () => {
      assert.throws(
        () =>
          deepMerge(
            { queue_rules: [{ name: "a" }, { name: "a" }] },
            queueRules([{ name: "a" }]),
            createContext()
          ),
        {
          name: "ValidationError",
          message: "queue_rules: base items 0 and 1 share $matchBy name 'a'",
        }
      );
    });

    test("rejects duplicate key values in the overlay array", () => {
      assert.throws(
        () =>
          deepMerge(
            { queue_rules: [{ name: "a" }] },
            queueRules([{ name: "b" }, { name: "c" }, { name: "b" }]),
            createContext()
          ),
        {
          name: "ValidationError",
          message: "queue_rules: overlay items 0 and 2 share $matchBy name 'b'",
        }
      );
    });

    test("rejects a key the items only inherit", () => {
      assert.throws(
        () =>
          deepMerge(
            { list: [{ a: 1 }] },
            {
              list: {
                $arrayMerge: "merge",
                $matchBy: "toString",
                $values: [{ a: 2 }],
              },
            },
            createContext()
          ),
        {
          name: "ValidationError",
          message: "list: overlay item 0 has no $matchBy key 'toString'",
        }
      );
    });

    test("rejects object and array key values", () => {
      assert.throws(
        () =>
          deepMerge(
            { queue_rules: [{ name: { x: 1 }, v: 1 }] },
            queueRules([{ name: { x: 1 }, v: 2 }]),
            createContext()
          ),
        {
          name: "ValidationError",
          message:
            "queue_rules: overlay item 0 $matchBy name must be a string, number, boolean or null",
        }
      );
      assert.throws(
        () =>
          deepMerge(
            { queue_rules: [{ name: ["a"] }] },
            queueRules([{ name: "a" }]),
            createContext()
          ),
        {
          name: "ValidationError",
          message:
            "queue_rules: base item 0 $matchBy name must be a string, number, boolean or null",
        }
      );
    });

    test("matches number, boolean and null key values", () => {
      const result = deepMerge(
        { list: [{ id: 1 }, { id: true }, { id: null }] },
        {
          list: {
            $arrayMerge: "merge",
            $matchBy: "id",
            $values: [
              { id: null, v: "n" },
              { id: 1, v: "1" },
              { id: true, v: "t" },
            ],
          },
        },
        createContext()
      );
      assert.deepEqual(result.list, [
        { id: 1, v: "1" },
        { id: true, v: "t" },
        { id: null, v: "n" },
      ]);
    });

    test("validates the $matchBy of a base directive left unresolved", () => {
      assert.throws(
        () =>
          deepMerge(
            queueRules([{ name: "a" }], "append"),
            {
              queue_rules: { $arrayMerge: "append", $values: [{ name: "b" }] },
            },
            createContext()
          ),
        {
          name: "ValidationError",
          message:
            "queue_rules: $matchBy requires $arrayMerge: merge, got 'append'",
        }
      );
      assert.throws(
        () =>
          deepMerge(
            queueRules([{ name: "a" }, { name: "a" }]),
            {
              queue_rules: { $arrayMerge: "append", $values: [{ name: "b" }] },
            },
            createContext()
          ),
        {
          name: "ValidationError",
          message: "queue_rules: base items 0 and 1 share $matchBy name 'a'",
        }
      );
    });

    test("rejects a base $matchBy without $arrayMerge under a plain array", () => {
      assert.throws(
        () =>
          deepMerge(
            { queue_rules: { $matchBy: "name", $values: [{ name: "a" }] } },
            { queue_rules: [{ name: "b" }] },
            createContext()
          ),
        {
          name: "ValidationError",
          message:
            "queue_rules: $matchBy requires $arrayMerge: merge, got none",
        }
      );
    });

    test("validates the overlay array when there is no base array", () => {
      assert.throws(
        () =>
          deepMerge(
            {},
            queueRules([{ name: "a" }, { name: "a" }]),
            createContext()
          ),
        {
          name: "ValidationError",
          message: "queue_rules: overlay items 0 and 1 share $matchBy name 'a'",
        }
      );
    });

    test("names the nested path, through objects and matched items", () => {
      const base = {
        pull_request_rules: [
          { name: "x", actions: { queue: { rules: [{ name: "a" }] } } },
        ],
      };
      const overlay = {
        pull_request_rules: {
          $arrayMerge: "merge",
          $matchBy: "name",
          $values: [
            {
              name: "x",
              actions: {
                queue: {
                  rules: {
                    $arrayMerge: "merge",
                    $matchBy: "name",
                    $values: [{ id: 1 }],
                  },
                },
              },
            },
          ],
        },
      };
      assert.throws(() => deepMerge(base, overlay, createContext()), {
        name: "ValidationError",
        message:
          "pull_request_rules[0].actions.queue.rules: overlay item 0 has no $matchBy key 'name'",
      });
    });

    test("prefixes errors with the context location", () => {
      assert.throws(
        () =>
          deepMerge(
            { queue_rules: [{ name: "a" }] },
            queueRules([{ name: "a" }], "append"),
            createMergeContext("replace", ".mergify.yml")
          ),
        {
          name: "ValidationError",
          message:
            ".mergify.yml: queue_rules: $matchBy requires $arrayMerge: merge, got 'append'",
        }
      );
    });
  });
});

describe("stripMergeDirectives", () => {
  test("removes $arrayMerge keys", () => {
    const obj = { $arrayMerge: "append", key: "value" };
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
        $values: [1],
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

  test("preserves $schema key", () => {
    const obj = { $schema: "https://example.com/schema.json", key: "value" };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, {
      $schema: "https://example.com/schema.json",
      key: "value",
    });
  });

  test("preserves $generated and $id keys", () => {
    const obj = { $generated: "auto", $id: "config", key: "value" };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, {
      $generated: "auto",
      $id: "config",
      key: "value",
    });
  });

  test("preserves $-prefixed keys in nested objects", () => {
    const obj = {
      $schema: "https://example.com/schema.json",
      nested: {
        $ref: "#/definitions/foo",
        value: "keep",
      },
    };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, {
      $schema: "https://example.com/schema.json",
      nested: { $ref: "#/definitions/foo", value: "keep" },
    });
  });

  test("still strips $arrayMerge directive from objects", () => {
    const obj = {
      $arrayMerge: "append",
      $schema: "https://example.com/schema.json",
      key: "value",
    };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, {
      $schema: "https://example.com/schema.json",
      key: "value",
    });
  });

  test("handles empty objects", () => {
    const result = stripMergeDirectives({});
    assert.deepEqual(result, {});
  });

  test("handles objects with only directives", () => {
    // Top-level directive keys ($arrayMerge, $values) are stripped individually,
    // leaving {}. Nested directive objects are resolved to their $values array instead.
    const obj = { $arrayMerge: "append", $values: [1, 2] };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, {});
  });

  test("resolves unmerged $arrayMerge directive to its $values array", () => {
    const obj = {
      name: "test",
      items: { $arrayMerge: "append", $values: [1, 2, 3] },
    };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, { name: "test", items: [1, 2, 3] });
  });

  test("strips directive keys from objects nested inside $values", () => {
    const obj = {
      name: "test",
      items: {
        $arrayMerge: "append",
        $values: [
          { $arrayMerge: "replace", $values: ["nested"], label: "keep" },
          { clean: "already" },
        ],
      },
    };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, {
      name: "test",
      items: [{ label: "keep" }, { clean: "already" }],
    });
  });

  test("resolves nested unmerged $arrayMerge directive", () => {
    const obj = {
      outer: {
        inner: { $arrayMerge: "prepend", $values: ["a", "b"] },
        keep: "yes",
      },
    };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, {
      outer: { inner: ["a", "b"], keep: "yes" },
    });
  });

  test("resolves an unmerged $matchBy directive to its $values array", () => {
    const obj = {
      queue_rules: {
        $arrayMerge: "merge",
        $matchBy: "name",
        $values: [{ name: "default" }, { name: "hotfix" }],
      },
    };
    const result = stripMergeDirectives(obj);
    assert.deepEqual(result, {
      queue_rules: [{ name: "default" }, { name: "hotfix" }],
    });
  });

  test("rejects an unmerged $matchBy directive without merge, naming its path", () => {
    const obj = {
      outer: {
        queue_rules: {
          $arrayMerge: "append",
          $matchBy: "name",
          $values: [{ name: "default" }],
        },
      },
    };
    assert.throws(() => stripMergeDirectives(obj, ".mergify.yml"), {
      name: "ValidationError",
      message:
        ".mergify.yml: outer.queue_rules: $matchBy requires $arrayMerge: merge, got 'append'",
    });
  });

  test("rejects an unmerged $matchBy directive without $arrayMerge", () => {
    const obj = {
      outer: {
        queue_rules: { $matchBy: "name", $values: [{ name: "default" }] },
      },
    };
    assert.throws(() => stripMergeDirectives(obj, ".mergify.yml"), {
      name: "ValidationError",
      message:
        ".mergify.yml: outer.queue_rules: $matchBy requires $arrayMerge: merge, got none",
    });
  });

  test("rejects an invalid $matchBy on an object that is not a directive", () => {
    const obj = { k: { $matchBy: "", $arrayMerge: "merge", other: 1 } };
    assert.throws(() => stripMergeDirectives(obj), {
      name: "ValidationError",
      message: "k: $matchBy must be a non-empty string",
    });
  });

  test("rejects duplicate values in an unmerged $matchBy directive", () => {
    const obj = {
      list: [
        {
          queue_rules: {
            $arrayMerge: "merge",
            $matchBy: "name",
            $values: [{ name: "a" }, { name: "a" }],
          },
        },
      ],
    };
    assert.throws(() => stripMergeDirectives(obj), {
      name: "ValidationError",
      message:
        "list[0].queue_rules: $values items 0 and 1 share $matchBy name 'a'",
    });
  });
});

describe("directives without an array of $values", () => {
  const error = (path: string, got: string) => ({
    name: "ValidationError",
    message: `${path}: $values must be an array, got ${got}`,
  });

  test("rejects an unmerged directive with no $values", () => {
    assert.throws(
      () =>
        stripMergeDirectives({
          queue_rules: { $arrayMerge: "merge", $matchBy: "name" },
        }),
      error("queue_rules", "none")
    );
  });

  test("rejects an unmerged directive with non-array $values", () => {
    assert.throws(
      () =>
        stripMergeDirectives({ list: { $arrayMerge: "append", $values: "a" } }),
      error("list", "'a'")
    );
  });

  test("rejects an overlay directive with no $values over a base array", () => {
    assert.throws(
      () =>
        deepMerge(
          { list: ["a"] },
          { list: { $arrayMerge: "append" } },
          createContext()
        ),
      error("list", "none")
    );
  });

  test("rejects an overlay directive with non-array $values over a base object", () => {
    assert.throws(
      () =>
        deepMerge(
          { list: { x: 1 } },
          { list: { $arrayMerge: "append", $values: { y: 2 } } },
          createContext()
        ),
      error("list", '{"y":2}')
    );
  });

  test("rejects a base directive with no $values under a plain array", () => {
    assert.throws(
      () =>
        deepMerge(
          { list: { $arrayMerge: "append" } },
          { list: ["b"] },
          createContext()
        ),
      error("list", "none")
    );
  });
});

describe("directives without a valid $arrayMerge", () => {
  const error = (got: string) => ({
    name: "ValidationError",
    message: `list: $arrayMerge must be one of replace, append, prepend, merge, got ${got}`,
  });

  test("rejects an unmerged directive with an unknown strategy", () => {
    assert.throws(
      () =>
        stripMergeDirectives({
          list: { $arrayMerge: "apend", $values: ["a"] },
        }),
      error("'apend'")
    );
  });

  test("rejects an unmerged directive with no $arrayMerge", () => {
    assert.throws(
      () => stripMergeDirectives({ list: { $values: ["a"] } }),
      error("none")
    );
  });

  test("rejects an overlay directive with an unknown strategy over a base array", () => {
    assert.throws(
      () =>
        deepMerge(
          { list: ["a"] },
          { list: { $arrayMerge: "apend", $values: ["b"] } },
          createContext()
        ),
      error("'apend'")
    );
  });

  test("rejects an overlay directive with no $arrayMerge over a base object", () => {
    assert.throws(
      () =>
        deepMerge(
          { list: { x: 1 } },
          { list: { $values: ["b"] } },
          createContext()
        ),
      error("none")
    );
  });

  test("keeps the other keys of an object that also has directive keys", () => {
    assert.deepEqual(
      stripMergeDirectives({ k: { $arrayMerge: "apend", other: 1 } }),
      { k: { other: 1 } }
    );
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

  describe("array overlay with merge strategy", () => {
    test("merge strategy falls back to append for text arrays", () => {
      const result = mergeTextContent(["base1", "base2"], ["overlay"], "merge");
      assert.deepEqual(result, ["base1", "base2", "overlay"]);
    });

    test("merge strategy on string overlay still replaces", () => {
      const result = mergeTextContent(["base"], "overlay", "merge");
      assert.equal(result, "overlay");
    });
  });
});
