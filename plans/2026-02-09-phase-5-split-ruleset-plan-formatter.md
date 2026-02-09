# Phase 5: Split ruleset-plan-formatter.ts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the diff algorithm from `ruleset-plan-formatter.ts` into a separate module, achieving clear separation between algorithm and presentation.

**Architecture:** Extract `computePropertyDiffs()`, `deepEqual()`, `diffObjectArrays()`, and helper functions into `src/settings/rulesets/diff-algorithm.ts`. Keep formatting logic in `ruleset-plan-formatter.ts`. Both `ruleset-diff.ts` and `ruleset-plan-formatter.ts` have their own `deepEqual()` - we'll consolidate the property-diff version into the new module.

**Tech Stack:** TypeScript, Node.js test runner

---

## Summary

| Current State                           | Target State                                       |
| --------------------------------------- | -------------------------------------------------- |
| `ruleset-plan-formatter.ts` (622 lines) | `ruleset-plan-formatter.ts` (~400 lines)           |
| Mixed algorithm + formatting            | `settings/rulesets/diff-algorithm.ts` (~150 lines) |

**Functions to extract:**

- `computePropertyDiffs()` - main entry point
- `deepEqual()` - deep equality comparison
- `diffObjectArrays()` - array diffing by type or index
- `isObject()` - type guard helper
- `isArrayOfObjects()` - type guard helper

**Types to extract:**

- `DiffAction`
- `PropertyDiff`

---

## Task 1: Create diff-algorithm module with types

**Files:**

- Create: `src/settings/rulesets/diff-algorithm.ts`

**Step 1: Create the directory structure**

Run: `mkdir -p src/settings/rulesets`
Expected: Directory created

**Step 2: Create the new module with types only**

Create `src/settings/rulesets/diff-algorithm.ts`:

```typescript
// src/settings/rulesets/diff-algorithm.ts

// =============================================================================
// Types
// =============================================================================

export type DiffAction = "add" | "change" | "remove";

export interface PropertyDiff {
  path: string[];
  action: DiffAction;
  oldValue?: unknown;
  newValue?: unknown;
}
```

**Step 3: Verify file compiles**

Run: `npx tsc --noEmit src/settings/rulesets/diff-algorithm.ts`
Expected: No errors

**Step 4: Commit**

```bash
git add src/settings/rulesets/diff-algorithm.ts
git commit -m "refactor(settings): create diff-algorithm module with types

Part of #440 - Phase 5 of SOLID refactoring"
```

---

## Task 2: Extract helper functions

**Files:**

- Modify: `src/settings/rulesets/diff-algorithm.ts`

**Step 1: Add isObject helper**

Add to `src/settings/rulesets/diff-algorithm.ts`:

```typescript
// =============================================================================
// Helpers
// =============================================================================

export function isObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}
```

**Step 2: Add deepEqual function**

Add to `src/settings/rulesets/diff-algorithm.ts`:

```typescript
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined)
    return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (isObject(a) && isObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }

  return false;
}
```

**Step 3: Add isArrayOfObjects helper**

Add to `src/settings/rulesets/diff-algorithm.ts`:

```typescript
export function isArrayOfObjects(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every((item) => isObject(item));
}
```

**Step 4: Verify file compiles**

Run: `npx tsc --noEmit src/settings/rulesets/diff-algorithm.ts`
Expected: No errors

**Step 5: Commit**

```bash
git add src/settings/rulesets/diff-algorithm.ts
git commit -m "refactor(settings): add helper functions to diff-algorithm

- isObject: type guard for plain objects
- deepEqual: recursive deep equality comparison
- isArrayOfObjects: check if array contains only objects

Part of #440"
```

---

## Task 3: Extract diffObjectArrays function

**Files:**

- Modify: `src/settings/rulesets/diff-algorithm.ts`

**Step 1: Add diffObjectArrays function**

Add to `src/settings/rulesets/diff-algorithm.ts` (before the helpers section, since it needs forward reference to computePropertyDiffs):

```typescript
// =============================================================================
// Array Diffing
// =============================================================================

/**
 * Diff two arrays of objects by matching items on `type` field (or by index).
 */
export function diffObjectArrays(
  currentArr: unknown[],
  desiredArr: unknown[],
  parentPath: string[]
): PropertyDiff[] {
  const diffs: PropertyDiff[] = [];

  const hasType = desiredArr.every(
    (item) => isObject(item) && "type" in (item as Record<string, unknown>)
  );

  if (hasType) {
    // Match by type field
    const currentByType = new Map<
      string,
      { item: Record<string, unknown>; index: number }
    >();
    for (let i = 0; i < currentArr.length; i++) {
      const item = currentArr[i] as Record<string, unknown>;
      const type = item.type as string;
      if (type) currentByType.set(type, { item, index: i });
    }

    const matchedTypes = new Set<string>();

    for (let i = 0; i < desiredArr.length; i++) {
      const desiredItem = desiredArr[i] as Record<string, unknown>;
      const type = desiredItem.type as string;
      const label = `[${i}] (${type})`;
      const currentEntry = currentByType.get(type);

      if (currentEntry) {
        matchedTypes.add(type);
        // Recurse into matched pair
        const itemDiffs = computePropertyDiffs(currentEntry.item, desiredItem, [
          ...parentPath,
          label,
        ]);
        diffs.push(...itemDiffs);
      } else {
        // New item in desired
        diffs.push({
          path: [...parentPath, label],
          action: "add",
          newValue: desiredItem,
        });
      }
    }

    // Items in current but not in desired
    for (const [type, entry] of currentByType) {
      if (!matchedTypes.has(type)) {
        diffs.push({
          path: [...parentPath, `[${entry.index}] (${type})`],
          action: "remove",
          oldValue: entry.item,
        });
      }
    }
  } else {
    // Fallback: match by index
    const maxLen = Math.max(currentArr.length, desiredArr.length);
    for (let i = 0; i < maxLen; i++) {
      const label = `[${i}]`;
      if (i >= currentArr.length) {
        diffs.push({
          path: [...parentPath, label],
          action: "add",
          newValue: desiredArr[i],
        });
      } else if (i >= desiredArr.length) {
        diffs.push({
          path: [...parentPath, label],
          action: "remove",
          oldValue: currentArr[i],
        });
      } else if (isObject(currentArr[i]) && isObject(desiredArr[i])) {
        const itemDiffs = computePropertyDiffs(
          currentArr[i] as Record<string, unknown>,
          desiredArr[i] as Record<string, unknown>,
          [...parentPath, label]
        );
        diffs.push(...itemDiffs);
      } else if (!deepEqual(currentArr[i], desiredArr[i])) {
        diffs.push({
          path: [...parentPath, label],
          action: "change",
          oldValue: currentArr[i],
          newValue: desiredArr[i],
        });
      }
    }
  }

  return diffs;
}
```

**Note:** This function references `computePropertyDiffs` which we'll add next. The TypeScript compiler will error until we add it.

**Step 2: Commit (after Task 4 completes)**

We'll commit this together with Task 4.

---

## Task 4: Extract computePropertyDiffs function

**Files:**

- Modify: `src/settings/rulesets/diff-algorithm.ts`

**Step 1: Add computePropertyDiffs function**

Add to `src/settings/rulesets/diff-algorithm.ts` at the top (after types, before array diffing):

```typescript
// =============================================================================
// Property Diff Algorithm
// =============================================================================

/**
 * Recursively compute property-level diffs between two objects.
 */
export function computePropertyDiffs(
  current: Record<string, unknown>,
  desired: Record<string, unknown>,
  parentPath: string[] = []
): PropertyDiff[] {
  const diffs: PropertyDiff[] = [];
  const allKeys = new Set([...Object.keys(current), ...Object.keys(desired)]);

  for (const key of allKeys) {
    const path = [...parentPath, key];
    const currentVal = current[key];
    const desiredVal = desired[key];

    if (!(key in current)) {
      // Added property
      diffs.push({ path, action: "add", newValue: desiredVal });
    } else if (!(key in desired)) {
      // Removed property
      diffs.push({ path, action: "remove", oldValue: currentVal });
    } else if (!deepEqual(currentVal, desiredVal)) {
      // Changed property
      if (isObject(currentVal) && isObject(desiredVal)) {
        // Recurse into nested objects
        diffs.push(
          ...computePropertyDiffs(
            currentVal as Record<string, unknown>,
            desiredVal as Record<string, unknown>,
            path
          )
        );
      } else if (
        Array.isArray(currentVal) &&
        Array.isArray(desiredVal) &&
        isArrayOfObjects(currentVal) &&
        isArrayOfObjects(desiredVal)
      ) {
        // Recurse into arrays of objects
        diffs.push(...diffObjectArrays(currentVal, desiredVal, path));
      } else {
        diffs.push({
          path,
          action: "change",
          oldValue: currentVal,
          newValue: desiredVal,
        });
      }
    }
    // Unchanged properties are not included
  }

  return diffs;
}
```

**Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/settings/rulesets/diff-algorithm.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/settings/rulesets/diff-algorithm.ts
git commit -m "refactor(settings): add core diff algorithm functions

- computePropertyDiffs: main entry point for recursive diffing
- diffObjectArrays: array diffing by type field or index

Part of #440"
```

---

## Task 5: Create barrel export for settings/rulesets

**Files:**

- Create: `src/settings/rulesets/index.ts`

**Step 1: Create barrel export**

Create `src/settings/rulesets/index.ts`:

```typescript
// Diff algorithm - property-level diffing for ruleset comparisons
export {
  computePropertyDiffs,
  diffObjectArrays,
  deepEqual,
  isObject,
  isArrayOfObjects,
  type DiffAction,
  type PropertyDiff,
} from "./diff-algorithm.js";
```

**Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/settings/rulesets/index.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/settings/rulesets/index.ts
git commit -m "refactor(settings): add barrel export for rulesets module

Part of #440"
```

---

## Task 6: Write tests for the extracted diff-algorithm module

**Files:**

- Create: `test/unit/settings/rulesets/diff-algorithm.test.ts`

**Step 1: Create test directory**

Run: `mkdir -p test/unit/settings/rulesets`
Expected: Directory created

**Step 2: Create test file with existing tests adapted**

Create `test/unit/settings/rulesets/diff-algorithm.test.ts`:

```typescript
// test/unit/settings/rulesets/diff-algorithm.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  computePropertyDiffs,
  deepEqual,
  isObject,
  isArrayOfObjects,
  type PropertyDiff,
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
```

**Step 3: Run tests to verify they fail (module not yet imported)**

Run: `npm test -- --test-name-pattern="diff-algorithm"`
Expected: Tests may fail because we haven't updated ruleset-plan-formatter yet

**Step 4: Commit**

```bash
git add test/unit/settings/rulesets/diff-algorithm.test.ts
git commit -m "test(settings): add unit tests for diff-algorithm module

Tests cover:
- isObject type guard
- deepEqual recursive comparison
- isArrayOfObjects helper
- computePropertyDiffs for scalars, nested objects, and arrays

Part of #440"
```

---

## Task 7: Update ruleset-plan-formatter to import from diff-algorithm

**Files:**

- Modify: `src/ruleset-plan-formatter.ts:1-110`

**Step 1: Update imports at top of file**

Replace lines 1-23 of `src/ruleset-plan-formatter.ts` with:

```typescript
// src/ruleset-plan-formatter.ts
import chalk from "chalk";
import {
  projectToDesiredShape,
  normalizeRuleset,
  type RulesetChange,
  type RulesetAction,
} from "./ruleset-diff.js";
import type { Ruleset } from "./config.js";
import {
  computePropertyDiffs,
  isObject,
  type DiffAction,
  type PropertyDiff,
} from "./settings/rulesets/index.js";

// =============================================================================
// Types
// =============================================================================

export type { DiffAction, PropertyDiff } from "./settings/rulesets/index.js";

export interface RulesetPlanEntry {
  name: string;
  action: RulesetAction;
  propertyCount?: number;
  propertyChanges?: {
    added: number;
    changed: number;
    removed: number;
  };
}

export interface RulesetPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
  entries: RulesetPlanEntry[];
}
```

**Step 2: Remove the extracted code (lines 44-235)**

Delete these sections from `src/ruleset-plan-formatter.ts`:

- Lines 44-102: `computePropertyDiffs` function
- Lines 104-110: `isObject` function
- Lines 112-131: `deepEqual` function
- Lines 133-135: `isArrayOfObjects` function
- Lines 137-235: `diffObjectArrays` function

Keep lines 237+ (Tree Formatting section onwards).

**Step 3: Verify build passes**

Run: `npm run build`
Expected: No errors

**Step 4: Verify all tests pass**

Run: `npm test`
Expected: All 1,654+ tests pass

**Step 5: Commit**

```bash
git add src/ruleset-plan-formatter.ts
git commit -m "refactor(settings): import diff algorithm from extracted module

- Remove duplicated diff functions from ruleset-plan-formatter
- Import computePropertyDiffs, isObject, DiffAction, PropertyDiff from settings/rulesets
- Re-export types for backward compatibility

Part of #440"
```

---

## Task 8: Update test imports for ruleset-plan-formatter

**Files:**

- Modify: `test/unit/ruleset-plan-formatter.test.ts:1-15`

**Step 1: Update test imports**

The existing tests in `test/unit/ruleset-plan-formatter.test.ts` import `computePropertyDiffs` and `PropertyDiff` from the formatter. Since we're re-exporting these types, the tests should still work. Run them to verify:

Run: `npm test -- --test-name-pattern="computePropertyDiffs|formatPropertyTree|formatRulesetPlan"`
Expected: All tests pass

**Step 2: If tests pass, no changes needed**

The re-exports ensure backward compatibility.

**Step 3: Commit (if any changes were needed)**

```bash
git add test/unit/ruleset-plan-formatter.test.ts
git commit -m "test: update ruleset-plan-formatter test imports

Part of #440"
```

---

## Task 9: Verify line counts and final checks

**Files:**

- Verify: `src/ruleset-plan-formatter.ts`
- Verify: `src/settings/rulesets/diff-algorithm.ts`

**Step 1: Check line counts**

Run: `wc -l src/ruleset-plan-formatter.ts src/settings/rulesets/diff-algorithm.ts`
Expected:

- `ruleset-plan-formatter.ts` should be ~400 lines
- `diff-algorithm.ts` should be ~150 lines

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass (1,654+)

**Step 3: Run linter**

Run: `./lint.sh`
Expected: No errors

**Step 4: Verify exports are correct**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "refactor: complete phase 5 - split ruleset-plan-formatter

- Extracted diff algorithm to src/settings/rulesets/diff-algorithm.ts
- ruleset-plan-formatter.ts reduced from 622 to ~400 lines
- diff-algorithm.ts is ~150 lines with focused responsibility
- All tests pass
- Maintains backward compatibility via re-exports

Closes #440"
```

---

## Task 10: Create PR

**Step 1: Push branch**

Run: `git push -u origin refactor/phase-5-split-ruleset-plan-formatter`

**Step 2: Create PR**

Run:

```bash
gh pr create --title "refactor: Phase 5 - Split ruleset-plan-formatter.ts (621 lines)" --body "$(cat <<'EOF'
## Summary
- Extract diff algorithm to `src/settings/rulesets/diff-algorithm.ts` (~150 lines)
- Keep formatting logic in `ruleset-plan-formatter.ts` (~400 lines)
- Add dedicated tests for diff algorithm
- Maintain backward compatibility via re-exports

## Changes
- Create `src/settings/rulesets/diff-algorithm.ts` with:
  - `computePropertyDiffs()` - main entry point
  - `deepEqual()` - recursive comparison
  - `diffObjectArrays()` - array diffing by type or index
  - `isObject()`, `isArrayOfObjects()` - type guards
  - `DiffAction`, `PropertyDiff` types
- Create `src/settings/rulesets/index.ts` barrel export
- Update `ruleset-plan-formatter.ts` to import from new module
- Add `test/unit/settings/rulesets/diff-algorithm.test.ts`

## Acceptance Criteria
- [x] All tests pass
- [x] Diff algorithm independently testable
- [x] Each file < 450 lines
- [x] Clear separation between algorithm and presentation

Closes #440
Part of #435

## Test plan
- [ ] Run `npm test` - all 1,654+ tests pass
- [ ] Run `./lint.sh` - no errors
- [ ] Verify line counts with `wc -l`

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3: Enable automerge**

Run: `gh pr merge --auto --squash --delete-branch`

---

## File Structure After Refactoring

```
src/
├── settings/
│   └── rulesets/
│       ├── diff-algorithm.ts    # ~150 lines - diff algorithm
│       └── index.ts             # barrel export
├── ruleset-plan-formatter.ts    # ~400 lines - formatting only
└── ...

test/unit/
├── settings/
│   └── rulesets/
│       └── diff-algorithm.test.ts
├── ruleset-plan-formatter.test.ts
└── ...
```
