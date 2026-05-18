# Design: `prOptions.branch` in Config YAML

**Issue:** [#563](https://github.com/anthony-spruyt/xfg/issues/563) **Date:** 2026-05-18

## Problem

Branch name for sync PRs can only be controlled via CLI `--branch` flag. No declarative YAML equivalent exists. `prOptions.branch` in config is silently ignored.

## Design

Add `branch` field to `PRMergeOptions`. Resolve via the existing prOptions merge pipeline.

### Priority Chain

```text
CLI --branch > per-repo prOptions.branch > group prOptions.branch > global prOptions.branch > auto-generated from filenames
```

The normalizer already resolves group layers via `mergePROptions()` spread semantics (per-repo overrides group, group overrides global). By the time `repoConfig.prOptions` reaches `runSingleRepo`, group merging is complete — no additional group handling needed at runtime.

### Config Syntax

```yaml
prOptions:
  branch: chore/my-custom-branch
groups:
  team-a:
    prOptions:
      branch: chore/team-a-sync
repos:
  - git: https://github.com/org/repo.git
    prOptions:
      branch: chore/repo-specific-branch
```

## Changes

### 1. `PRMergeOptions` interface (`src/config/types.ts`)

Add `branch?: string` field.

### 2. Move `validateBranchName()` to shared (`src/shared/branch-validation.ts`)

`src/config/` must not depend on `src/cli/` (architecture rule). Move branch name validation logic to `src/shared/` so both config validator and CLI can import from the same shared location.

### 3. Config validator (`src/config/validator.ts`)

Validate `prOptions.branch` using `validateBranchName()` from `src/shared/branch-validation.ts`. Apply to:

- Global `prOptions.branch`
- Per-repo `prOptions.branch`
- Group `prOptions.branch`

Validation runs on raw config before normalization (same phase as existing `prOptions.labels` validation). Each layer is validated independently: global prOptions, each group's prOptions, and each repo's prOptions. This catches invalid branch names at the source layer rather than only after merge.

### 4. `effectivePrOptions` merge (`src/cli/repo-sync-runner.ts:172-182`)

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

### 5. Branch resolution (`src/cli/repo-sync-runner.ts` — `runFileSyncPhase`)

Replace `ctx.branchName` with per-repo resolution:

```typescript
const branchName = repo.repoConfig.prOptions?.branch ?? ctx.branchName;
```

At this point `repo.repoConfig.prOptions` contains the fully-merged result: CLI override (from step 4) > per-repo > group > global. The `ctx.branchName` fallback is the auto-generated name from filenames.

### 6. Validation in `sync-command.ts`

**Decision:** Keep CLI validation in sync-command (fail-fast). Add YAML validation in config validator. Both import `validateBranchName()` from `src/shared/branch-validation.ts`.

### 7. Logging

**Decision:** Keep existing log as-is. Per-repo branch shows in per-repo progress output already.

## What Does NOT Change

- `generateBranchName()` — still used as fallback
- `ProcessorOptions.branchName` — still the interface to the processor
- `mergePROptions()` — already handles spread override, `branch` field merges automatically
- `RepoIterationContext.branchName` — remains as global fallback

## PR Reuse Behavior

When two repos share the same `prOptions.branch` value, they will find and reuse each other's PRs (via `findExistingPRUrl(branchName)`). This is **existing behavior** — same thing happens today when CLI `--branch` is used with multiple repos. No change needed.

Users wanting per-repo isolation must use distinct branch names per repo.

Note: `${xfg:repo.name}` template interpolation is **not** currently applied to `prOptions` fields (only file content and PR body templates). Supporting xfg templates in `prOptions.branch` is a separate future enhancement, out of scope for this change.

## Testing

- Unit test: `mergePROptions` merges `branch` correctly (global, per-repo, override)
- Unit test: config validator rejects invalid branch names in `prOptions.branch`
- Unit test: `effectivePrOptions` resolves CLI > per-repo > global > auto-generated
- Unit test: group-layered `prOptions.branch` respects per-repo > group > global order
- Unit test: `validateBranchName()` works from shared location (both CLI and validator import)
- Integration test: YAML with `prOptions.branch` creates PR on correct branch
- Integration test: per-repo override creates different branches per repo

## Edge Cases

- `prOptions.branch` with `merge: direct` — branch still used for the push (no PR created, but branch name matters)
- Empty string — validator rejects
- Branch name with invalid chars — validator rejects (same rules as CLI `--branch`)
- CLI `--branch` + per-repo `prOptions.branch` — CLI wins for all repos (explicit override)
- Two repos with same `prOptions.branch` — PR reuse (documented above, matches existing CLI behavior)
- Group sets branch, per-repo overrides — per-repo wins via `mergePROptions()` spread

## Backward Compatibility

Previously, `prOptions.branch` in config YAML was silently ignored (not a recognized field). Configs that had this field with an invalid branch name will now fail validation. This is correct behavior — the field was never functional, so no working configs will break. Invalid values should surface as errors rather than being silently accepted.
