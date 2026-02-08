# Terraform-Style Output for xfg

**Issue:** https://github.com/anthony-spruyt/xfg/issues/431
**Date:** 2026-02-08

## Problem

The `settings` command counts operations instead of showing meaningful changes:

- `[1/2]` progress counter is confusing (operations, not repos)
- "2 succeeded" double-counts a single repo
- GitHub Actions summary is useless - always end up reading logs

## Solution

Adopt pure Terraform-style output for both `sync` and `settings` commands:

- Flat list of resources with `+`/`~`/`-` symbols
- Single summary line: `Plan: X to create, Y to change, Z to destroy`
- No grouping by repo - just resources
- Terraform Cloud-style GitHub Actions summary

## Resource Types

| Command  | Resource  | Example                                      |
| -------- | --------- | -------------------------------------------- |
| sync     | `file`    | `file "owner/repo/.github/workflows/ci.yml"` |
| settings | `ruleset` | `ruleset "owner/repo/pr-rules"`              |
| settings | `setting` | `setting "owner/repo/description"`           |

## Console Output

### Sync Command

```
+ file "org/repo-a/.github/dependabot.yml"
~ file "org/repo-a/.github/workflows/ci.yml"
- file "org/repo-a/.github/old-workflow.yml"

Plan: 1 to create, 1 to change, 1 to destroy
```

### Settings Command

```
+ ruleset "org/repo/pr-rules"
    + target: branch
    + enforcement: active
    + conditions:
        + ref_name.include: ["~DEFAULT_BRANCH"]

~ setting "org/repo/description"
    ~ "old description" → "new description"

Plan: 1 to create, 1 to change, 0 to destroy
```

### No Changes

```
No changes. Your repositories match the configuration.
```

## Error Handling

Errors are per repo (files are committed together, settings are patched together):

```
+ file "org/repo-a/.github/ci.yml"
~ file "org/repo-a/.github/dependabot.yml"

✗ org/repo-b
    Error: Permission denied (403)

Plan: 1 to create, 1 to change, 0 to destroy
1 repository failed.
```

### Skipped Resources

```
⊘ ruleset "gitlab.com/org/repo/pr-rules"
    Skipped: Rulesets only supported for GitHub repositories

Plan: 0 to create, 0 to change, 0 to destroy (1 skipped)
```

### Exit Codes

- `0` - all resources processed successfully (including "no changes")
- `1` - one or more errors occurred

## GitHub Actions Summary

Terraform Cloud-inspired - changes visible at a glance:

````markdown
## Config Sync Summary (Dry Run)

> [!WARNING]
> This was a dry run — no changes were applied

### Plan: 2 to create, 3 to change, 1 to destroy

<details open>
<summary><strong>Files</strong></summary>

| Resource                                     | Action  |
| -------------------------------------------- | ------- |
| `+ file "org/repo-a/.github/ci.yml"`         | create  |
| `~ file "org/repo-a/.github/dependabot.yml"` | change  |
| `- file "org/repo-b/.github/old.yml"`        | destroy |

</details>

<details>
<summary><strong>Diff: file "org/repo-a/.github/dependabot.yml"</strong></summary>

```diff
- version: 1
+ version: 2
```
````

</details>
```

## Implementation

### Files to Modify

| File                    | Changes                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `src/index.ts`          | Refactor `runSync()` and `runSettings()` to collect resources first, then apply |
| `src/logger.ts`         | Replace progress counter with resource-based output                             |
| `src/github-summary.ts` | Rewrite to Terraform Cloud style                                                |
| `src/summary-utils.ts`  | Update to new result model                                                      |

### New File

| File                    | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `src/plan-formatter.ts` | Unified Terraform-style formatter for all resource types |

### Reuse Existing

- `src/ruleset-plan-formatter.ts` - property diff logic (output formatting moves)
- `src/repo-settings-plan-formatter.ts` - same
- `src/diff-utils.ts` - file diffs

### Out of Scope

- Processors (`repository-processor.ts`, `ruleset-processor.ts`, `repo-settings-processor.ts`)
- Strategies
- Config loading/validation

## Implementation Phases

### Phase 1: New plan formatter

- Create `src/plan-formatter.ts` with unified Terraform-style output
- Support `file`, `ruleset`, `setting` resource types
- Reuse existing diff computation

### Phase 2: Refactor settings command

- Collect all resources across repos before processing
- Output plan, then apply
- Use new formatter for console output

### Phase 3: Refactor sync command

- Same pattern: collect file changes first, show plan, apply
- Reuse same formatter

### Phase 4: GitHub summary rewrite

- Replace table-based summary with Terraform Cloud style
- Inline resource list with collapsible diffs
- Works for both sync and settings

### Phase 5: Cleanup

- Remove old logger progress methods (`setTotal`, `progress`, etc.)
- Remove redundant code from old formatters
- Update tests
