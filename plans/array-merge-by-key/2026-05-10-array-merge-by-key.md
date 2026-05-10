# Implementation Plan: `$arrayMerge: merge` (key-based array merging)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `merge` strategy to `$arrayMerge` that matches array items by identity key (`type`, `actor_id`) and deep-merges matched pairs. Solves [#737](https://github.com/anthony-spruyt/xfg/issues/737) and [#730](https://github.com/anthony-spruyt/xfg/issues/730).

**Architecture:** Extends existing `ArrayMergeStrategy` union and `arrayMergeStrategies` map in `src/config/merge.ts`. Extracts `MATCH_KEY_CANDIDATES` from `src/settings/rulesets/diff.ts` into shared location. No new modules — all changes in existing files.

**Branch:** `feat/array-merge-by-key`

## Background

When multiple conditional groups both use `$arrayMerge: append` to add rules with the same `type` to a ruleset, xfg produces duplicate entries. Users must use `noneOf` workarounds with combinatorial explosion. Even if items were matched by type, nested `$arrayMerge` directives inside matched items are not honored.

The `merge` strategy solves both: match items by key → `deepMerge()` matched pairs → nested `$arrayMerge` honored naturally.

## Tasks

### Task 1: Extract MATCH_KEY_CANDIDATES to shared location

**Files:**

- Modify: `src/config/merge.ts`
- Modify: `src/settings/rulesets/diff.ts`

**Steps:**

- [ ] Add `MATCH_KEY_CANDIDATES` constant to `src/config/merge.ts`: `["type", "actor_id"] as const`
- [ ] Add `findMatchKey(base: unknown[], overlay: unknown[]): string | undefined` to `src/config/merge.ts` — port logic from `diff.ts` `findMatchKey()`
- [ ] Export both from `merge.ts`
- [ ] Update `src/settings/rulesets/diff.ts` to import `MATCH_KEY_CANDIDATES` and `findMatchKey` from `merge.ts` instead of defining locally
- [ ] Run `npm test` — all existing tests pass

### Task 2: Add `merge` strategy to ArrayMergeStrategy

**Files:**

- Modify: `src/config/merge.ts`

**Steps:**

- [ ] Add `"merge"` to `ArrayMergeStrategy` type union: `"replace" | "append" | "prepend" | "merge"`
- [ ] Update `ArrayMergeHandler` signature to accept optional `MergeContext`: `(base: unknown[], overlay: unknown[], ctx?: MergeContext) => unknown[]`
- [ ] Update existing handlers (`replace`, `append`, `prepend`) to accept the extra parameter (unused)
- [ ] Add `mergeByKey` function:
  ```typescript
  function mergeByKey(
    base: unknown[],
    overlay: unknown[],
    matchKey: string,
    ctx: MergeContext
  ): unknown[]
  ```
  Logic:
  - Build map of base items by key value
  - For each overlay item: if base has matching key → `deepMerge(baseItem, overlayItem, ctx)`, else append
  - Preserve unmatched base items in original position
  - Return merged array
- [ ] Register `merge` handler in `arrayMergeStrategies` map — when match key found, use `mergeByKey()`; when no match key found, fall back to append behavior
- [ ] Update `isUnresolvedDirective()` to recognize `"merge"` as valid strategy (it already uses `arrayMergeStrategies.has()`, so this should be automatic after map registration)
- [ ] Update `mergeArrays()` to pass `ctx` to handler
- [ ] Update `deepMerge()` call to `mergeArrays()` to pass `ctx`
- [ ] Run `npm test` — all existing tests still pass

### Task 3: Unit tests for `merge` strategy

**Files:**

- Modify: `test/unit/config/merge.test.ts`

**Steps:**

- [ ] Test: `merge` with matching `type` keys deep-merges items
  - base: `[{type: "a", x: 1}, {type: "b", x: 2}]`
  - overlay: `[{type: "a", y: 3}]`
  - result: `[{type: "a", x: 1, y: 3}, {type: "b", x: 2}]`
- [ ] Test: `merge` with no matching keys falls back to append
  - base: `[{name: "a"}, {name: "b"}]`
  - overlay: `[{name: "c"}]`
  - result: `[{name: "a"}, {name: "b"}, {name: "c"}]`
- [ ] Test: `merge` with mixed matched/unmatched items
  - base: `[{type: "a", x: 1}, {type: "b", x: 2}]`
  - overlay: `[{type: "a", y: 3}, {type: "c", z: 4}]`
  - result: `[{type: "a", x: 1, y: 3}, {type: "b", x: 2}, {type: "c", z: 4}]`
- [ ] Test: nested `$arrayMerge: append` inside matched items honored (#730 regression test)
  - base: `[{type: "rsc", parameters: {checks: ["ci"]}}]`
  - overlay: `[{type: "rsc", parameters: {checks: {$arrayMerge: "append", $values: ["mergify"]}}}]`
  - result: `[{type: "rsc", parameters: {checks: ["ci", "mergify"]}}]`
- [ ] Test: `merge` with `actor_id` match key
- [ ] Test: `merge` with primitive arrays (no keys) falls back to append
- [ ] Test: `merge` via `$arrayMerge` directive in `deepMerge()`
  - base: `{rules: [{type: "a", x: 1}]}`
  - overlay: `{rules: {$arrayMerge: "merge", $values: [{type: "a", y: 2}]}}`
  - result: `{rules: [{type: "a", x: 1, y: 2}]}`
- [ ] Test: stacked directives — base has `$arrayMerge: merge` directive, overlay also has one
- [ ] Test: overlay item overwrites scalar in matched base item
- [ ] Test: `merge` with empty base array → returns overlay items
- [ ] Test: `merge` with empty overlay array → returns base items
- [ ] Run `npm test` — all tests pass

### Task 4: Update JSON schema

**Files:**

- Modify: `config-schema.json`

**Steps:**

- [ ] Update `arrayMergeDirective` definition: add `"merge"` to `$arrayMerge` enum
- [ ] Update `bypassActorsArrayMergeDirective` definition: add `"merge"` to `$arrayMerge` enum
- [ ] Update `rulesArrayMergeDirective` definition: add `"merge"` to `$arrayMerge` enum
- [ ] Update description strings to mention merge strategy
- [ ] Verify schema is valid JSON

### Task 5: Update documentation

**Files:**

- Modify: `docs/configuration/merge-strategies.md`
- Modify: `docs/examples/merge-strategies.md`

**Steps:**

- [ ] Update strategy table in `docs/configuration/merge-strategies.md` — add `merge` row: "Deep-merges array items matched by identity key (`type`, `actor_id`); unmatched items appended"
- [ ] Add "Merge by Key" section after "All Strategies" with:
  - Explanation of how match keys are auto-detected
  - Which keys are candidates (`type`, `actor_id`)
  - Behavior when no match key found (falls back to append)
  - Example: ruleset rules merged by `type` across conditional groups (the #737 use case)
  - Example: nested `$arrayMerge` within matched items (#730 use case)
- [ ] Update `docs/examples/merge-strategies.md` — add `merge` to "Available Strategies" table
- [ ] Add practical example showing conditional groups merging `required_status_checks` without `noneOf`

### Task 6: Verification

**Steps:**

- [ ] `npm run build` — compiles clean
- [ ] `npm test` — all unit tests pass
- [ ] `npm run test:typecheck` — test type checking passes
- [ ] `./lint.sh` — linting passes
- [ ] Commit and push

## Design Decisions

### Match key auto-detection vs explicit `$matchKey`

Auto-detect using `MATCH_KEY_CANDIDATES` (`type`, `actor_id`). Same logic already used in `diff.ts` for comparing config against GitHub API. Keeps config concise. Can add explicit `$matchKey` later if needed — backward-compatible extension.

### Fallback when no match key found

Fall back to `append` behavior. If array items don't all share a candidate key, there's no way to match them, so concatenation is the safest default.

### Duplicate keys within same array

Match first occurrence. This matches how `findMatchKey()` in `diff.ts` already works — it doesn't validate uniqueness, just checks key presence.

### Handler signature change

Add optional `MergeContext` to `ArrayMergeHandler` so `merge` handler can call `deepMerge()` recursively. Existing handlers ignore it — no behavior change.

## References

- [Issue #737](https://github.com/anthony-spruyt/xfg/issues/737)
- [Issue #730](https://github.com/anthony-spruyt/xfg/issues/730)
- `src/config/merge.ts` — core merge logic
- `src/settings/rulesets/diff.ts` — existing `MATCH_KEY_CANDIDATES` and `findMatchKey()`
- `docs/configuration/merge-strategies.md` — merge strategy docs
- `config-schema.json` — JSON schema definitions
