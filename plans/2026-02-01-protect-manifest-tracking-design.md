# Protect Command Manifest Tracking Design

**Issue:** State tracking for `deleteOrphaned` in protect command
**Date:** 2026-02-01
**Status:** Approved

## Overview

The `protect` command manages GitHub Rulesets via API but currently lacks state tracking for `deleteOrphaned`. Without tracking which rulesets are managed, orphan deletion cannot work - the command doesn't know which rulesets it previously created.

## Problem

Current protect flow:

1. Process rulesets via GitHub API
2. `RulesetProcessor` computes `manifestUpdate` with rulesets to track
3. **Gap:** `manifestUpdate` is never persisted to `.xfg.json`
4. Result: `deleteOrphaned` has no state to compare against

## Solution

Add `updateManifestOnly()` method to `RepositoryProcessor` that:

1. Clones the repo
2. Loads existing `.xfg.json` manifest
3. Calls `updateManifestRulesets()` with new ruleset names
4. Commits updated manifest via existing commit/PR workflow
5. Honors `prOptions.merge` strategy (direct, pr, auto, force)

## Design

### New Method: `RepositoryProcessor.updateManifestOnly()`

```typescript
async updateManifestOnly(
  repoInfo: RepoInfo,
  repoConfig: RepoConfig,
  options: ProcessorOptions,
  manifestUpdate: { rulesets: string[] }
): Promise<ProcessorResult>
```

**Parameters:**

- `repoInfo` - Repository info (owner, repo, host)
- `repoConfig` - Config with `prOptions` for merge strategy
- `options` - Processor options (branchName, workDir, configId, dryRun)
- `manifestUpdate` - Rulesets to track (from `RulesetProcessor.process()`)

**Flow:**

1. Clone repo (reuses existing `gitOps.clone()`)
2. Get default branch (reuses existing)
3. Load manifest via `loadManifest(workDir)`
4. Call `updateManifestRulesets(manifest, configId, rulesetsMap)`
5. If `rulesetsToDelete.length > 0` - these are orphans (protect already deleted them via API)
6. If manifest changed:
   - Create branch (unless direct mode)
   - Save manifest via `saveManifest()`
   - Commit via `commitStrategy.commit()`
   - Create PR via `createPR()` (unless direct mode)
   - Handle merge via `mergePR()` (if auto/force mode)
7. Return result with PR URL

### Updated Protect Flow in `index.ts`

```typescript
// In runProtect():
for (const repoConfig of reposWithRulesets) {
  // 1. Process rulesets via API (existing)
  const result = await processor.process(repoConfig, repoInfo, options);

  // 2. Update manifest if needed (new)
  if (result.success && result.manifestUpdate && !options.dryRun) {
    const manifestResult = await repoProcessor.updateManifestOnly(
      repoInfo,
      repoConfig,
      processorOptions,
      result.manifestUpdate
    );
    // Combine results...
  }
}
```

### Manifest Update Logic

Using existing `updateManifestRulesets()` from `manifest.ts`:

```typescript
// Build map of rulesets with deleteOrphaned status
const rulesetsMap = new Map<string, boolean | undefined>();
for (const rulesetName of manifestUpdate.rulesets) {
  rulesetsMap.set(rulesetName, true); // All tracked rulesets have deleteOrphaned: true
}

const { manifest, rulesetsToDelete } = updateManifestRulesets(
  existingManifest,
  configId,
  rulesetsMap
);
```

## Files to Modify

| File                          | Change                                               |
| ----------------------------- | ---------------------------------------------------- |
| `src/repository-processor.ts` | Add `updateManifestOnly()` method                    |
| `src/index.ts`                | Call `updateManifestOnly()` in protect flow          |
| `src/ruleset-processor.ts`    | Ensure `manifestUpdate` includes deleteOrphaned info |

## Edge Cases

1. **No manifest exists** - Create new V3 manifest
2. **V2 manifest exists** - Migration handled by `loadManifest()`
3. **No changes to manifest** - Skip commit/PR, return success
4. **PR creation fails** - Return failure but rulesets already applied
5. **Dry-run mode** - Show what manifest changes would occur

## Testing

1. Unit tests for `updateManifestOnly()` method
2. Integration test: protect creates ruleset, verify manifest updated
3. Integration test: remove ruleset from config, verify orphan deleted
4. Test all merge modes: direct, pr, auto, force

## Migration

No migration needed - existing manifests work as-is. V2 manifests auto-migrate to V3 on read.
