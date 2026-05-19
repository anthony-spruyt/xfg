# createOnly Files Should Still Enforce Executable File Mode

**Issue**: [#818](https://github.com/anthony-spruyt/xfg/issues/818) **Date**: 2026-05-18

## Problem

`createOnly: true` files skip mode drift detection entirely. When a `.sh` file with `createOnly` is committed manually with mode `100644`, xfg never corrects it to `100755` because the `skip` action short-circuits both content sync and the `applyExecutablePermissions` pass.

## Root Cause

In `file-writer.ts`, `processOneFile` exits early for createOnly files that already exist (line 94-109), setting `action: "skip"` without computing desired/current mode or populating `modeCache`. Then `applyExecutablePermissions` (line 208) skips all entries with `action === "skip"`.

Content skip is correct. Mode skip is the bug.

## Approach

**Approach A: Fix inside `processOneFile` — compute mode before early return.**

The createOnly early-return path will compute `desiredMode` and `currentMode` before deciding the action. If mode drifted, emit a tracked `modeOnly` change instead of `skip`.

Alternatives considered:

- **B: Fix in `applyExecutablePermissions`** — rejected because it leaks decision logic into the executor, violating SRP.
- **C: New `skipContent` action type** — rejected as YAGNI; ripples through `FileActionKind` union and all downstream consumers.

## Design

### `processOneFile` changes

Current flow:

```text
createOnly + exists → set action:"skip", return
```

New flow:

```text
createOnly + exists →
  compute desiredMode via shouldBeExecutable(file)
  get currentMode via gitOps.getFileMode(file.fileName)
  populate modeCache
  if modeDiffers →
    emit { action:"update", content:null, mode:desiredMode, modeOnly:true }
    if dryRun → log "Would change mode: ..."
    else → incrementDiffStats MODIFIED
  else →
    emit { action:"skip" }
  return (still early-return, no content processing)
```

This mirrors the existing mode-drift-only path at lines 145-153 and 162-173.

### `applyExecutablePermissions` — no changes

`modeOnly` results have `action: "update"`, so they pass the skip guard at line 208. `modeCache` is now populated for createOnly files, so line 213 reads the correct value.

### Downstream — no changes

- `commit-push-manager.ts`: filters `action !== "skip"` — `modeOnly` has `action: "update"`, passes.
- `file-sync-orchestrator.ts`: same filter, passes.
- `FileWriteResult` type: already has `mode?` and `modeOnly?` fields.
- `FileActionKind` union: already includes `"update"`.

## Test Plan

Three new test cases in `file-writer-mode-drift.test.ts`:

1. **createOnly + exists + mode drifted (100644 → 100755)**: `.sh` file with `createOnly: true`, exists on base, current mode `100644`. Should emit `{ action: "update", modeOnly: true, mode: "100755" }` and call `setExecutable`.
1. **createOnly + exists + mode correct**: `.sh` file with `createOnly: true`, exists on base, current mode `100755`. Should emit explicit `{ action: "skip" }` entry (not absent — createOnly always records a skip entry for logging), no `modeOnly` field, no mode change.
1. **createOnly + exists + mode drifted + dryRun**: Same as #1 but dryRun. Should log "Would change mode" and increment diffStats, no `setExecutable` call.

Existing createOnly skip test in `file-writer.test.ts` needs minor update: add `getFileMode` mock returning `"100755"` (matching mode) so the new code path computes mode before emitting `skip`. Test assertion unchanged.

## Scope

- **Modified**: `src/sync/file-writer.ts` — `processOneFile` method only
- **Added**: 3 test cases in `test/unit/sync/file-writer-mode-drift.test.ts`
- **Unchanged**: types, downstream consumers, `applyExecutablePermissions`
