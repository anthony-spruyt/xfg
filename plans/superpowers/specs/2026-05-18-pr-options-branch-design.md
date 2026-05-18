# Design: `prOptions.branch` in Config YAML

**Issue:** [#563](https://github.com/anthony-spruyt/xfg/issues/563) **Date:** 2026-05-18

## Problem

Branch name for sync PRs can only be controlled via CLI `--branch` flag. No declarative YAML equivalent exists. `prOptions.branch` in config is silently ignored.

## Design

Add `branch` field to `PRMergeOptions`. Resolve via the existing prOptions merge pipeline.

### Priority Chain

```text
CLI --branch > per-repo prOptions.branch > global prOptions.branch > auto-generated from filenames
```

### Config Syntax

```yaml
prOptions:
  branch: chore/my-custom-branch
repos:
  - git: https://github.com/org/repo.git
    prOptions:
      branch: chore/repo-specific-branch
```

## Changes

### 1. `PRMergeOptions` interface (`src/config/types.ts`)

Add `branch?: string` field.

### 2. Config validator (`src/config/validator.ts`)

Validate `prOptions.branch` using existing `validateBranchName()` from `src/cli/branch-utils.ts`. Apply to both global and per-repo prOptions.

### 3. `effectivePrOptions` merge (`src/cli/repo-sync-runner.ts:172-182`)

Add CLI `--branch` override to the effectivePrOptions conditional:

```typescript
const effectivePrOptions =
  options.merge || options.mergeStrategy || options.deleteBranch || options.branch
    ? {
        ...repoConfig.prOptions,
        merge: options.merge ?? repoConfig.prOptions?.merge,
        mergeStrategy: options.mergeStrategy ?? repoConfig.prOptions?.mergeStrategy,
        deleteBranch: options.deleteBranch ?? repoConfig.prOptions?.deleteBranch,
        branch: options.branch ?? repoConfig.prOptions?.branch,
      }
    : repoConfig.prOptions;
```

### 4. Branch resolution (`src/cli/repo-sync-runner.ts` — `runFileSyncPhase`)

Replace `ctx.branchName` with per-repo resolution:

```typescript
const branchName = repo.repoConfig.prOptions?.branch ?? ctx.branchName;
```

Where `ctx.branchName` remains the auto-generated fallback (set in `sync-command.ts` only when CLI `--branch` is absent).

### 5. Validation in `sync-command.ts`

Remove early CLI branch validation from sync-command — branch validation now happens in config validator for YAML values, and in the effectivePrOptions merge for CLI values. Or keep CLI validation where it is (fail-fast for obvious typos) and add YAML validation in config validator.

**Decision:** Keep CLI validation in sync-command (fail-fast). Add YAML validation in config validator. Both use same `validateBranchName()`.

### 6. Logging

Update branch log line in `sync-command.ts:124` to indicate "per-repo" when global prOptions.branch is set but repos may override. Or keep as-is since per-repo resolution happens later.

**Decision:** Keep existing log as-is. Per-repo branch shows in per-repo progress output already.

## What Does NOT Change

- `generateBranchName()` — still used as fallback
- `ProcessorOptions.branchName` — still the interface to the processor
- `mergePROptions()` — already handles spread override, `branch` field merges automatically
- `RepoIterationContext.branchName` — remains as global fallback

## Testing

- Unit test: `mergePROptions` merges `branch` correctly (global, per-repo, override)
- Unit test: config validator rejects invalid branch names in `prOptions.branch`
- Unit test: `effectivePrOptions` resolves CLI > per-repo > global > auto-generated
- Integration test: YAML with `prOptions.branch` creates PR on correct branch
- Integration test: per-repo override creates different branches per repo

## Edge Cases

- `prOptions.branch` with `merge: direct` — branch still used for the push (no PR created, but branch name matters)
- Empty string — validator rejects
- Branch name with invalid chars — validator rejects (same rules as CLI `--branch`)
- CLI `--branch` + per-repo `prOptions.branch` — CLI wins for all repos (explicit override)
