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

- **`computeUnifiedDiff(oldContent: string | null, newContent: string | null, contextLines?: number): string[]`** — returns raw diff lines (`+`, `-`, `@@`, ` ` prefixed), including `@@` hunk headers. Three special cases handled symmetrically:
  - **New file** (`oldContent === null`): emits `@@ -0,0 +1,N @@` header followed by all lines as `+` additions
  - **Deleted file** (`newContent === null`): emits `@@ -1,N +0,0 @@` header followed by all lines as `-` removals
  - **No changes**: returns empty array

  For modified files, uses LCS algorithm to produce standard unified diff hunks with context. Pure computation, no formatting.
- **`generateDiff()`** — becomes a thin wrapper: calls `computeUnifiedDiff()` then maps through `formatDiffLine()` for chalk output. Existing callers unchanged. The unused `_fileName` parameter is cleaned up.

### 2. Extend Data Types with Optional Diff Lines

**`FileWriteResult`** (`src/sync/types.ts`):

```typescript
interface FileWriteResult {
  fileName: string;
  content: string | null;
  action: "create" | "update" | "delete" | "skip";
  diffLines?: string[];  // raw unified diff lines, only for JSON/YAML files
}
```

Note: `diffLines` is computed and attached in `FileWriter.writeFiles()` where both old and new content are in scope. No `oldContent` field needed — the diff is computed at the point where content is available, not threaded through as raw content.

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
export function isStructuredDataFile(fileName: string): boolean {
  return /\.(json|json5|ya?ml)$/i.test(fileName);
}
```

Called in two places:

1. **`FileWriter.writeFiles()`** — compute and attach `diffLines` on `FileWriteResult` only for matching files
2. **`ManifestManager.deleteOrphans()`** — read old content and compute `diffLines` for matching orphan files before recording deletion

### 4. Populating Diff Data

**`FileWriter.writeFiles()`** (`src/sync/file-writer.ts`):
- Already reads `existingContent` via `gitOps.getFileContent()` and has `fileContent` (new content) in scope
- Already calls `generateDiff()` for dry-run logging
- For JSON/YAML files (both dry-run and apply), call `computeUnifiedDiff(existingContent, fileContent)` and attach the result as `diffLines` on the `FileWriteResult`
- This is the natural computation point — both content values are already available here, avoiding the need to thread raw content through multiple layers
- **Implementation note:** the current code only computes diffs inside the `if (dryRun)` block. The `computeUnifiedDiff` call for structured data files must be placed outside the dry-run conditional (guarded by `isStructuredDataFile && changed`), while `generateDiff` (chalk-formatted, for console logging) stays inside the `dryRun` block

**`FileSyncStrategy.execute()`** (`src/sync/file-sync-strategy.ts`):
- Already maps `FileWriteResult` to `FileChangeDetail` via `changedFiles` (which only has `fileName` and `action`)
- Change: look up the `FileWriteResult` from the `fileChanges` map (already available in `FileSyncResult`) using `f.fileName` as the key, to carry `diffLines` through to `FileChangeDetail`
- No diff computation here — just pass through pre-computed `diffLines`

**`ManifestManager.deleteOrphans()`** (`src/sync/manifest.ts`):
- `deleteOrphans()` receives `deps.gitOps` typed as `ILocalGitOps`, which exposes `getFileContent()`
- For JSON/YAML orphan files, read existing content via `gitOps.getFileContent()`, compute `diffLines` using `computeUnifiedDiff(existingContent, null)` (deletion sentinel — produces all lines as `-` removals with `@@ -1,N +0,0 @@` header), and attach to the `FileWriteResult`

**`ManifestManager.saveUpdatedManifest()`** (`src/sync/manifest.ts`):
- `.xfg.json` is a JSON file that matches `isStructuredDataFile`
- When the manifest changes (create or update), compute `diffLines` using `computeUnifiedDiff()` with the existing manifest content and new manifest content, and attach to the `FileWriteResult`

### 5. Carrying `diffLines` Through the Report Pipeline

**`buildSyncReport()`** (`src/cli/sync-report-builder.ts`):
- Currently maps `FileChangeDetail` to `ReportFileChange` keeping only `path` and `action`, which would drop `diffLines`
- Update the mapping to include `diffLines` when present: `{ path: f.path, action: f.action, diffLines: f.diffLines }`

**`ReportFileChange`** (`src/output/types.ts`):
- This is a type alias for `FileChangeDetail`, so it automatically gains `diffLines` when `FileChangeDetail` is updated — no change needed here

### 6. Rendering Diffs in Summary Output

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
After each file path line, map raw `diffLines` through `formatDiffLine()` for chalk coloring. Each diff line gets a fixed 6-space indent prepended (the raw diff lines already contain their own `+`/`-`/` ` prefixes):

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

`formatDiffLine` is imported from `src/sync/diff-utils.ts`. The `output/` module already imports from `sync/` (e.g., `output/types.ts` imports `FileChangeDetail` from `sync/index.ts`), so this does not introduce a new dependency direction.

## Files Changed

| File | Change |
|------|--------|
| `src/sync/diff-utils.ts` | Extract `computeUnifiedDiff()` from `generateDiff()`; add `isStructuredDataFile()`; clean up unused `_fileName` param |
| `src/sync/types.ts` | Add `diffLines?` to `FileWriteResult` and `FileChangeDetail` |
| `src/sync/file-writer.ts` | Compute and attach `diffLines` on `FileWriteResult` for JSON/YAML files (both dry-run and apply) |
| `src/sync/file-sync-strategy.ts` | Pass through `diffLines` from `FileWriteResult` to `FileChangeDetail` via `fileChanges` map lookup |
| `src/sync/manifest.ts` | Read old content and compute `diffLines` for JSON/YAML orphans before deletion; compute `diffLines` for `.xfg.json` manifest changes in `saveUpdatedManifest` |
| `src/cli/sync-report-builder.ts` | Carry `diffLines` through in `buildSyncReport()` mapping |
| `src/output/unified-summary.ts` | `renderSyncLines()` appends raw diff lines after file path |
| `src/output/sync-report.ts` | `formatSyncReportCLI()` renders chalk-formatted, indented diff lines; markdown gets diffs via `renderSyncLines` |

## Testing (95% coverage target)

- **`computeUnifiedDiff()`** — new file (`oldContent=null`, `@@ -0,0 +1,N @@` + all additions), modified file (hunks with context), deleted file (`newContent=null`, `@@ -1,N +0,0 @@` + all removals), no changes (empty result)
- **`isStructuredDataFile()`** — all extensions (`.json`, `.json5`, `.yaml`, `.yml`), negatives (`.sh`, `.md`, `.ts`), case insensitivity
- **`file-writer.test.ts`** — `diffLines` populated for JSON/YAML in both dry-run and apply; absent for non-JSON/YAML files
- **`file-sync-strategy.test.ts`** — `diffLines` carried through to `FileChangeDetail` for JSON/YAML; absent for `.sh`
- **`sync-report-builder.test.ts`** — `diffLines` preserved through `buildSyncReport()` pipeline
- **`unified-summary.test.ts`** — `renderSyncLines` includes diff lines when present, excludes when absent
- **`sync-report.test.ts`** — CLI formatter renders chalk-formatted diffs with correct indentation; markdown formatter includes raw diffs
- **`manifest.test.ts`** — `diffLines` computed for JSON/YAML orphan deletes, absent for non-JSON/YAML orphans; `saveUpdatedManifest` computes `diffLines` for `.xfg.json` changes
- **Edge cases** — empty files, files with no changes (no diff lines), new files (all additions), deleted files (all removals)

## Docs Updates

- GitHub Pages (`docs/`) — update the page covering sync output / plan output to mention JSON/YAML content diffs in CLI and GitHub Step Summary
- `README.md` — no change (badges/quick start only)
