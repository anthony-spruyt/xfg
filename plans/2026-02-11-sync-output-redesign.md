# Sync Output Redesign

> **For Claude:** Use superpowers:executing-plans to implement this design.
> **Prerequisite:** Complete settings output redesign first (see `2026-02-11-settings-output-redesign.md`).

## Problem

The sync command's file output uses a different format than the (new) settings output. After implementing the settings redesign, we should unify the output formats so both commands have consistent, repo-grouped output.

Current sync output uses:

- `github-summary.ts` for GitHub Actions summary (tables, details sections)
- `plan-formatter.ts` Resource model for CLI output
- Per-file resources like `file "repo/.github/ci.yml"`

## Goals

1. **Match settings format** - Same repo-grouped structure
2. **Flat file list** - Files are flat like settings, not trees like rulesets
3. **Unified summary** - Consistent GitHub markdown format
4. **Delete old code** - Remove `plan-formatter.ts` Resource model, consolidate `github-summary.ts`

Target output:

```
~ anthony-spruyt/repo-operator
    + .github/workflows/ci.yml
    ~ .github/CODEOWNERS
    - .github/old-workflow.yml

~ other-org/other-repo
    ~ README.md

Plan: 2 files to create, 2 to update, 1 to delete
```

---

## Data Model

Extend or parallel the settings report model:

```typescript
// src/output/sync-report.ts

interface SyncReport {
  repos: RepoFileChanges[];
  totals: {
    files: { create: number; update: number; delete: number };
  };
}

interface RepoFileChanges {
  repoName: string;
  files: FileChange[];
  prUrl?: string;
  mergeOutcome?: "manual" | "auto" | "force" | "direct";
  error?: string;
}

interface FileChange {
  path: string;
  action: "create" | "update" | "delete";
  diff?: string[]; // optional: line-level diff for update
}
```

**Key decisions:**

1. **Files have full lifecycle** - create/update/delete (unlike settings which can't delete)
2. **Diff optional** - For updates, can include line-level diff if available
3. **PR metadata preserved** - Keep PR URL and merge outcome for result reporting
4. **No "unchanged" tracking** - Only show files that change

---

## Formatter

```typescript
// src/output/sync-report-formatter.ts

function formatSyncReportCLI(report: SyncReport): string[];
function formatSyncReportMarkdown(report: SyncReport, dryRun: boolean): string;
```

**CLI Output:**

```
~ anthony-spruyt/repo-operator
    + .github/workflows/ci.yml
    ~ .github/CODEOWNERS
    - .github/old-workflow.yml

Plan: 1 file to create, 1 to update, 1 to delete
```

**GitHub Markdown:**

````markdown
## Config Sync Summary (Dry Run)

> [!WARNING]
> This was a dry run — no changes were applied

```diff
~ anthony-spruyt/repo-operator
    + .github/workflows/ci.yml
    ~ .github/CODEOWNERS
    - .github/old-workflow.yml
```

**Plan: 1 file to create, 1 to update, 1 to delete**
````

---

## Files Changed

### Files to Create

| File                                      | Purpose                     |
| ----------------------------------------- | --------------------------- |
| `src/output/sync-report.ts`               | New types for sync report   |
| `src/output/sync-report-formatter.ts`     | CLI and markdown formatters |
| `test/unit/sync-report-formatter.test.ts` | Tests                       |

### Files to Modify

| File                               | Changes                                          |
| ---------------------------------- | ------------------------------------------------ |
| `src/cli/sync-command.ts`          | Use new report builder and formatters            |
| `src/sync/repository-processor.ts` | Ensure file changes are tracked with full detail |

### Files to Delete

| File                           | Reason                                                 |
| ------------------------------ | ------------------------------------------------------ |
| `src/output/plan-formatter.ts` | Replaced by settings-report and sync-report formatters |
| `src/output/plan-summary.ts`   | Already deleted in settings redesign                   |
| `src/output/github-summary.ts` | Replaced by sync-report-formatter                      |

### Potential Consolidation

After both phases complete, consider whether `settings-report-formatter.ts` and `sync-report-formatter.ts` can share a common base, or if they should remain separate for clarity.

---

## Implementation Plan

### Phase 1: New formatter (no integration)

1. Create `src/output/sync-report.ts` with types
2. Create `src/output/sync-report-formatter.ts` with CLI formatter
3. Add tests
4. Add markdown formatter

### Phase 2: Wire up to sync command

5. Modify `sync-command.ts` to build `SyncReport` from processor results
6. Replace old formatters with new ones
7. Delete `github-summary.ts` (verify not used elsewhere first)

### Phase 3: Cleanup

8. Delete `plan-formatter.ts` (verify not used elsewhere)
9. Remove unused imports
10. Update remaining tests

---

## Dependencies

- **Must complete first:** Settings output redesign
- **Reason:** Settings redesign deletes `plan-summary.ts` which sync currently uses. Need to have sync's replacement ready before or coordinate the deletion.

**Alternative:** Implement both in parallel branches, merge settings first, then rebase sync branch.
