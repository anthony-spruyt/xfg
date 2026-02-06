# Dry-Run Indicator for GitHub Job Summary

**Issue:** [#357](https://github.com/anthony-spruyt/xfg/issues/357)
**Date:** 2026-02-06

## Problem

The GitHub Actions job summary looks identical whether the run was a dry run or an actual apply. Users reviewing the summary cannot tell if changes were applied or just planned.

## Design

### Interface Change

Add `dryRun?: boolean` to `SummaryData`:

```typescript
export interface SummaryData {
  title: string;
  dryRun?: boolean;
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  results: RepoResult[];
}
```

### Rendering Changes in `formatSummary()`

When `dryRun` is true:

1. **Title suffix** — Append "(Dry Run)":

   ```markdown
   ## Config Sync Summary (Dry Run)
   ```

2. **Warning banner** — Insert after header:

   ```markdown
   > [!WARNING]
   > This was a dry run — no changes were applied
   ```

3. **Stats table labels** — Use hypothetical wording:
   | Normal | Dry Run |
   |--------|---------|
   | `✅ Succeeded` | `✅ Would Succeed` |
   | `⏭️ Skipped` | `⏭️ Would Skip` |
   | `❌ Failed` | `❌ Would Fail` |

4. **Repo detail statuses** via `formatStatus(result, dryRun)`:
   | Normal | Dry Run |
   |--------|---------|
   | `✅ Open` | `✅ Would Open` |
   | `✅ Auto-merge` | `✅ Would Auto-merge` |
   | `✅ Merged` | `✅ Would Merge` |
   | `✅ Pushed` | `✅ Would Push` |
   | `✅ Succeeded` | `✅ Would Succeed` |
   | `⏭️ Skipped` | `⏭️ Would Skip` |
   | `❌ Failed` | `❌ Would Fail` |

### Caller Changes in `src/index.ts`

Both callers pass through `options.dryRun`:

- Sync caller (line ~303): `dryRun: options.dryRun`
- Settings caller (line ~600): `dryRun: options.dryRun`

### Testing

New `describe("dry-run mode", ...)` block in `github-summary.test.ts`:

1. Appends "(Dry Run)" to title
2. Includes `[!WARNING]` admonition banner
3. Stats table shows "Would Succeed/Skip/Fail"
4. Repo detail statuses show "Would Open", "Would Push", etc.
5. `dryRun: false` and `dryRun: undefined` produce normal output (no regression)

## Files

- `src/github-summary.ts` — `SummaryData`, `formatSummary()`, `formatStatus()`
- `src/index.ts` — Two callers
- `test/unit/github-summary.test.ts` — New dry-run tests
