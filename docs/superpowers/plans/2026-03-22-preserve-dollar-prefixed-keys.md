# Preserve $-prefixed Keys in Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only strip known xfg directive keys (`$arrayMerge`, `$values`) during merge, preserving legitimate keys like `$schema`, `$generated`, `$id`, `$ref`.

**Architecture:** Add a `XFG_DIRECTIVES` constant set in `src/config/merge.ts`. Replace `key.startsWith("$")` checks in `deepMerge` and `stripMergeDirectives` with `XFG_DIRECTIVES.has(key)`. Update tests to verify preservation of non-directive `$`-prefixed keys and remove phantom `$override` references.

**Tech Stack:** TypeScript, node:test

**Issue:** [#632](https://github.com/anthony-spruyt/xfg/issues/632)

---

### Task 1: Add failing tests for $-prefixed key preservation

**Files:**
- Modify: `test/unit/merge.test.ts`

- [ ] **Step 1: Write failing tests for `deepMerge` preserving `$schema`**

Add to the `deepMerge` describe block:

```ts
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
  const overlay = { $schema: "https://example.com/schema.json", key: "overlay" };
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
```

- [ ] **Step 2: Write failing tests for `stripMergeDirectives` preserving `$schema`**

Replace the existing `stripMergeDirectives` describe block's `"preserves keys starting with $ that are not directives"` test, and remove the `"removes $override keys"` test. Add:

```ts
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
  assert.deepEqual(result, { $generated: "auto", $id: "config", key: "value" });
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
  const obj = { $arrayMerge: "append", $schema: "https://example.com/schema.json", key: "value" };
  const result = stripMergeDirectives(obj);
  assert.deepEqual(result, { $schema: "https://example.com/schema.json", key: "value" });
});
```

Also update the `"handles objects with only directives"` test to only use actual directives:

```ts
test("handles objects with only directives", () => {
  const obj = { $arrayMerge: "append", $values: [1, 2] };
  const result = stripMergeDirectives(obj);
  assert.deepEqual(result, {});
});
```

And update the `"works recursively on nested objects"` test to remove `$override`:

```ts
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
```

- [ ] **Step 3: Run tests to verify new tests fail**

Run: `npx test --test-name-pattern "preserves \\\$schema|preserves \\\$generated|preserves multiple|still strips" test/unit/merge.test.ts`
Expected: New preservation tests FAIL, directive stripping tests pass.

- [ ] **Step 4: Commit failing tests**

```bash
git add test/unit/merge.test.ts
git commit -m "test: add failing tests for $-prefixed key preservation (#632)"
```

---

### Task 2: Implement the fix

**Files:**
- Modify: `src/config/merge.ts:53-62` (deepMerge) and `src/config/merge.ts:110-117` (stripMergeDirectives)

- [ ] **Step 1: Add XFG_DIRECTIVES constant and update deepMerge**

At the top of `src/config/merge.ts` (after the imports), add:

```ts
/**
 * Keys reserved for xfg merge directives.
 * Only these are stripped during merge — standard $-prefixed keys
 * like $schema, $id, $ref, $generated are preserved.
 */
const XFG_DIRECTIVES = new Set(["$arrayMerge", "$values"]);
```

In `deepMerge`, change line 62 from:
```ts
if (key.startsWith("$")) continue;
```
to:
```ts
if (XFG_DIRECTIVES.has(key)) continue;
```

- [ ] **Step 2: Update stripMergeDirectives**

In `stripMergeDirectives`, change line 117 from:
```ts
if (key.startsWith("$")) continue;
```
to:
```ts
if (XFG_DIRECTIVES.has(key)) continue;
```

Update the JSDoc on `stripMergeDirectives` from:
```ts
/**
 * Strip merge directive keys ($arrayMerge, $override, etc.) from an object.
 * Works recursively on nested objects and arrays.
 */
```
to:
```ts
/**
 * Strip xfg merge directive keys ($arrayMerge, $values) from an object.
 * Works recursively on nested objects and arrays.
 * Standard $-prefixed keys ($schema, $id, $ref, etc.) are preserved.
 */
```

- [ ] **Step 3: Run all merge tests**

Run: `npx test test/unit/merge.test.ts`
Expected: ALL tests pass.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run test:typecheck`
Expected: No type errors.

- [ ] **Step 6: Run lint**

Run: `./lint.sh`
Expected: Clean.

- [ ] **Step 7: Commit**

```bash
git add src/config/merge.ts test/unit/merge.test.ts
git commit -m "fix: only strip xfg directive keys during merge, preserve \$schema etc (#632)"
```
