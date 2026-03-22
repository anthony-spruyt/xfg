# Preserve $-prefixed keys during merge

**Issue:** [#632](https://github.com/anthony-spruyt/xfg/issues/632)
**Date:** 2026-03-22

## Problem

`deepMerge` and `stripMergeDirectives` in `src/config/merge.ts` strip all `$`-prefixed keys from JSON objects. This removes legitimate keys like `$schema`, `$generated`, `$id`, and `$ref` — not just xfg directives.

## Solution

Replace the blanket `key.startsWith("$")` check with an explicit set of known xfg directive keys:

```ts
const XFG_DIRECTIVES = new Set(["$arrayMerge", "$values"]);
```

### Changes

1. **`deepMerge`** (line 62): Change `if (key.startsWith("$")) continue;` to `if (XFG_DIRECTIVES.has(key)) continue;`
2. **`stripMergeDirectives`** (line 117): Same change.
3. **Tests**: Update `merge.test.ts` to verify `$schema` and similar keys are preserved. Remove phantom `$override` references (never implemented).

### What about `$override`?

`$override` appears only in a JSDoc comment and tests — no production code implements it. It will be removed from tests and docs. If needed in the future, it can be added to `XFG_DIRECTIVES` at that time.

## Testing

- Existing tests for `$arrayMerge`/`$values` stripping continue to pass
- New tests verify `$schema`, `$generated`, `$id`, `$ref` survive merge and strip operations
- `$override` test cases removed (phantom feature)
