# PR Labels Support - Design

**Issue:** [#129](https://github.com/anthony-spruyt/xfg/issues/129)
**Date:** 2026-02-26

## Summary

Add support for automatically applying labels to PRs created during sync. GitHub only for the initial implementation, with the architecture ready for Azure DevOps and GitLab.

## Configuration

### Types

Add `labels?: string[]` to `PRMergeOptions` in `types.ts`:

```typescript
export interface PRMergeOptions {
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
  bypassReason?: string;
  labels?: string[]; // NEW
}
```

### Schema

Add `labels` to the `prOptions` definition in `config-schema.json` (repository root):

```json
"labels": {
  "type": "array",
  "items": { "type": "string" },
  "description": "Labels to apply to created PRs"
}
```

### User config

```yaml
prOptions:
  labels: ["config-sync", "automated"]

repos:
  - git: "org/repo"
    prOptions:
      labels: ["critical-config"] # replaces global labels
```

## Decisions

| Decision             | Choice                 | Rationale                                                                                                                                     |
| -------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Label timing         | During PR creation     | Simpler, one CLI call, all platforms support it                                                                                               |
| Per-repo override    | Replace, not merge     | Per-repo array replaces (not merges with) global; falls back to global when absent. Consistent with existing `mergePROptions()` `??` behavior |
| Missing labels       | Fail loudly            | Config error the user should fix                                                                                                              |
| Platform scope       | GitHub only            | Ship incrementally; ADO/GitLab in follow-up issues                                                                                            |
| Non-GitHub platforms | Silently ignore labels | No warning, no error; field flows through config but isn't acted on                                                                           |

## Normalizer

In `mergePROptions()` in `src/config/normalizer.ts`, add labels following the existing conditional assignment pattern:

```typescript
const labels = perRepo.labels ?? global.labels;
if (labels !== undefined) result.labels = labels;
```

Note: `labels: []` at per-repo level explicitly clears global labels (empty array is not `undefined`).

## PR Creation Flow

Full call chain with required changes:

1. `PRMergeHandler.createAndMerge()` in `src/sync/pr-merge-handler.ts` — pass `labels: repoConfig.prOptions?.labels` to `createPR()`
2. `createPR()` in `src/vcs/pr-creator.ts` — destructure `labels` from `PROptions` and include it in the `PRStrategyOptions` object literal passed to `strategy.execute()`
3. `PRWorkflowExecutor.execute()` in `src/vcs/pr-strategy.ts` — passes `PRStrategyOptions` through to `strategy.create()` (no change needed)
4. `GitHubPRStrategy.create()` in `src/vcs/github-pr-strategy.ts` — append `--label ${escapeShellArg(label)}` for each label to the `gh pr create` command

### Interfaces that need `labels?: string[]`

| Interface           | File                    | Purpose                         |
| ------------------- | ----------------------- | ------------------------------- |
| `PRMergeOptions`    | `src/config/types.ts`   | Config type                     |
| `PROptions`         | `src/vcs/pr-creator.ts` | Input to `createPR()`           |
| `PRStrategyOptions` | `src/vcs/types.ts`      | Input to `IPRStrategy.create()` |

`IPRStrategy` in `src/vcs/types.ts` is implicitly updated since `create()` takes `PRStrategyOptions`.

Command output:

```
gh pr create --title "..." --body-file "..." --base main --head chore/sync-config --label "config-sync" --label "automated"
```

Label values must be escaped with `escapeShellArg()` from `src/shared/shell-utils.ts`, consistent with all other `gh` command arguments.

## Other Platform Strategies

Azure DevOps (`src/vcs/azure-pr-strategy.ts`) and GitLab (`src/vcs/gitlab-pr-strategy.ts`) strategies ignore labels silently for now — they receive `labels` via `PRStrategyOptions` but don't use it. No code changes needed in those files.

## Validation

JSON schema handles type validation (array of strings). `validateForSync()` can add a semantic check that labels don't contain empty strings.

## Testing

- Unit tests for `mergePROptions()` with labels (replace behavior)
- Unit tests for `GitHubPRStrategy` verifying `--label` flags in the command
- Unit tests for config schema validation (valid array, invalid types)

## Documentation

- Update docs with `labels` in prOptions examples

## Scope

**In scope:**

- `labels?: string[]` on `PRMergeOptions`
- Config schema update
- `mergePROptions()` with simple replace
- `GitHubPRStrategy` appends `--label` flags during `gh pr create`
- Unit tests
- Docs update

**Out of scope (future issues):**

- Azure DevOps label support
- GitLab label support
- CLI `--label` flag override
- `$arrayMerge` directive support for labels
