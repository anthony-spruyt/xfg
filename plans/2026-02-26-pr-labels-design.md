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

Add `labels` to the `prOptions` definition in `config-schema.json`:

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

| Decision             | Choice                 | Rationale                                                           |
| -------------------- | ---------------------- | ------------------------------------------------------------------- |
| Label timing         | During PR creation     | Simpler, one CLI call, all platforms support it                     |
| Per-repo override    | Simple replace         | Consistent with existing `mergePROptions()` behavior                |
| Missing labels       | Fail loudly            | Config error the user should fix                                    |
| Platform scope       | GitHub only            | Ship incrementally; ADO/GitLab in follow-up issues                  |
| Non-GitHub platforms | Silently ignore labels | No warning, no error; field flows through config but isn't acted on |

## Normalizer

In `mergePROptions()`, add labels with the same `??` pattern:

```typescript
const labels = perRepo.labels ?? global.labels;
```

## PR Creation Flow

1. `PRMergeHandler.createAndMerge()` already has access to `repoConfig.prOptions`
2. Pass `labels` through to `createPR()` via the `PROptions` interface
3. `GitHubPRStrategy.create()` appends `--label` flags to `gh pr create`

Command output:

```
gh pr create --title "..." --body-file "..." --base main --head chore/sync-config --label "config-sync" --label "automated"
```

## Other Platform Strategies

Azure DevOps and GitLab strategies ignore labels silently for now. The `labels` field flows through config normalization for all platforms, it just won't be acted on yet.

## Validation

JSON schema handles type validation. `validateForSync()` can add a semantic check that labels don't contain empty strings.

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
