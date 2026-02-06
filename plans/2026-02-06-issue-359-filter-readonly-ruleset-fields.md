# Design: Filter Read-Only GitHub API Metadata Fields from Ruleset Diff

**Issue:** [#359](https://github.com/anthony-spruyt/xfg/issues/359)
**Date:** 2026-02-06

## Problem

The ruleset dry-run diff shows read-only GitHub API response fields (`node_id`, `_links`, `created_at`, `updated_at`, `current_user_can_bypass`) as removals, creating misleading noise. These fields are not configurable.

## Approach: Allowlist Derived from Config Type

Instead of maintaining a blocklist of fields to ignore (which drifts as GitHub adds API fields), use an allowlist derived from the `Ruleset` config type. Only the 5 configurable fields are compared; everything else is automatically excluded.

### Shared Constant in `config.ts`

```typescript
const RULESET_FIELD_MAP: Record<keyof Ruleset, string> = {
  target: "target",
  enforcement: "enforcement",
  bypassActors: "bypass_actors",
  conditions: "conditions",
  rules: "rules",
};

export const RULESET_COMPARABLE_FIELDS = new Set(
  Object.values(RULESET_FIELD_MAP)
);
```

`Record<keyof Ruleset, string>` ensures the compiler errors if `Ruleset` gains a new field without a corresponding map entry.

### Consumer Changes

**`ruleset-diff.ts`** — `normalizeGitHubRuleset()`: replace `IGNORE_FIELDS` blocklist with `RULESET_COMPARABLE_FIELDS` allowlist. Delete `IGNORE_FIELDS`.

**`ruleset-plan-formatter.ts`** — `normalizeForDiff()`: replace local `ignoreFields` blocklist with `RULESET_COMPARABLE_FIELDS` allowlist. Delete `ignoreFields`.

Both already convert keys to snake_case before checking, so the allowlist slots in by flipping the condition.

### Tests

- **`ruleset-diff.test.ts`**: Add test that a ruleset with `node_id`, `_links`, `created_at`, `updated_at`, `current_user_can_bypass` is detected as `unchanged`.
- **`ruleset-plan-formatter.test.ts`**: Add test that these fields don't appear in diff output for updates.

## Files

| File                                       | Change                                                  |
| ------------------------------------------ | ------------------------------------------------------- |
| `src/config.ts`                            | Add `RULESET_FIELD_MAP` and `RULESET_COMPARABLE_FIELDS` |
| `src/ruleset-diff.ts`                      | Replace blocklist with allowlist import                 |
| `src/ruleset-plan-formatter.ts`            | Replace blocklist with allowlist import                 |
| `test/unit/ruleset-diff.test.ts`           | Add read-only field filtering test                      |
| `test/unit/ruleset-plan-formatter.test.ts` | Add read-only field filtering test                      |
