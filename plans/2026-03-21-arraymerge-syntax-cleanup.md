# $arrayMerge Syntax Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both the `values:` wrapped syntax and sibling `$arrayMerge` syntax with a single per-field `$arrayMerge` + `$values` directive syntax.

**Architecture:** The `deepMerge` function in `merge.ts` currently supports two `$arrayMerge` syntaxes: (1) wrapped — `{ $arrayMerge: "append", values: [...] }` per field, and (2) sibling — `$arrayMerge` as a sibling key applying to all child arrays. Both are removed and replaced with one syntax: `{ $arrayMerge: "append", $values: [...] }` per field. This eliminates the `values` key collision risk (not `$`-prefixed), removes the sibling syntax's side-effect mutation of `MergeContext.arrayStrategies`, and provides explicit per-array control. The `MergeContext.arrayStrategies` map becomes dead code and is removed. `stripMergeDirectives` already strips all `$`-prefixed keys, so `$values` is automatically cleaned.

**Tech Stack:** TypeScript, node:test

---

### Task 1: Update `deepMerge` and remove dead code in `merge.ts`

**Files:**

- Modify: `src/config/merge.ts`

- [ ] **Step 1: Write failing tests for new `$values` syntax**

Add tests in `test/unit/merge.test.ts` for the new syntax. These replace the old `values:` and sibling tests.

In the `deepMerge` describe block, replace these tests:

1. Replace `"appends arrays when $arrayMerge: append in overlay"` (line 71) — change `values:` to `$values:`
2. Replace `"prepends arrays when $arrayMerge: prepend"` (line 87) — change `values:` to `$values:`
3. Replace `"strips $arrayMerge directive from output"` (line 167) — change `values:` to `$values:`, also assert `$values` is stripped
4. Remove `"appends arrays when $arrayMerge: append with array syntax"` (line 78) — tested sibling via pre-set `ctx.arrayStrategies`, no longer applicable
5. Remove `"uses context arrayStrategies for path-specific merge"` (line 94) — tested `arrayStrategies` map, no longer applicable
6. Remove `"$arrayMerge in nested object sets strategy for child array"` (line 181) — tested sibling syntax in nested objects, no longer applicable
7. Add new test: `"different strategies for sibling arrays"` — verifies per-field control with `$arrayMerge` + `$values` on two sibling array fields
8. Add new test: `"$arrayMerge without $values is ignored"` — overlay object with `$arrayMerge` but no `$values` key falls through to normal merge
9. Add new test: `"$values is stripped from output"` — ensure `$values` doesn't leak

```typescript
// Test 1 replacement (line 71):
test("appends arrays with $arrayMerge + $values directive", () => {
  const base = { items: [1, 2] };
  const overlay = { items: { $arrayMerge: "append", $values: [3, 4] } };
  const result = deepMerge(base, overlay, createContext());
  assert.deepEqual(result, { items: [1, 2, 3, 4] });
});

// Test 2 replacement (line 87):
test("prepends arrays with $arrayMerge + $values directive", () => {
  const base = { items: [1, 2] };
  const overlay = { items: { $arrayMerge: "prepend", $values: [3, 4] } };
  const result = deepMerge(base, overlay, createContext());
  assert.deepEqual(result, { items: [3, 4, 1, 2] });
});

// Test 3 replacement (line 167):
test("strips $arrayMerge and $values directives from output", () => {
  const base = { items: [1, 2] };
  const overlay = { items: { $arrayMerge: "append", $values: [3] } };
  const result = deepMerge(base, overlay, createContext());
  assert.equal("$arrayMerge" in result, false);
  assert.equal("$values" in result, false);
});

// New test 7:
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

// New test 8:
test("$arrayMerge without $values falls through to normal merge", () => {
  const base = { items: [1, 2] };
  const overlay = { items: { $arrayMerge: "append", other: "key" } };
  const result = deepMerge(
    base,
    overlay as Record<string, unknown>,
    createContext()
  );
  // No $values, so the directive object replaces the base array (overlay wins)
  assert.deepEqual(result, { items: { other: "key" } });
});

// New test 9:
test("$values is stripped from output after merge", () => {
  const base = { items: [1] };
  const overlay = { items: { $arrayMerge: "append", $values: [2] } };
  const result = deepMerge(base, overlay, createContext());
  const jsonStr = JSON.stringify(result);
  assert.ok(!jsonStr.includes("$values"));
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npm test -- --test-name-pattern "appends arrays with|prepends arrays with|strips \\\$arrayMerge and|different strategies|without \\\$values|is stripped from" 2>&1 | tail -20`

Expected: New tests fail (old syntax tests that were replaced no longer exist, new ones reference `$values` which isn't implemented yet).

- [ ] **Step 3: Update `merge.ts` implementation**

In `src/config/merge.ts`:

1. **Delete `extractArrayFromOverlay` function** (lines 47-66 — entire function)

2. **Delete `getStrategyFromOverlay` function** (lines 68-83 — entire function). Replace with a simpler inline check.

3. **Remove `arrayStrategies` from `MergeContext`** interface (line 27) and from `createMergeContext` (line 195):

```typescript
export interface MergeContext {
  defaultArrayStrategy: ArrayMergeStrategy;
}
```

```typescript
export function createMergeContext(
  defaultStrategy: ArrayMergeStrategy = "replace"
): MergeContext {
  return {
    defaultArrayStrategy: defaultStrategy,
  };
}
```

4. **Rewrite `deepMerge`** — remove `levelStrategy`, remove sibling `$arrayMerge` object propagation, replace `values` with `$values`:

```typescript
export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
  ctx: MergeContext,
  path: string = ""
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, overlayValue] of Object.entries(overlay)) {
    // Skip directive keys in output
    if (key.startsWith("$")) continue;

    const baseValue = base[key];

    // Per-field $arrayMerge + $values directive
    if (isPlainObject(overlayValue) && "$arrayMerge" in overlayValue) {
      const strategy = overlayValue.$arrayMerge;
      const values = overlayValue.$values;

      if (
        (strategy === "replace" ||
          strategy === "append" ||
          strategy === "prepend") &&
        Array.isArray(values) &&
        Array.isArray(baseValue)
      ) {
        result[key] = mergeArrays(baseValue, values, strategy);
        continue;
      }
    }

    // Both are arrays — use default strategy
    if (Array.isArray(baseValue) && Array.isArray(overlayValue)) {
      result[key] = mergeArrays(
        baseValue,
        overlayValue,
        ctx.defaultArrayStrategy
      );
      continue;
    }

    // Both are plain objects — recurse
    if (isPlainObject(baseValue) && isPlainObject(overlayValue)) {
      const currentPath = path ? `${path}.${key}` : key;
      result[key] = deepMerge(baseValue, overlayValue, ctx, currentPath);
      continue;
    }

    // Otherwise, overlay wins (including null values)
    result[key] = overlayValue;
  }

  return result;
}
```

Key changes from old implementation:

- No `levelStrategy` (was sibling syntax)
- No `ctx.arrayStrategies` lookups or mutations (was sibling syntax)
- `$values` instead of `values` in the directive check
- `getStrategyFromOverlay` inlined as a simple triple-check
- `extractArrayFromOverlay` replaced with direct `Array.isArray(overlayValue.$values)` check
- `currentPath` only computed when recursing into objects (minor cleanup)

5. **Update module doc comment** (line 3):

```typescript
/**
 * Deep merge utilities for JSON configuration objects.
 * Supports per-field array merge strategies via $arrayMerge + $values directives.
 */
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/merge.ts test/unit/merge.test.ts
git commit -m "refactor: replace values/sibling $arrayMerge syntax with per-field $arrayMerge + $values"
```

---

### Task 2: Update config-normalizer test

**Files:**

- Modify: `test/unit/config-normalizer.test.ts`

- [ ] **Step 1: Update the "strips merge directives from output" test**

At line 513, change `values: ["b"]` to `$values: ["b"]`:

```typescript
content: {
  items: { $arrayMerge: "append", $values: ["b"] },
},
```

Also add an assertion that `$values` is stripped:

```typescript
assert.ok(!jsonStr.includes("$values"));
```

- [ ] **Step 2: Run normalizer tests to verify they pass**

Run: `npm test -- --test-name-pattern "strips merge directives" 2>&1 | tail -10`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/config-normalizer.test.ts
git commit -m "test: update normalizer test to use $values directive syntax"
```

---

### Task 3: Update test fixture

**Files:**

- Modify: `test/fixtures/full-features.yaml`

- [ ] **Step 1: Replace `values:` with `$values:` in the fixture**

Lines 49-50 (repo-append test), lines 53-54, and lines 63-64 (repo-prepend test):

```yaml
# Test 4: Array merge with $arrayMerge: append
- git: git@github.com:org/repo-append.git
  files:
    service.config.json:
      content:
        features:
          $arrayMerge: append
          $values:
            - custom-feature
        tags:
          $arrayMerge: append
          $values:
            - extra-tag

# Test 5: Array merge with $arrayMerge: prepend
- git: git@github.com:org/repo-prepend.git
  files:
    service.config.json:
      content:
        features:
          $arrayMerge: prepend
          $values:
            - priority-feature
```

- [ ] **Step 2: Run full test suite**

Run: `npm test 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/full-features.yaml
git commit -m "test: update fixture to use $values directive syntax"
```

---

### Task 4: Update config-schema.json

**Files:**

- Modify: `config-schema.json`

- [ ] **Step 1: Update the description referencing `$arrayMerge`**

At line 305, update the description to mention `$values`:

```json
"description": "Object content overlay for JSON/YAML files. Use $arrayMerge + $values directives to control per-field array merging."
```

- [ ] **Step 2: Commit**

```bash
git add config-schema.json
git commit -m "docs: update schema description to reference $values directive"
```

---

### Task 5: Update documentation — merge-strategies.md

**Files:**

- Modify: `docs/configuration/merge-strategies.md`

- [ ] **Step 1: Rewrite the inline directive section**

Replace the "Inline Array Merge Directive" section (lines 41-116) with a single syntax section. Remove "Syntax 1: Wrapped with values" and "Syntax 2: Sibling Directive". Replace with:

````markdown
## Inline Array Merge Directive

For per-field control, use `$arrayMerge` and `$values` directives on individual array fields:

```yaml
files:
  config.json:
    content:
      features: ["core", "monitoring"]

repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          features:
            $arrayMerge: append
            $values: ["custom-feature"]
```
````

Result: `["core", "monitoring", "custom-feature"]`

### Per-Array Control

Each array field gets its own directive, so sibling arrays can use different strategies:

```yaml
files:
  config.json:
    content:
      features: ["core", "monitoring"]
      tags: ["production"]

repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          features:
            $arrayMerge: append
            $values: ["custom-feature"]
          tags:
            $arrayMerge: prepend
            $values: ["priority"]
```

Result:

- `features`: `["core", "monitoring", "custom-feature"]`
- `tags`: `["priority", "production"]`

### All Strategies

```yaml
# append — add after base items
features:
  $arrayMerge: append
  $values: ["new-item"]
# Base ["a", "b"] + overlay ["c"] = ["a", "b", "c"]

# prepend — add before base items
features:
  $arrayMerge: prepend
  $values: ["new-item"]
# Base ["a", "b"] + overlay ["c"] = ["c", "a", "b"]

# replace — completely replace base (default behavior)
features:
  $arrayMerge: replace
  $values: ["new-item"]
# Base ["a", "b"] + overlay ["c"] = ["c"]
```

!!! note "Directives are stripped"
Both `$arrayMerge` and `$values` are internal directives and do not appear in the final output.

````

- [ ] **Step 2: Commit**

```bash
git add docs/configuration/merge-strategies.md
git commit -m "docs: update merge-strategies to use $arrayMerge + $values syntax"
````

---

### Task 6: Update documentation — merge-strategies examples

**Files:**

- Modify: `docs/examples/merge-strategies.md`

- [ ] **Step 1: Replace wrapped and sibling syntax examples**

Replace the "Wrapped Syntax" section (lines 66-112) — change `values:` to `$values:`:

```yaml
# Platform team - append extra features
- git: git@github.com:org/api-gateway.git
  files:
    service.config.json:
      content:
        features:
          $arrayMerge: append
          $values: ["tracing", "rate-limiting"]

# Data team - prepend their plugin
- git: git@github.com:org/data-pipeline.git
  files:
    service.config.json:
      content:
        plugins:
          $arrayMerge: prepend
          $values: ["data-transform"]
```

Remove the entire "Sibling Syntax" section (lines 114-143) — replace with a "Per-Array Control" note:

```markdown
### Per-Array Control

Each array field specifies its own `$arrayMerge` + `$values`, so sibling arrays can use different strategies independently.
```

- [ ] **Step 2: Commit**

```bash
git add docs/examples/merge-strategies.md
git commit -m "docs: update merge-strategies examples to use $values, remove sibling syntax"
```

---

### Task 7: Update documentation — inheritance.md and shared-config.md

**Files:**

- Modify: `docs/configuration/inheritance.md`
- Modify: `docs/examples/shared-config.md`

- [ ] **Step 1: Update inheritance.md**

At lines 159-163, replace `values:` with `$values:`:

```yaml
features:
  $arrayMerge: append
  $values:
    - tracing
    - rate-limiting
```

- [ ] **Step 2: Update shared-config.md**

At lines 29-33, replace `values:` with `$values:`:

```yaml
features:
  $arrayMerge: append
  $values:
    - tracing
    - rate-limiting
```

- [ ] **Step 3: Commit**

```bash
git add docs/configuration/inheritance.md docs/examples/shared-config.md
git commit -m "docs: update inheritance and shared-config examples to use $values"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -30`

Expected: All tests pass.

- [ ] **Step 2: Run typecheck on test files**

Run: `npm run test:typecheck 2>&1 | tail -10`

Expected: No type errors.

- [ ] **Step 3: Run linter**

Run: `./lint.sh 2>&1 | tail -20`

Expected: No lint errors.
