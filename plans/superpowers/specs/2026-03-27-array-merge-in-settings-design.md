# Design: `$arrayMerge` Directive in Settings Overrides

**Issue:** [#615](https://github.com/anthony-spruyt/xfg/issues/615)
**Date:** 2026-03-27

## Problem

When a per-repo settings override specifies an array field (e.g., `bypassActors` in a ruleset), it replaces the group/root default entirely rather than merging. This forces duplication of shared array entries across every repo that adds its own items.

The `$arrayMerge`/`$values` directive already works for file content via `deepMerge()`. Settings merging already uses `deepMerge()` via `mergeRuleset()`. The directive just isn't accepted by the validation layer or JSON schema for settings.

## Solution

Wire up the existing `$arrayMerge`/`$values` directive to work in settings overrides at any array depth. The main gap is validation, schema, directive stripping, and documentation. One small `deepMerge` enhancement is needed to resolve stacked directives across group layers (see "What Changes in `deepMerge`" below).

## Syntax

Same as file content — `$arrayMerge` + `$values` sibling keys:

```yaml
settings:
  rulesets:
    pr-rules:
      bypassActors:
        $arrayMerge: append
        $values:
          - actorId: 2719952
            actorType: Integration
            bypassMode: always
      rules:
        $arrayMerge: append
        $values:
          - type: required_status_checks
            parameters:
              requiredStatusChecks:
                - context: "summary / Check Results"
```

Strategies: `append`, `prepend`, `replace` (same as file content).

## Components

### A. Validation

**Files:** `src/config/validators/ruleset-validator.ts`, `src/config/validator.ts`

Add a shared helper to recognize the directive shape:

```typescript
function isArrayMergeDirective(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    "$arrayMerge" in value &&
    "$values" in value &&
    ["replace", "append", "prepend"].includes(value.$arrayMerge as string) &&
    Array.isArray(value.$values)
  );
}
```

Wherever validation checks "must be an array" for settings fields (`bypassActors`, `rules`, `conditions.refName.include`, `conditions.refName.exclude`), also accept the directive shape. When the directive shape is detected, validate the `$values` array contents with the same rules as the raw array.

Affected validation points:
- `validateRuleset()` — `bypassActors` (line ~241), `rules` (line ~320)
- `validateRuleset()` — `conditions.refName.include` and `conditions.refName.exclude` (line ~276)
- Any other array field validation in settings that currently rejects non-array input

### B. JSON Schema

**File:** `config-schema.json`

Add a reusable definition:

```json
"arrayMergeDirective": {
  "type": "object",
  "description": "Merge directive for arrays. Instead of replacing the base array, append or prepend values.",
  "required": ["$arrayMerge", "$values"],
  "properties": {
    "$arrayMerge": {
      "type": "string",
      "enum": ["replace", "append", "prepend"],
      "description": "How to merge with the base array"
    },
    "$values": {
      "type": "array",
      "description": "Values to merge"
    }
  },
  "additionalProperties": false
}
```

For each array field in ruleset definitions (`bypassActors`, `rules`, `conditions.refName.include/exclude`), change from:

```json
{ "type": "array", "items": { ... } }
```

to:

```json
{
  "oneOf": [
    { "type": "array", "items": { ... } },
    { "$ref": "#/definitions/arrayMergeDirective" }
  ]
}
```

Where practical, create typed directive variants that constrain `$values` items (e.g., `$values` items must be `bypassActor` objects for the `bypassActors` field). The generic `arrayMergeDirective` is the fallback for fields without specialized item types.

### C. Directive Stripping / Resolution

**File:** `src/config/merge.ts` or `src/config/normalizer.ts`

After `mergeSettings()` produces the final `RepoSettings`, ensure no unprocessed directives leak into the output. Two scenarios:

1. **Directive merged with base array** — `deepMerge()` already handles this, directives are consumed during merge. No change needed.
2. **Directive with no base array** — Per-repo specifies `$arrayMerge: append` on `bypassActors` but root has no `bypassActors`. `deepMerge()` won't find an array base, so the directive object passes through as-is.

Enhance `stripMergeDirectives()` to handle case 2: when an unresolved `{ $arrayMerge, $values }` object is found (an object whose only keys are `$arrayMerge` and `$values`), replace it with the `$values` array. This is the correct semantic — appending to nothing yields the values themselves.

Call this in `mergeSettings()` on the output of each `mergeRuleset()` call — NOT inside `mergeRuleset()` itself. `mergeRuleset()` is also called by `mergeRawSettings()` during group chain accumulation, and stripping there would prematurely resolve directives before subsequent group layers can merge with them.

### D. Documentation

**`docs/configuration/merge-strategies.md`:**
Add a new section "Settings Array Merge" after the existing file content sections. Show the `$arrayMerge` directive working in settings context with a `bypassActors` example and a `rules` example.

**`docs/configuration/rulesets.md`:**
Under the "Inheritance and Opt-Out" section, add a subsection "Appending to Arrays" showing how to use `$arrayMerge: append` on `bypassActors` and `rules` instead of duplicating the base array.

**`docs/configuration/inheritance.md`:**
Add a brief note in the "How Deep Merge Works" section that settings arrays support the same `$arrayMerge` directive as file content, with a cross-link to the merge strategies page.

### E. Tests

**Unit tests in `test/unit/config-normalizer.test.ts`:**

Settings merge with `$arrayMerge`:
- `bypassActors` with `$arrayMerge: append` — per-repo appends to root
- `rules` with `$arrayMerge: prepend` — per-repo prepends to root
- `conditions.refName.include` with `$arrayMerge: append`
- `$arrayMerge: replace` — explicit replace behaves same as default
- Sibling arrays with different strategies in same ruleset
- Directive in group settings merging
- Directive in conditional group settings merging

Edge cases:
- Directive with no base array (no root `bypassActors`) — resolves to `$values`
- Directive on non-array base (base is object) — falls through to overlay-wins
- Malformed directive (missing `$values`, invalid strategy) — validation rejects

**Validation tests in `test/unit/config-validator.test.ts`:**
- Directive shape accepted for `bypassActors`, `rules`, `conditions.refName.include/exclude`
- Malformed directive rejected (bad strategy, non-array `$values`)
- `$values` contents validated (e.g., `bypassActors` items must have `actorId`, `actorType`)

## What Changes in `deepMerge`

**Stacked directives:** When the base value is an unresolved `$arrayMerge` directive
(from a previous layer that had no base array), and the overlay is also a directive,
`deepMerge` must first resolve the base directive to its `$values` array,
then apply the overlay directive against that array.
Without this, `deepMerge` would recurse into both objects
and the directive keys would be skipped, producing an empty object.

Add handling in `deepMerge()` before the existing directive check: if the base value is an unresolved directive object (only `$arrayMerge` + `$values` keys, and `$values` is an array), resolve it to its `$values` array before proceeding. This way, the overlay directive sees an array base and merges correctly.

## What Doesn't Change
- `mergeRuleset()` — already calls `deepMerge()`
- `mergeRawSettings()` (group chain) — already calls `mergeRuleset()`
- `mergeLabels()` — labels use name-based merging, not array merging
- No new abstractions, no new merge paths, no new configuration keys

## Scope

This feature applies to any array at any depth within settings. The validation and schema changes target known array fields, but `deepMerge()` handles the directive generically — any future array field in settings gets support automatically.
