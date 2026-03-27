# `$arrayMerge` in Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support `$arrayMerge`/`$values` directives in settings overrides so array fields (bypassActors, rules, etc.) can be appended/prepended instead of replaced.

**Architecture:** The existing `deepMerge()` already handles `$arrayMerge`/`$values` directives generically. Settings merging already calls `deepMerge()` via `mergeRuleset()`. The work is: (1) update validation to accept the directive shape, (2) update JSON schema, (3) handle unresolved directives in output, (4) update docs, (5) add tests.

**Tech Stack:** TypeScript, Node.js test runner, JSON Schema Draft-07

**Execution order:** Tasks MUST be executed sequentially (1 → 2 → 3 → ... → 11). Later tasks depend on code and tests from earlier tasks. Tests in Task 2 rely on validation helpers added in Task 1. Tests in Tasks 5-6 rely on merge changes from Tasks 3-4.

---

## Tasks

### Task 1: Add `isArrayMergeDirective` helper to ruleset validator

**Files:**
- Modify: `src/config/validators/ruleset-validator.ts:1-2` (imports), add new function after line 79

- [ ] **Step 1: Write the failing test for `isArrayMergeDirective` export**

Add to `test/unit/config-validator.test.ts` at the end of the `settings.rulesets validation` describe block (after line ~1557):

```typescript
test("accepts $arrayMerge directive on bypassActors", () => {
  const config = createValidConfig({
    settings: {
      rulesets: {
        "main-protection": {
          target: "branch",
          bypassActors: {
            $arrayMerge: "append",
            $values: [
              { actorId: 123, actorType: "Integration", bypassMode: "always" },
            ],
          } as never,
        },
      },
    },
  });

  assert.doesNotThrow(() => validateRawConfig(config));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --test-name-pattern "accepts \\$arrayMerge directive on bypassActors" test/unit/config-validator.test.ts`
Expected: FAIL with `bypassActors must be an array`

- [ ] **Step 3: Add `isArrayMergeDirective` helper and update `bypassActors` validation**

In `src/config/validators/ruleset-validator.ts`, add import and helper after line 1:

```typescript
import { isPlainObject } from "../../shared/type-guards.js";
```

Add after line 79 (after `VALID_RULE_TYPES`):

```typescript
// Intentionally duplicated from merge.ts — validator should not depend on merge internals
const VALID_MERGE_STRATEGIES = ["replace", "append", "prepend"];

/**
 * Checks if a value is an $arrayMerge directive: { $arrayMerge: strategy, $values: [...] }
 */
export function isArrayMergeDirective(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    "$arrayMerge" in value &&
    "$values" in value &&
    VALID_MERGE_STRATEGIES.includes(value.$arrayMerge as string) &&
    Array.isArray(value.$values)
  );
}

/**
 * Extracts the $values array from a directive, or returns the value as-is if it's already an array.
 * Returns null if value is neither an array nor a valid directive.
 */
function extractArrayOrDirectiveValues(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (isArrayMergeDirective(value)) return (value as Record<string, unknown>).$values as unknown[];
  return null;
}
```

Update `bypassActors` validation (replace lines 241-272):

```typescript
  // Validate bypassActors
  if (rs.bypassActors !== undefined) {
    const actors = extractArrayOrDirectiveValues(rs.bypassActors);
    if (actors === null) {
      throw new ValidationError(
        `${context}: ruleset '${name}' bypassActors must be an array or $arrayMerge directive`
      );
    }
    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i] as Record<string, unknown>;
      if (typeof actor !== "object" || actor === null) {
        throw new ValidationError(
          `${context}: ruleset '${name}' bypassActors[${i}] must be an object`
        );
      }
      if (typeof actor.actorId !== "number") {
        throw new ValidationError(
          `${context}: ruleset '${name}' bypassActors[${i}].actorId must be a number`
        );
      }
      if (!VALID_ACTOR_TYPES.includes(actor.actorType as string)) {
        throw new ValidationError(
          `${context}: ruleset '${name}' bypassActors[${i}].actorType must be one of: ${VALID_ACTOR_TYPES.join(", ")}`
        );
      }
      if (
        actor.bypassMode !== undefined &&
        !VALID_BYPASS_MODES.includes(actor.bypassMode as string)
      ) {
        throw new ValidationError(
          `${context}: ruleset '${name}' bypassActors[${i}].bypassMode must be one of: ${VALID_BYPASS_MODES.join(", ")}`
        );
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --test-name-pattern "accepts \\$arrayMerge directive on bypassActors" test/unit/config-validator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/validators/ruleset-validator.ts test/unit/config-validator.test.ts
git commit -m "feat: accept $arrayMerge directive on bypassActors validation

Closes #615"
```

---

### Task 2: Update `rules` and `conditions` validation for directive support

**Files:**
- Modify: `src/config/validators/ruleset-validator.ts:320-329` (rules), `298-316` (conditions)
- Test: `test/unit/config-validator.test.ts`

- [ ] **Step 1: Write failing tests for rules and conditions directives**

Add to `test/unit/config-validator.test.ts` after the test from Task 1:

```typescript
test("accepts $arrayMerge directive on rules array", () => {
  const config = createValidConfig({
    settings: {
      rulesets: {
        "main-protection": {
          target: "branch",
          rules: {
            $arrayMerge: "append",
            $values: [{ type: "required_signatures" }],
          } as never,
        },
      },
    },
  });

  assert.doesNotThrow(() => validateRawConfig(config));
});

test("accepts $arrayMerge directive on conditions.refName.include", () => {
  const config = createValidConfig({
    settings: {
      rulesets: {
        "main-protection": {
          target: "branch",
          conditions: {
            refName: {
              include: {
                $arrayMerge: "append",
                $values: ["refs/heads/develop"],
              } as never,
            },
          },
        },
      },
    },
  });

  assert.doesNotThrow(() => validateRawConfig(config));
});

test("accepts $arrayMerge directive on conditions.refName.exclude", () => {
  const config = createValidConfig({
    settings: {
      rulesets: {
        "main-protection": {
          target: "branch",
          conditions: {
            refName: {
              exclude: {
                $arrayMerge: "prepend",
                $values: ["refs/heads/temp/*"],
              } as never,
            },
          },
        },
      },
    },
  });

  assert.doesNotThrow(() => validateRawConfig(config));
});

test("rejects invalid $arrayMerge strategy in bypassActors", () => {
  const config = createValidConfig({
    settings: {
      rulesets: {
        "main-protection": {
          target: "branch",
          bypassActors: {
            $arrayMerge: "invalid",
            $values: [{ actorId: 1, actorType: "User" }],
          } as never,
        },
      },
    },
  });

  assert.throws(
    () => validateRawConfig(config),
    /bypassActors must be an array or \$arrayMerge directive/
  );
});

test("rejects $arrayMerge directive with invalid $values items in bypassActors", () => {
  const config = createValidConfig({
    settings: {
      rulesets: {
        "main-protection": {
          target: "branch",
          bypassActors: {
            $arrayMerge: "append",
            $values: [{ actorId: "not-a-number", actorType: "User" }],
          } as never,
        },
      },
    },
  });

  assert.throws(
    () => validateRawConfig(config),
    /actorId must be a number/
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test --test-name-pattern "accepts \\$arrayMerge directive on rules|accepts \\$arrayMerge directive on conditions|rejects invalid \\$arrayMerge|rejects \\$arrayMerge directive with invalid" test/unit/config-validator.test.ts`
Expected: `rules` and `conditions` tests FAIL; `rejects invalid` test PASS (already handled by Task 1); `rejects with invalid $values` PASS (already handled by Task 1)

- [ ] **Step 3: Update `rules` validation (lines 320-329)**

Replace the `rules` validation block in `src/config/validators/ruleset-validator.ts`:

```typescript
  // Validate rules array
  if (rs.rules !== undefined) {
    const rules = extractArrayOrDirectiveValues(rs.rules);
    if (rules === null) {
      throw new ValidationError(
        `${context}: ruleset '${name}' rules must be an array or $arrayMerge directive`
      );
    }
    for (let i = 0; i < rules.length; i++) {
      validateRule(rules[i], `${context}: ruleset '${name}' rules[${i}]`);
    }
  }
```

- [ ] **Step 4: Update `conditions.refName.include/exclude` validation (lines 298-316)**

Replace the `refName` include/exclude checks:

```typescript
      if (refName.include !== undefined) {
        const include = extractArrayOrDirectiveValues(refName.include);
        if (
          include === null ||
          !include.every((s) => typeof s === "string")
        ) {
          throw new ValidationError(
            `${context}: ruleset '${name}' conditions.refName.include must be an array of strings or $arrayMerge directive with string $values`
          );
        }
      }
      if (refName.exclude !== undefined) {
        const exclude = extractArrayOrDirectiveValues(refName.exclude);
        if (
          exclude === null ||
          !exclude.every((s) => typeof s === "string")
        ) {
          throw new ValidationError(
            `${context}: ruleset '${name}' conditions.refName.exclude must be an array of strings or $arrayMerge directive with string $values`
          );
        }
      }
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `node --import tsx --test test/unit/config-validator.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/config/validators/ruleset-validator.ts test/unit/config-validator.test.ts
git commit -m "feat: accept $arrayMerge directive on rules and conditions validation"
```

---

### Task 3: Enhance `deepMerge` and `stripMergeDirectives` for unresolved directives

**Files:**
- Modify: `src/config/merge.ts:50-101` (deepMerge), `108-129` (stripMergeDirectives)
- Test: `test/unit/merge.test.ts`

- [ ] **Step 1: Write failing tests for stacked directives and unresolved directive resolution**

Add to `test/unit/merge.test.ts` in the `deepMerge` describe block:

```typescript
test("resolves base directive before applying overlay directive (stacked directives)", () => {
  // Simulates two group layers both using $arrayMerge with no original base array.
  // First merge: no base → directive passes through as overlay-wins.
  // Second merge: base is unresolved directive, overlay is another directive.
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
```

Add to `test/unit/merge.test.ts` in the `stripMergeDirectives` describe block:

```typescript
test("resolves unmerged $arrayMerge directive to its $values array", () => {
  const obj = {
    name: "test",
    items: { $arrayMerge: "append", $values: [1, 2, 3] },
  };
  const result = stripMergeDirectives(obj);
  assert.deepEqual(result, { name: "test", items: [1, 2, 3] });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test --test-name-pattern "resolves base directive|resolves unmerged|resolves nested unmerged" test/unit/merge.test.ts`
Expected: FAIL — `deepMerge` recurses into both directive objects and loses the values; `stripMergeDirectives` strips keys leaving empty object

- [ ] **Step 3: Add helper to detect unresolved directive objects**

In `src/config/merge.ts`, add after the `XFG_DIRECTIVES` constant (after line 13):

```typescript
/**
 * Checks if a value is an unresolved $arrayMerge directive object
 * (only contains $arrayMerge + $values keys, with a valid strategy and array values).
 */
function isUnresolvedDirective(
  value: unknown
): value is Record<string, unknown> & { $values: unknown[] } {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.every((k) => XFG_DIRECTIVES.has(k)) &&
    typeof value.$arrayMerge === "string" &&
    arrayMergeStrategies.has(value.$arrayMerge as ArrayMergeStrategy) &&
    Array.isArray(value.$values)
  );
}
```

- [ ] **Step 4: Update `deepMerge` to resolve base directives**

In `src/config/merge.ts`, in the `deepMerge` function, add handling after `const baseValue = base[key];` (line 61) and before the existing directive check (line 64):

```typescript
    // If base is an unresolved directive (from a previous layer with no base array),
    // resolve it to its $values array before proceeding with merge logic.
    const resolvedBase = isUnresolvedDirective(baseValue)
      ? baseValue.$values
      : baseValue;
```

Then replace the entire loop body (lines 57-98) with the following.
The only change is adding the `resolvedBase` variable and using it
in place of `baseValue` on four lines:
the `Array.isArray(resolvedBase)` check inside the directive block,
the `Array.isArray(resolvedBase)` check in the array-array block,
the `isPlainObject(resolvedBase)` check,
and the `deepMerge(resolvedBase, ...)` call:

```typescript
  for (const [key, overlayValue] of Object.entries(overlay)) {
    // Skip directive keys in output
    if (XFG_DIRECTIVES.has(key)) continue;

    const baseValue = base[key];

    // If base is an unresolved directive (from a previous layer with no base array),
    // resolve it to its $values array before proceeding with merge logic.
    const resolvedBase = isUnresolvedDirective(baseValue)
      ? baseValue.$values
      : baseValue;

    // Per-field $arrayMerge + $values directive
    if (isPlainObject(overlayValue) && "$arrayMerge" in overlayValue) {
      const strategy = overlayValue.$arrayMerge;
      const values = overlayValue.$values;

      if (
        (strategy === "replace" ||
          strategy === "append" ||
          strategy === "prepend") &&
        Array.isArray(values) &&
        Array.isArray(resolvedBase)
      ) {
        result[key] = mergeArrays(resolvedBase, values, strategy);
        continue;
      }
    }

    // Both are arrays — use default strategy
    if (Array.isArray(resolvedBase) && Array.isArray(overlayValue)) {
      result[key] = mergeArrays(
        resolvedBase,
        overlayValue,
        ctx.defaultArrayStrategy
      );
      continue;
    }

    // Both are plain objects — recurse
    if (isPlainObject(resolvedBase) && isPlainObject(overlayValue)) {
      result[key] = deepMerge(resolvedBase, overlayValue, ctx);
      continue;
    }

    // Otherwise, overlay wins (including null values)
    result[key] = overlayValue;
  }
```

- [ ] **Step 5: Update `stripMergeDirectives` to resolve directive objects**

In `src/config/merge.ts`, replace the `stripMergeDirectives` function (lines 108-129):

```typescript
/**
 * Strip xfg merge directive keys ($arrayMerge, $values) from an object.
 * Works recursively on nested objects and arrays.
 * Standard $-prefixed keys ($schema, $id, $ref, etc.) are preserved.
 *
 * When an unresolved directive object is found (only contains $arrayMerge + $values),
 * it is replaced with the $values array. This handles the case where a directive
 * had no base array to merge with.
 */
export function stripMergeDirectives(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip xfg directive keys only
    if (XFG_DIRECTIVES.has(key)) continue;

    if (isPlainObject(value)) {
      if (isUnresolvedDirective(value)) {
        // Resolve to the $values array, stripping directives from items
        result[key] = value.$values.map((item) =>
          isPlainObject(item) ? stripMergeDirectives(item) : item
        );
      } else {
        result[key] = stripMergeDirectives(value);
      }
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        isPlainObject(item) ? stripMergeDirectives(item) : item
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --import tsx --test test/unit/merge.test.ts`
Expected: All tests PASS (new and existing)

- [ ] **Step 7: Commit**

```bash
git add src/config/merge.ts test/unit/merge.test.ts
git commit -m "feat: handle stacked and unresolved $arrayMerge directives in deepMerge and stripMergeDirectives"
```

---

### Task 4: Call `stripMergeDirectives` on final settings output in `mergeSettings`

**Files:**
- Modify: `src/config/normalizer.ts:223-298` (mergeSettings), imports
- Test: `test/unit/config-normalizer.test.ts`

**Why not in `mergeRuleset`:** `mergeRuleset` is called by both `mergeSettings` (final output) and `mergeRawSettings` (group chain accumulation). Stripping in `mergeRuleset` would prematurely resolve directives during group chain merging. Instead, strip at the final consumer — `mergeSettings` — which produces the output used by the rest of the system.

- [ ] **Step 1: Write failing test for directive with no base array**

The "has base" case (directive merging with an existing array) already works via `deepMerge()`. The failing case is when a per-repo directive has no corresponding root array — the directive object leaks through unresolved. This is the red test for Task 4.

Add to `test/unit/config-normalizer.test.ts` inside the `settings merging` describe block (after line ~1707):

```typescript
// $arrayMerge: directive with no base resolves to $values
// (uses `as never` because TypeScript types don't include directive shape yet)
test("$arrayMerge directive with no base resolves to $values", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            "pr-rules": {
              target: "branch",
              bypassActors: {
                $arrayMerge: "append",
                $values: [
                  {
                    actorId: 9999,
                    actorType: "Integration",
                    bypassMode: "always",
                  },
                ],
              } as never,
            },
          },
        },
      },
    ],
  };

  const result = normalizeConfig(raw, process.env);
  const actors =
    result.repos[0].settings?.rulesets?.["pr-rules"]?.bypassActors;
  assert.equal(actors?.length, 1);
  assert.equal(actors?.[0]?.actorId, 9999);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --test-name-pattern "\\$arrayMerge directive with no base resolves" test/unit/config-normalizer.test.ts`
Expected: FAIL — without `stripMergeDirectives`, the directive object passes through as-is instead of resolving to the `$values` array.

- [ ] **Step 3: Add `stripMergeDirectives` call in `mergeSettings`**

In `src/config/normalizer.ts`, add import for `stripMergeDirectives` (update existing import from `merge.ts`):

```typescript
import {
  createMergeContext,
  deepMerge,
  stripMergeDirectives,
  // ... other existing imports
} from "./merge.js";
```

In `mergeSettings()` (around line 258), wrap the `mergeRuleset` result with `stripMergeDirectives` for each ruleset:

```typescript
      const merged = mergeRuleset(
        rootRuleset as Ruleset | undefined,
        repoRuleset as Ruleset | undefined
      );
      result.rulesets[name] = stripMergeDirectives(
        merged as Record<string, unknown>
      ) as Ruleset;
```

Note: The `as Record<string, unknown>` cast is needed because `Ruleset` has typed properties that don't match `stripMergeDirectives`'s parameter signature exactly. The `as Ruleset` on the return is needed because `stripMergeDirectives` returns `Record<string, unknown>`.

Also handle the root-only normalizeConfig path (around line 691) where `mergeSettings(raw.settings, undefined)` is called for repos with no per-repo settings — this path won't have directives since root settings use plain arrays, so no change needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --test-name-pattern "\\$arrayMerge directive with no base resolves" test/unit/config-normalizer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/normalizer.ts test/unit/config-normalizer.test.ts
git commit -m "feat: strip/resolve merge directives in mergeSettings output"
```

---

### Task 5: Add comprehensive settings merge tests

**Files:**
- Test: `test/unit/config-normalizer.test.ts`

- [ ] **Step 1: Write tests for all merge scenarios**

Add to the `settings merging` describe block in `test/unit/config-normalizer.test.ts`:

```typescript
test("$arrayMerge: prepend on rules prepends per-repo to root", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            "pr-rules": {
              rules: {
                $arrayMerge: "prepend",
                $values: [{ type: "required_signatures" }],
              } as never,
            },
          },
        },
      },
    ],
    settings: {
      rulesets: {
        "pr-rules": {
          target: "branch",
          rules: [
            {
              type: "pull_request",
              parameters: { requiredApprovingReviewCount: 1 },
            },
          ],
        },
      },
    },
  };

  const result = normalizeConfig(raw, process.env);
  const rules = result.repos[0].settings?.rulesets?.["pr-rules"]?.rules;
  assert.equal(rules?.length, 2);
  assert.equal(rules?.[0]?.type, "required_signatures");
  assert.equal(rules?.[1]?.type, "pull_request");
});

test("$arrayMerge: append on conditions.refName.include", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            "pr-rules": {
              conditions: {
                refName: {
                  include: {
                    $arrayMerge: "append",
                    $values: ["refs/heads/develop"],
                  } as never,
                },
              },
            },
          },
        },
      },
    ],
    settings: {
      rulesets: {
        "pr-rules": {
          target: "branch",
          conditions: {
            refName: {
              include: ["refs/heads/main"],
              exclude: [],
            },
          },
        },
      },
    },
  };

  const result = normalizeConfig(raw, process.env);
  const include =
    result.repos[0].settings?.rulesets?.["pr-rules"]?.conditions?.refName
      ?.include;
  assert.deepEqual(include, ["refs/heads/main", "refs/heads/develop"]);
});

test("$arrayMerge: append on bypassActors appends per-repo to root", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            "pr-rules": {
              bypassActors: {
                $arrayMerge: "append",
                $values: [
                  {
                    actorId: 9999,
                    actorType: "Integration",
                    bypassMode: "always",
                  },
                ],
              } as never,
            },
          },
        },
      },
    ],
    settings: {
      rulesets: {
        "pr-rules": {
          target: "branch",
          bypassActors: [
            {
              actorId: 2740,
              actorType: "Integration",
              bypassMode: "always",
            },
          ],
        },
      },
    },
  };

  const result = normalizeConfig(raw, process.env);
  const actors =
    result.repos[0].settings?.rulesets?.["pr-rules"]?.bypassActors;
  assert.equal(actors?.length, 2);
  assert.equal(actors?.[0]?.actorId, 2740);
  assert.equal(actors?.[1]?.actorId, 9999);
});

test("$arrayMerge: replace behaves same as default array replacement", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            "pr-rules": {
              rules: {
                $arrayMerge: "replace",
                $values: [{ type: "required_signatures" }],
              } as never,
            },
          },
        },
      },
    ],
    settings: {
      rulesets: {
        "pr-rules": {
          target: "branch",
          rules: [
            {
              type: "pull_request",
              parameters: { requiredApprovingReviewCount: 1 },
            },
          ],
        },
      },
    },
  };

  const result = normalizeConfig(raw, process.env);
  const rules = result.repos[0].settings?.rulesets?.["pr-rules"]?.rules;
  assert.equal(rules?.length, 1);
  assert.equal(rules?.[0]?.type, "required_signatures");
});

test("different $arrayMerge strategies on sibling arrays in same ruleset", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            "pr-rules": {
              bypassActors: {
                $arrayMerge: "append",
                $values: [
                  { actorId: 9999, actorType: "Integration", bypassMode: "always" },
                ],
              } as never,
              rules: {
                $arrayMerge: "prepend",
                $values: [{ type: "required_signatures" }],
              } as never,
            },
          },
        },
      },
    ],
    settings: {
      rulesets: {
        "pr-rules": {
          target: "branch",
          bypassActors: [
            { actorId: 2740, actorType: "Integration", bypassMode: "always" },
          ],
          rules: [
            {
              type: "pull_request",
              parameters: { requiredApprovingReviewCount: 1 },
            },
          ],
        },
      },
    },
  };

  const result = normalizeConfig(raw, process.env);
  const actors =
    result.repos[0].settings?.rulesets?.["pr-rules"]?.bypassActors;
  const rules = result.repos[0].settings?.rulesets?.["pr-rules"]?.rules;
  // bypassActors: append
  assert.equal(actors?.length, 2);
  assert.equal(actors?.[0]?.actorId, 2740);
  assert.equal(actors?.[1]?.actorId, 9999);
  // rules: prepend
  assert.equal(rules?.length, 2);
  assert.equal(rules?.[0]?.type, "required_signatures");
  assert.equal(rules?.[1]?.type, "pull_request");
});
```

- [ ] **Step 2: Run tests to verify they all pass**

Run: `node --import tsx --test --test-name-pattern "\\$arrayMerge" test/unit/config-normalizer.test.ts`
Expected: All PASS (the merge logic + directive stripping from Tasks 3-4 handles these)

- [ ] **Step 3: Commit**

```bash
git add test/unit/config-normalizer.test.ts
git commit -m "test: comprehensive $arrayMerge settings merge tests"
```

---

### Task 6: Add group and conditional group merge tests

**Files:**
- Test: `test/unit/config-normalizer.test.ts`

- [ ] **Step 1: Write test for directive in group settings**

Add to the group settings test area in `test/unit/config-normalizer.test.ts` (near the existing group settings tests around line ~2909):

```typescript
test("$arrayMerge directive in group settings merges with root", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    groups: {
      "extra-bypass": {
        settings: {
          rulesets: {
            "pr-rules": {
              bypassActors: {
                $arrayMerge: "append",
                $values: [
                  { actorId: 5555, actorType: "Team", bypassMode: "always" },
                ],
              } as never,
            },
          },
        },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["extra-bypass"],
      },
    ],
    settings: {
      rulesets: {
        "pr-rules": {
          target: "branch",
          bypassActors: [
            { actorId: 2740, actorType: "Integration", bypassMode: "always" },
          ],
        },
      },
    },
  };

  const result = normalizeConfig(raw, process.env);
  const actors =
    result.repos[0].settings?.rulesets?.["pr-rules"]?.bypassActors;
  assert.equal(actors?.length, 2);
  assert.equal(actors?.[0]?.actorId, 2740);
  assert.equal(actors?.[1]?.actorId, 5555);
});

test("$arrayMerge directive in conditional group settings merges with root", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    groups: {
      "github-ci": {},
    },
    conditionalGroups: [
      {
        when: { allOf: ["github-ci"] },
        settings: {
          rulesets: {
            "pr-rules": {
              rules: {
                $arrayMerge: "append",
                $values: [
                  {
                    type: "required_status_checks",
                    parameters: {
                      requiredStatusChecks: [
                        { context: "summary / Check Results" },
                      ],
                    },
                  },
                ],
              } as never,
            },
          },
        },
      },
    ],
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["github-ci"],
      },
    ],
    settings: {
      rulesets: {
        "pr-rules": {
          target: "branch",
          rules: [
            {
              type: "pull_request",
              parameters: { requiredApprovingReviewCount: 1 },
            },
          ],
        },
      },
    },
  };

  const result = normalizeConfig(raw, process.env);
  const rules = result.repos[0].settings?.rulesets?.["pr-rules"]?.rules;
  assert.equal(rules?.length, 2);
  assert.equal(rules?.[0]?.type, "pull_request");
  assert.equal(rules?.[1]?.type, "required_status_checks");
});
```

```typescript
test("stacked $arrayMerge directives across two groups with no root base array", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    groups: {
      "group-a": {
        settings: {
          rulesets: {
            "pr-rules": {
              bypassActors: {
                $arrayMerge: "append",
                $values: [
                  { actorId: 1111, actorType: "Integration", bypassMode: "always" },
                ],
              } as never,
            },
          },
        },
      },
      "group-b": {
        settings: {
          rulesets: {
            "pr-rules": {
              bypassActors: {
                $arrayMerge: "append",
                $values: [
                  { actorId: 2222, actorType: "Team", bypassMode: "always" },
                ],
              } as never,
            },
          },
        },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["group-a", "group-b"],
      },
    ],
    settings: {
      rulesets: {
        "pr-rules": {
          target: "branch",
        },
      },
    },
  };

  const result = normalizeConfig(raw, process.env);
  const actors =
    result.repos[0].settings?.rulesets?.["pr-rules"]?.bypassActors;
  // group-a's directive resolves to [1111], group-b appends [2222]
  assert.equal(actors?.length, 2);
  assert.equal(actors?.[0]?.actorId, 1111);
  assert.equal(actors?.[1]?.actorId, 2222);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --import tsx --test --test-name-pattern "\\$arrayMerge directive in group|\\$arrayMerge directive in conditional|stacked \\$arrayMerge" test/unit/config-normalizer.test.ts`
Expected: All PASS (group merging uses `mergeRuleset` → `deepMerge` which now resolves base directives)

- [ ] **Step 3: Commit**

```bash
git add test/unit/config-normalizer.test.ts
git commit -m "test: $arrayMerge directive in group and conditional group settings"
```

---

### Task 7: Update JSON Schema

**Files:**
- Modify: `config-schema.json`

- [ ] **Step 1: Add `arrayMergeDirective` definitions**

In `config-schema.json`, add three new definitions in the `definitions` section. Add them before the `"ruleset"` definition (before line 772):

```json
"arrayMergeDirective": {
  "type": "object",
  "description": "Merge directive for arrays. Instead of replacing the base array, append or prepend values to the inherited array.",
  "required": ["$arrayMerge", "$values"],
  "properties": {
    "$arrayMerge": {
      "type": "string",
      "enum": ["replace", "append", "prepend"],
      "description": "How to merge with the base array: 'append' adds after, 'prepend' adds before, 'replace' replaces entirely"
    },
    "$values": {
      "type": "array",
      "description": "Values to merge with the base array"
    }
  },
  "additionalProperties": false
},
"bypassActorsArrayMergeDirective": {
  "type": "object",
  "description": "Merge directive for bypassActors array",
  "required": ["$arrayMerge", "$values"],
  "properties": {
    "$arrayMerge": {
      "type": "string",
      "enum": ["replace", "append", "prepend"],
      "description": "How to merge with the base array"
    },
    "$values": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/bypassActor"
      },
      "description": "Bypass actor values to merge"
    }
  },
  "additionalProperties": false
},
"rulesArrayMergeDirective": {
  "type": "object",
  "description": "Merge directive for rules array",
  "required": ["$arrayMerge", "$values"],
  "properties": {
    "$arrayMerge": {
      "type": "string",
      "enum": ["replace", "append", "prepend"],
      "description": "How to merge with the base array"
    },
    "$values": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/rulesetRule"
      },
      "description": "Rule values to merge"
    }
  },
  "additionalProperties": false
},
```

- [ ] **Step 2: Update `bypassActors` field in `ruleset` definition**

Replace the `bypassActors` property in the `ruleset` definition (lines 795-800):

From:
```json
"bypassActors": {
  "type": "array",
  "description": "Actors who can bypass this ruleset",
  "items": {
    "$ref": "#/definitions/bypassActor"
  }
}
```

To:
```json
"bypassActors": {
  "oneOf": [
    {
      "type": "array",
      "description": "Actors who can bypass this ruleset",
      "items": {
        "$ref": "#/definitions/bypassActor"
      }
    },
    {
      "$ref": "#/definitions/bypassActorsArrayMergeDirective"
    }
  ]
}
```

- [ ] **Step 3: Update `rules` field in `ruleset` definition**

Replace the `rules` property in the `ruleset` definition (lines 806-811):

From:
```json
"rules": {
  "type": "array",
  "description": "Rules to enforce on matching refs",
  "items": {
    "$ref": "#/definitions/rulesetRule"
  }
}
```

To:
```json
"rules": {
  "oneOf": [
    {
      "type": "array",
      "description": "Rules to enforce on matching refs",
      "items": {
        "$ref": "#/definitions/rulesetRule"
      }
    },
    {
      "$ref": "#/definitions/rulesArrayMergeDirective"
    }
  ]
}
```

- [ ] **Step 4: Update `conditions.refName.include` and `exclude` fields**

Replace the `include` and `exclude` in `rulesetConditions` definition (lines 854-867):

From:
```json
"include": {
  "type": "array",
  "items": {
    "type": "string"
  },
  "description": "Patterns to include (e.g., 'refs/heads/main', 'refs/heads/release/*')"
},
"exclude": {
  "type": "array",
  "items": {
    "type": "string"
  },
  "description": "Patterns to exclude from this ruleset"
}
```

To:
```json
"include": {
  "oneOf": [
    {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Patterns to include (e.g., 'refs/heads/main', 'refs/heads/release/*')"
    },
    {
      "$ref": "#/definitions/arrayMergeDirective"
    }
  ]
},
"exclude": {
  "oneOf": [
    {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Patterns to exclude from this ruleset"
    },
    {
      "$ref": "#/definitions/arrayMergeDirective"
    }
  ]
}
```

- [ ] **Step 5: Validate the JSON schema is still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('config-schema.json', 'utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 6: Commit**

```bash
git add config-schema.json
git commit -m "feat: add $arrayMerge directive support to JSON schema for settings arrays"
```

---

### Task 8: Update merge-strategies documentation

**Files:**
- Modify: `docs/configuration/merge-strategies.md`

- [ ] **Step 1: Add "Settings Array Merge" section**

Add the following after the "Text File Merge Strategies" section (after line 146) in `docs/configuration/merge-strategies.md`:

````markdown
## Settings Array Merge

The `$arrayMerge` directive also works in settings overrides — rulesets, bypass actors, rules, conditions, and any other array field. This eliminates duplicating shared entries when a repo needs to add its own items.

### Appending Bypass Actors

```yaml
# Root — shared across all repos
settings:
  rulesets:
    pr-rules:
      bypassActors:
        - actorId: 2740          # Renovate
          actorType: Integration
          bypassMode: always

repos:
  # Adds a repo-specific actor without duplicating Renovate
  - git: git@github.com:org/repo.git
    settings:
      rulesets:
        pr-rules:
          bypassActors:
            $arrayMerge: append
            $values:
              - actorId: 2719952   # repo-specific bot
                actorType: Integration
                bypassMode: always
```

Result: `bypassActors` contains both Renovate (actorId 2740) and the repo-specific bot (actorId 2719952).

### Appending Rules via Conditional Groups

```yaml
settings:
  rulesets:
    pr-rules:
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1

groups:
  github-ci: {}

conditionalGroups:
  - when:
      allOf: [github-ci]
    settings:
      rulesets:
        pr-rules:
          rules:
            $arrayMerge: append
            $values:
              - type: required_status_checks
                parameters:
                  requiredStatusChecks:
                    - context: "summary / Check Results"
```

Repos with the `github-ci` group get both the `pull_request` rule and the `required_status_checks` rule. Repos without `github-ci` only get the `pull_request` rule.

!!! note "Same syntax as file content"
    The `$arrayMerge` directive uses the same `$arrayMerge` + `$values` syntax in settings as in file content (see Inline Array Merge Directive above). Strategies: `append`, `prepend`, `replace`.
````

- [ ] **Step 2: Commit**

```bash
git add docs/configuration/merge-strategies.md
git commit -m "docs: add settings array merge section to merge strategies page"
```

---

### Task 9: Update rulesets documentation

**Files:**
- Modify: `docs/configuration/rulesets.md`

- [ ] **Step 1: Add "Appending to Arrays" subsection**

In `docs/configuration/rulesets.md`, add after the "Skipping All Inherited Rulesets" section (after line 342):

````markdown
### Appending to Arrays

By default, per-repo arrays (like `bypassActors` and `rules`) replace inherited arrays entirely. Use the `$arrayMerge` directive to append or prepend instead:

```yaml
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
      bypassActors:
        - actorId: 2740          # Renovate — shared
          actorType: Integration
          bypassMode: always
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1

repos:
  # Add a repo-specific bypass actor without losing Renovate
  - git: git@github.com:your-org/special-repo.git
    settings:
      rulesets:
        main-protection:
          bypassActors:
            $arrayMerge: append
            $values:
              - actorId: 123456
                actorType: Team
                bypassMode: pull_request
          rules:
            $arrayMerge: append
            $values:
              - type: required_status_checks
                parameters:
                  requiredStatusChecks:
                    - context: "ci/build"
```

Result for `special-repo`: `bypassActors` has both Renovate and the team; `rules` has both `pull_request` and `required_status_checks`.

Available strategies: `append` (add after), `prepend` (add before), `replace` (same as default). See [Merge Strategies](merge-strategies.md#settings-array-merge) for more details.
````

- [ ] **Step 2: Commit**

```bash
git add docs/configuration/rulesets.md
git commit -m "docs: add appending to arrays subsection in rulesets page"
```

---

### Task 10: Update inheritance documentation

**Files:**
- Modify: `docs/configuration/inheritance.md`

- [ ] **Step 1: Add note about `$arrayMerge` in settings**

In `docs/configuration/inheritance.md`, update the "How Deep Merge Works" section (after line 83):

```markdown
- **Settings arrays**: By default, overlay arrays replace base arrays in settings too (rulesets, bypass actors, rules, conditions). Use the [`$arrayMerge` directive](merge-strategies.md#settings-array-merge) to append or prepend instead — same syntax as file content.
```

- [ ] **Step 2: Commit**

```bash
git add docs/configuration/inheritance.md
git commit -m "docs: mention $arrayMerge support in settings on inheritance page"
```

---

### Task 11: Run full test suite and lint

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 2: Run type checking on test files**

Run: `npm run test:typecheck`
Expected: No type errors

- [ ] **Step 3: Run linter**

Run: `./lint.sh`
Expected: No lint errors

- [ ] **Step 4: Fix any issues found**

If any tests, type checks, or lint issues are found, fix them and re-run.

- [ ] **Step 5: Final commit if any fixes were needed**

Stage only the specific files that were changed, then commit:

```bash
git add <changed-files>
git commit -m "fix: address lint/type issues from $arrayMerge implementation"
```
