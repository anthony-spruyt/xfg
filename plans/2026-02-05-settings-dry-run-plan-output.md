# Settings Dry-Run Plan Output Design

## Overview

Improve the `--dry-run` output for the `settings` command to show Terraform-style plan output with property-level diffs, instead of just counts.

## Current State

The settings sync dry-run currently shows minimal output:

```
[DRY RUN] 2 created, 1 updated, 0 deleted, 1 unchanged
```

This doesn't tell the user WHAT changed or what configuration will be applied.

## Desired Output Format

### Overall Structure

```
Running in DRY RUN mode - no changes will be made

Repository: org/repo-name
  Create:
    + ruleset "new-ruleset-name"
        + enforcement: active
        + target: branch
        + conditions:
            + ref_name:
                + include: ["~DEFAULT_BRANCH"]
                + exclude: []
        + rules:
            + pull_request:
                + required_approving_review_count: 2

  Update:
    ~ ruleset "existing-ruleset"
        ~ rules:
            ~ pull_request:
                ~ required_approving_review_count: 1 → 2
                + dismiss_stale_reviews_on_push: true
        ~ bypass_actors:
            - actor_id: 5 (was: Deploy Bot)

  Delete:
    - ruleset "deprecated-ruleset"

Plan: 1 to create, 1 to update, 1 to delete (3 unchanged)
```

### Symbols

| Symbol | Color  | Meaning                   |
| ------ | ------ | ------------------------- |
| `+`    | green  | Added property/ruleset    |
| `~`    | yellow | Modified property/ruleset |
| `-`    | red    | Removed property/ruleset  |

### Value Display

- **Changed scalars**: `old → new`
- **Added properties**: Just show the new value
- **Removed properties**: Show `(was: old-value)` for context

### Organization

1. Group by repository
2. Within each repo, group by action (Create, Update, Delete)
3. Unchanged rulesets hidden, count shown in summary

## Implementation Approach

### New Module: `ruleset-plan-formatter.ts`

Create a new module responsible for formatting the plan output:

```typescript
interface PropertyDiff {
  path: string[];
  action: "add" | "change" | "remove";
  oldValue?: unknown;
  newValue?: unknown;
}

interface FormattedPlan {
  lines: string[]; // Formatted output lines
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
}

export function formatRulesetPlan(changes: RulesetChange[]): FormattedPlan;
```

### Modifications to Existing Modules

1. **`ruleset-processor.ts`**
   - In dry-run mode, call the new formatter instead of just logging counts
   - Pass the full `RulesetChange[]` with `current` and `desired` objects

2. **`logger.ts`**
   - Add new method `rulesetPlan()` for outputting the formatted plan
   - Reuse existing color utilities

### Leverage Existing Infrastructure

- `diffRulesets()` already computes create/update/delete/unchanged
- Each `RulesetChange` includes `current` and `desired` objects
- Just need to format that data into the tree structure

## Property Diff Algorithm

### Data Structure

```typescript
interface PropertyDiff {
  path: string[]; // e.g., ["rules", "pull_request", "required_approving_review_count"]
  action: "add" | "change" | "remove";
  oldValue?: unknown; // for change/remove
  newValue?: unknown; // for add/change
}
```

### Algorithm

1. Walk both `current` and `desired` objects recursively
2. For each key in `desired` not in `current` → `add`
3. For each key in `current` not in `desired` → `remove`
4. For each key in both:
   - If both are objects → recurse
   - If both are arrays → compare (order-sensitive for most, order-insensitive for bypass_actors by actor_id)
   - If scalars differ → `change`

### Special Handling

- **Arrays of primitives**: Show inline as `["a", "b"]`
- **Arrays of objects** (like `bypass_actors`): Match by identifier field, diff each item
- **Null/undefined**: Treat as "not present"

### Output Formatting

- Indent 4 spaces per nesting level
- Collapse unchanged parent nodes (don't show `rules:` if nothing under it changed)
- Only show the path to changed leaves

## Edge Cases

1. **Empty sections**: Don't show "Create:" header if nothing to create
2. **No changes for a repo**: Skip the repo entirely
3. **Very long arrays**: Truncate with `... (N more items)` if array exceeds 5 items
4. **First-time sync**: All rulesets show as "create" (works naturally)

## Summary Display

### Per-Repository Summary

```
Plan: 1 to create, 1 to update, 1 to delete (3 unchanged)
```

### Multi-Repository Final Summary

```
────────────────────────────────────────
Total: 3 to create, 2 to update, 1 to delete across 4 repositories
```

## Complete Example

```
Running in DRY RUN mode - no changes will be made

Repository: acme-org/backend-api
  Create:
    + ruleset "require-signed-commits"
        + enforcement: active
        + target: branch
        + conditions:
            + ref_name:
                + include: ["~DEFAULT_BRANCH", "release/*"]
                + exclude: []
        + rules:
            + required_signatures: true

  Update:
    ~ ruleset "branch-protection"
        ~ rules:
            ~ pull_request:
                ~ required_approving_review_count: 1 → 2
                + dismiss_stale_reviews_on_push: true
        ~ bypass_actors:
            - actor_id: 123 (was: Old Bot)

Plan: 1 to create, 1 to update, 0 to delete (2 unchanged)

Repository: acme-org/frontend-app
  Delete:
    - ruleset "deprecated-status-checks"

Plan: 0 to create, 0 to update, 1 to delete (1 unchanged)

────────────────────────────────────────
Total: 1 to create, 1 to update, 1 to delete across 2 repositories
```

## Files to Create/Modify

| File                                  | Action | Purpose                        |
| ------------------------------------- | ------ | ------------------------------ |
| `src/ruleset-plan-formatter.ts`       | Create | New module for plan formatting |
| `src/ruleset-processor.ts`            | Modify | Call formatter in dry-run mode |
| `src/logger.ts`                       | Modify | Add `rulesetPlan()` method     |
| `test/ruleset-plan-formatter.test.ts` | Create | Unit tests for formatter       |

## Out of Scope

- File sync dry-run (already has good unified diff output)
- Non-dry-run behavior (unchanged)
- Config parsing or validation (unchanged)
