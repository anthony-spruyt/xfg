# Design: `settings.repo.defaultBranch` in Lifecycle Operations

**Issue:** [#541](https://github.com/anthony-spruyt/xfg/issues/541)
**Date:** 2026-02-26

## Problem

When migrating a repo from ADO to GitHub, the default branch name carries over verbatim from the source. If the ADO repo uses `master`, the GitHub repo is created with `master` as its default branch. There is no way to rename it during migration.

Additionally, when xfg creates a brand-new repo, the default branch name is whatever the GitHub org/user default is — also not configurable today.

The existing `settings.repo.defaultBranch` field only updates GitHub's API pointer via PATCH (which requires the branch to already exist by that name), so it cannot rename a branch that was created under a different name.

## Decision

Extend `settings.repo.defaultBranch` to carry meaning during **lifecycle operations** (create and migrate). No new config fields are introduced.

### Behaviour by lifecycle phase

| Phase                     | `settings.repo.defaultBranch` set | Behaviour                                                                                                                            |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Create**                | Yes                               | After `gh repo create --add-readme`, detect actual branch name, rename via GitHub branch rename API if different, then delete README |
| **Create**                | No                                | Existing behaviour — branch name is whatever GitHub's org default is                                                                 |
| **Migrate**               | Yes                               | Before pushing mirror clone, rename source HEAD branch in git if it differs from desired name                                        |
| **Migrate**               | No                                | Existing behaviour — branch name carries over from source                                                                            |
| **Fork**                  | Yes/No                            | Ignored — forked repos inherit the upstream's branch structure                                                                       |
| **Settings pass (day-2)** | Yes                               | Existing behaviour — PATCH GitHub API pointer (branch must already exist)                                                            |

### Example config

```yaml
# Create new repo with 'main' as default branch
settings:
  repo:
    defaultBranch: main

repos:
  - git: git@github.com:my-org/new-repo.git

---
# Migrate ADO repo with 'master', rename to 'main' on GitHub
repos:
  - git: git@github.com:my-org/migrated-app.git
    source: https://dev.azure.com/myorg/myproject/_git/legacy-app
    settings:
      repo:
        defaultBranch: main
```

## Architecture

### Data flow

`toCreateRepoSettings` (`lifecycle-helpers.ts`) gains one new mapping:

```ts
if (repo.defaultBranch !== undefined) result.defaultBranch = repo.defaultBranch;
```

`CreateRepoSettings` (`lifecycle/types.ts`) gains `defaultBranch?: string`. The `fork()` path already ignores fields it doesn't use in `applyRepoSettings` — no change needed there.

### Create path

In `GitHubLifecycleProvider.create()`, after `gh repo create --add-readme`, before `deleteReadme`:

1. If `settings.defaultBranch` is set, call `gh api /repos/{owner}/{repo} --jq '.default_branch'` to detect the actual created branch name
2. If it differs from desired, call `POST /repos/{owner}/{repo}/branches/{current}/rename` with `{"new_name": desired}` — GitHub automatically updates the default branch pointer
3. `deleteReadme` proceeds unchanged (uses content SHA lookup, not branch name)

If `settings.defaultBranch` is unset — no extra API calls, existing behaviour.

### Migration path

In `GitHubLifecycleProvider.receiveMigration()`, after stripping non-standard refs, before `gh repo create --source --push`:

1. If `settings.defaultBranch` is set, read source HEAD: `git -C {sourceDir} symbolic-ref HEAD` → strip `refs/heads/` prefix → `sourceBranch`
2. If `sourceBranch` differs from `defaultBranch`:
   ```
   git -C {sourceDir} branch -m {sourceBranch} {defaultBranch}
   git -C {sourceDir} symbolic-ref HEAD refs/heads/{defaultBranch}
   ```
3. Push proceeds — GitHub receives `{defaultBranch}` as HEAD, creating the repo with the correct default branch from day one

If `settings.defaultBranch` is unset — no rename, existing behaviour.

## Files Changed

| File                                         | Change                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/lifecycle/types.ts`                     | Add `defaultBranch?: string` to `CreateRepoSettings`                                        |
| `src/lifecycle/lifecycle-helpers.ts`         | Map `defaultBranch` in `toCreateRepoSettings`                                               |
| `src/lifecycle/github-lifecycle-provider.ts` | Branch rename logic in `create()` and `receiveMigration()`; private `renameBranch()` helper |
| `docs/configuration/lifecycle.md`            | Document new behaviour in Creation Settings table and Migration section                     |
| `test/integration/github-lifecycle.test.ts`  | Integration tests (see below)                                                               |

## Testing

### Unit tests

- `create()` with `defaultBranch` set, GitHub created a different name → rename called
- `create()` with `defaultBranch` set, matches GitHub's created name → no rename called
- `create()` without `defaultBranch` → no extra API calls
- `receiveMigration()` with `defaultBranch` set, source HEAD differs → git rename applied
- `receiveMigration()` with `defaultBranch` matching source HEAD → no rename
- `receiveMigration()` without `defaultBranch` → no rename, no git ops
- `fork()` with `defaultBranch` set → ignored

### Integration tests

Added to `test/integration/github-lifecycle.test.ts` (uses ephemeral repos, skipped without ADO creds):

**Test 1 — migrate with defaultBranch rename (`master` → `main`)**

- Source: `https://dev.azure.com/aspruyt/fxg/_git/xfg-test-2` (default branch: `master`)
- Config: `settings.repo.defaultBranch: main`
- Assert: `gh api repos/{owner}/{repoName} --jq '.default_branch'` returns `main`

**Test 2 — create with defaultBranch**

- Config: `settings.repo.defaultBranch: main`
- Assert: created repo's default branch is `main`

## Alternatives Considered

### New top-level `defaultBranch` field (issue's original proposal)

```yaml
repos:
  - git: ...
    source: ...
    defaultBranch: main
```

Rejected: introduces a new config field that duplicates intent with `settings.repo.defaultBranch`. Zero config surface change is a significant win.

### `sourceDefaultBranch` + `targetDefaultBranch` pair

Rejected: `sourceDefaultBranch` is redundant — the mirror clone's HEAD symref auto-detects the source branch. Adds verbosity for no gain in the common case.
