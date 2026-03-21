# JSON/YAML Content Diff in Summary Output

**Issue:** [#599](https://github.com/anthony-spruyt/xfg/issues/599)
**Date:** 2026-03-21

## Problem

When xfg syncs files, the summary output (CLI report and GitHub Step Summary) only shows which files changed and their action (create/update/delete). For JSON and YAML files — the structured config files that are xfg's core concern — there is no way to see *what* changed without opening a PR or inspecting the repo directly. This is especially problematic in direct merge mode where there is no PR diff to review.

## Decision Summary

- Show unified content diffs for JSON/YAML files (`.json`, `.json5`, `.yaml`, `.yml`) in both CLI and GitHub Step Summary output
- Diffs shown in all modes (dry-run and apply) — drift means applied changes may differ from a prior plan
- Full diff always, no truncation — xfg-managed config files are typically small
- Deleted files show full content as removals (consistent with new files showing all additions, Terraform-style)

## Design

### 1. Refactor `generateDiff` — Separate Computation from Formatting

`generateDiff()` in `src/sync/diff-utils.ts` currently couples diff computation with chalk formatting. Split into:

- **`computeUnifiedDiff(oldContent: string | null, newContent: string, contextLines?: number): string[]`** — returns raw diff lines (`+`, `-`, `@@`, ` ` prefixed). Pure computation, no formatting.
- **`generateDiff()`** — becomes a thin wrapper: calls `computeUnifiedDiff()` then maps through `formatDiffLine()` for chalk output. Existing callers unchanged.

### 2. Extend Data Types with Optional Diff Lines

**`FileWriteResult`** (`src/sync/types.ts`):

```typescript
interface FileWriteResult {
  fileName: string;
  content: string | null;
  oldContent?: string | null;  // only populated for JSON/YAML files
  action: "create" | "update" | "delete" | "skip";
}
```

**`FileChangeDetail`** (`src/sync/types.ts`):

```typescript
interface FileChangeDetail {
  path: string;
  action: "create" | "update" | "delete";
  diffLines?: string[];  // raw unified diff lines, only for JSON/YAML files
}
```

Diff lines are stored raw (no chalk). The rendering layer decides formatting — data is format-agnostic.

### 3. File Extension Filter

A single utility function in `src/sync/diff-utils.ts`:

```typescript
function isStructuredDataFile(fileName: string): boolean {
  return /\.(json|json5|ya?ml)$/i.test(fileName);
}
```

Called in three places:

1. **`FileWriter.writeFiles()`** — store `oldContent` on `FileWriteResult` only for matching files
2. **`FileSyncStrategy.execute()`** — compute `diffLines` via `computeUnifiedDiff()` only for matching files
3. **`ManifestManager.deleteOrphans()`** — read old content for matching orphan files before recording deletion

### 4. Populating Diff Data

**`FileWriter.writeFiles()`** (`src/sync/file-writer.ts`):
- Already reads `existingContent` via `gitOps.getFileContent()` and `fileContent` (the new content)
- For JSON/YAML files, store `oldContent: existingContent` on the `FileWriteResult`
- No diff computation here — just carry the content forward

**`FileSyncStrategy.execute()`** (`src/sync/file-sync-strategy.ts`):
- Already maps `FileWriteResult` to `FileChangeDetail`
- For JSON/YAML files with content available, call `computeUnifiedDiff(oldContent, newContent)` and attach resulting `diffLines`
- For non-JSON/YAML files, `diffLines` remains `undefined`

**`ManifestManager.deleteOrphans()`** (`src/sync/manifest.ts`):
- For JSON/YAML orphan files, read existing content via `gitOps.getFileContent()` before recording deletion
- Store as `oldContent` on the `FileWriteResult` so `FileSyncStrategy` can compute the diff

### 5. Rendering Diffs in Summary Output

**GitHub Step Summary (markdown)** — `renderSyncLines()` in `src/output/unified-summary.ts`:
After the file path line, append raw `diffLines` directly. They render correctly inside the existing `` ```diff ``` `` block:

```
@@ my-org/my-repo @@
! .eslintrc.json
@@ -1,3 +1,4 @@
 {
-  "semi": true
+  "semi": true,
+  "trailing-comma": "all"
 }
```

Same applies to `formatSyncReportMarkdown()` in `src/output/sync-report.ts` which calls `renderSyncLines`.

**CLI output** — `formatSyncReportCLI()` in `src/output/sync-report.ts`:
After each file path line, map raw `diffLines` through `formatDiffLine()` for chalk coloring, indented under the file listing:

```
~ my-org/my-repo
    ~ .eslintrc.json
      @@ -1,3 +1,4 @@
       {
      -  "semi": true
      +  "semi": true,
      +  "trailing-comma": "all"
       }
```

## Files Changed

| File | Change |
|------|--------|
| `src/sync/diff-utils.ts` | Extract `computeUnifiedDiff()` from `generateDiff()`; add `isStructuredDataFile()` |
| `src/sync/types.ts` | Add `oldContent?` to `FileWriteResult`; add `diffLines?` to `FileChangeDetail` |
| `src/sync/file-writer.ts` | Store `oldContent` on result for JSON/YAML files |
| `src/sync/file-sync-strategy.ts` | Compute `diffLines` via `computeUnifiedDiff()` when building `FileChangeDetail` |
| `src/sync/manifest.ts` | Read old content for JSON/YAML orphans before deletion |
| `src/output/unified-summary.ts` | `renderSyncLines()` appends raw diff lines after file path |
| `src/output/sync-report.ts` | `formatSyncReportCLI()` renders chalk-formatted diff lines; markdown gets diffs via `renderSyncLines` |

## Testing (95% coverage target)

- **`computeUnifiedDiff()`** — new file, modified file, deleted file (all lines removed), no changes (empty result)
- **`isStructuredDataFile()`** — all extensions (`.json`, `.json5`, `.yaml`, `.yml`), negatives (`.sh`, `.md`, `.ts`), case insensitivity
- **`file-writer.test.ts`** — `oldContent` populated for JSON/YAML, absent for others
- **`file-sync-strategy.test.ts`** — `diffLines` on `FileChangeDetail` for JSON/YAML, absent for `.sh`
- **`unified-summary.test.ts`** — `renderSyncLines` includes diff lines when present, excludes when absent
- **`sync-report.test.ts`** — CLI formatter renders chalk-formatted diffs; markdown formatter includes raw diffs
- **`manifest.test.ts`** — old content read for JSON/YAML orphan deletes
- **Edge cases** — empty files, files with no changes, new files (all additions), deleted files (all removals)

## Docs Updates

- GitHub Pages (`docs/`) — update the page covering sync output / plan output to mention JSON/YAML content diffs in CLI and GitHub Step Summary
- `README.md` — no change (badges/quick start only)
