# Phase 1: Strategy Reorganization + Coverage Config

## Overview

Reorganize strategies into domain folders, rename `src/git/` to `src/vcs/`, and update coverage exclusion configs.

## Goals

- Eliminate `src/strategies/` folder
- Move strategies to their natural domain homes
- Rename `src/git/` → `src/vcs/` (better reflects scope)
- Follow `types.ts` pattern for interface-only files
- Update codecov.yml and package.json exclusions

## File Moves

### Rename git → vcs

| Current                            | New                                |
| ---------------------------------- | ---------------------------------- |
| `src/git/git-ops.ts`               | `src/vcs/git-ops.ts`               |
| `src/git/authenticated-git-ops.ts` | `src/vcs/authenticated-git-ops.ts` |
| `src/git/pr-creator.ts`            | `src/vcs/pr-creator.ts`            |
| `src/git/index.ts`                 | `src/vcs/index.ts`                 |

### Move to src/vcs/

| Current                                      | New                                   |
| -------------------------------------------- | ------------------------------------- |
| `src/strategies/pr-strategy.ts`              | `src/vcs/pr-strategy.ts`              |
| `src/strategies/github-pr-strategy.ts`       | `src/vcs/github-pr-strategy.ts`       |
| `src/strategies/azure-pr-strategy.ts`        | `src/vcs/azure-pr-strategy.ts`        |
| `src/strategies/gitlab-pr-strategy.ts`       | `src/vcs/gitlab-pr-strategy.ts`       |
| `src/strategies/commit-strategy.ts`          | `src/vcs/commit-strategy.ts`          |
| `src/strategies/git-commit-strategy.ts`      | `src/vcs/git-commit-strategy.ts`      |
| `src/strategies/graphql-commit-strategy.ts`  | `src/vcs/graphql-commit-strategy.ts`  |
| `src/strategies/commit-strategy-selector.ts` | `src/vcs/commit-strategy-selector.ts` |

### Move to src/settings/rulesets/

| Current                                     | New                                                |
| ------------------------------------------- | -------------------------------------------------- |
| `src/strategies/ruleset-strategy.ts`        | `src/settings/rulesets/ruleset-strategy.ts`        |
| `src/strategies/github-ruleset-strategy.ts` | `src/settings/rulesets/github-ruleset-strategy.ts` |

### Move to src/settings/repo-settings/

| Current                                           | New                                                           |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `src/strategies/repo-settings-strategy.ts`        | `src/settings/repo-settings/repo-settings-strategy.ts`        |
| `src/strategies/github-repo-settings-strategy.ts` | `src/settings/repo-settings/github-repo-settings-strategy.ts` |

### Delete

- `src/strategies/index.ts` - move `getPRStrategy()` to `src/vcs/index.ts`
- `src/strategies/` folder

## New Types Files

Extract interfaces from strategy files to follow `types.ts` pattern:

### src/vcs/types.ts

From `pr-strategy.ts`:

- `PRMergeConfig`
- `MergeResult`
- `PRStrategyOptions`
- `MergeOptions`
- `CloseExistingPROptions`
- `IPRStrategy`

From `commit-strategy.ts`:

- `FileChange`
- `CommitOptions`
- `CommitResult`
- `ICommitStrategy`

### src/settings/rulesets/types.ts

From `ruleset-strategy.ts`:

- `IRulesetStrategy`

### src/settings/repo-settings/types.ts

From `repo-settings-strategy.ts`:

- `RepoSettingsStrategyOptions`
- `CurrentRepoSettings`
- `IRepoSettingsStrategy`

## Test File Moves

Move test files to match source structure:

| Current                     | New                                       |
| --------------------------- | ----------------------------------------- |
| `test/strategies/*.test.ts` | Split to `test/vcs/` and `test/settings/` |
| `test/git/*.test.ts`        | `test/vcs/*.test.ts`                      |

## Coverage Config Updates

### codecov.yml

```yaml
ignore:
  # Type-only files (no executable code)
  - "src/cli/types.ts"
  - "src/config/types.ts"
  - "src/sync/types.ts"
  - "src/vcs/types.ts"
  - "src/settings/rulesets/types.ts"
  - "src/settings/repo-settings/types.ts"

  # Re-export index files (no logic, just exports)
  - "src/cli/index.ts"
  - "src/config/index.ts"
  - "src/sync/index.ts"
  - "src/vcs/index.ts"
  - "src/shared/index.ts"
  - "src/output/index.ts"
  - "src/settings/index.ts"
  - "src/settings/rulesets/index.ts"
  - "src/settings/repo-settings/index.ts"

  # Test utilities
  - "test/mocks/**"
```

### package.json test:coverage

Update `--exclude` patterns to match new structure:

- Remove old `src/strategies/` exclusions
- Add new `src/vcs/types.ts` exclusion
- Add index file exclusions

## Implementation Steps

1. [ ] Create branch from main
2. [ ] Rename `src/git/` → `src/vcs/`
3. [ ] Update all imports referencing `src/git/`
4. [ ] Create `src/vcs/types.ts` with extracted interfaces
5. [ ] Move PR strategies to `src/vcs/`
6. [ ] Move commit strategies to `src/vcs/`
7. [ ] Update `src/vcs/index.ts` with all exports + `getPRStrategy()`
8. [ ] Create `src/settings/rulesets/types.ts` with extracted interfaces
9. [ ] Move ruleset strategies to `src/settings/rulesets/`
10. [ ] Update `src/settings/rulesets/index.ts`
11. [ ] Create `src/settings/repo-settings/types.ts` with extracted interfaces
12. [ ] Move repo-settings strategies to `src/settings/repo-settings/`
13. [ ] Update `src/settings/repo-settings/index.ts`
14. [ ] Delete `src/strategies/` folder
15. [ ] Move test files to match new structure
16. [ ] Update `codecov.yml`
17. [ ] Update `package.json` test:coverage script
18. [ ] Run `npm test` - verify all pass
19. [ ] Run `./lint.sh` - verify clean
20. [ ] Create PR

## Validation

- [ ] `npm test` passes
- [ ] `./lint.sh` passes
- [ ] `npm run build` succeeds
- [ ] No references to `src/git/` or `src/strategies/` remain
