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

Note: `toCreateRepoSettings` returns `undefined` when no recognised fields are present. A config with only `defaultBranch` set will produce `{ defaultBranch: "..." }` (`Object.keys(result).length === 1`), so the early-return guard is not a problem — the settings object reaches `create()` and `receiveMigration()` as expected.

Note: `runLifecycleCheck` (`lifecycle-helpers.ts`) passes only `visibility` and `description` to `formatLifecycleAction`, so `defaultBranch` will not appear in the lifecycle output log. The destructuring produces `{ visibility: undefined, description: undefined }` when only `defaultBranch` is set; `formatLifecycleAction` treats fields that are `undefined` the same as an absent `settings` object, so no spurious output is generated. Branch rename is a one-time operation that throws on failure, so silent success is acceptable. Extending the formatter is out of scope.

### Create path

In `GitHubLifecycleProvider.create()`, after `gh repo create --add-readme`, before `deleteReadme`:

1. If `settings.defaultBranch` is set, call `gh api {hostnameFlag} /repos/{owner}/{repo} --jq '.default_branch'` to detect the actual created branch name (using `getHostnameFlag(repoInfo)` as with all existing API calls in this method). This call uses `withRetry` with `postCreatePermanentPatterns` to tolerate post-creation eventual consistency (the repo itself may not yet be visible).
2. If it differs from desired, call `POST /repos/{owner}/{repo}/branches/{current}/rename` with `{"new_name": desired}` (same `hostnameFlag`; wrapped in plain `withRetry` with default permanent patterns — a 404 here is a genuine error indicating the branch no longer exists, not eventual consistency) — GitHub automatically updates the default branch pointer, and also updates any existing branch protection rules and open PRs targeting the old branch name. If the API call fails, the error propagates and `deleteReadme` is not reached.
3. `deleteReadme` proceeds unchanged (uses content SHA lookup, not branch name)

If `settings.defaultBranch` is unset — no extra API calls, existing behaviour.

> **Dry-run:** Dry-run mode is short-circuited at the `RepoLifecycleManager` level before `provider.create()` is called, so none of the above executes during a dry-run.

### Migration path

In `GitHubLifecycleProvider.receiveMigration()`, after stripping non-standard refs, before `gh repo create --source --push`:

> Note: `{sourceDir}` is a **bare mirror clone** (`git clone --mirror`). Both `git branch -m` and `git symbolic-ref` operate correctly on bare repositories.

1. If `settings.defaultBranch` is set, read source HEAD: `git -C {sourceDir} symbolic-ref HEAD` → strip `refs/heads/` prefix → `sourceBranch`. Two failure paths: (a) if `git symbolic-ref HEAD` exits non-zero (e.g., detached HEAD), the executor throws and the error propagates naturally; (b) if it exits zero but the output does not start with `refs/heads/` (broken symref edge case), throw explicitly with a descriptive message.
2. If `sourceBranch` differs from `defaultBranch`:
   ```
   git -C {sourceDir} branch -m {sourceBranch} {defaultBranch}
   git -C {sourceDir} symbolic-ref HEAD refs/heads/{defaultBranch}
   ```
   Note: `git branch -m` on a bare repo automatically updates `HEAD` when renaming the HEAD-pointed branch, so the `symbolic-ref` update is a safety belt for any edge case where that does not happen. Both commands are harmless to run together.
3. Push proceeds — GitHub receives `{defaultBranch}` as HEAD, creating the repo with the correct default branch from day one

If `settings.defaultBranch` is unset — no rename, existing behaviour.

> **Dry-run:** Dry-run mode is short-circuited at the `RepoLifecycleManager` level before `provider.receiveMigration()` is called, so none of the above executes during a dry-run.

## Files Changed

| File                                            | Change                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lifecycle/types.ts`                        | Add `defaultBranch?: string` to `CreateRepoSettings`                                                                                                                           |
| `src/lifecycle/lifecycle-helpers.ts`            | Map `defaultBranch` in `toCreateRepoSettings`                                                                                                                                  |
| `src/lifecycle/github-lifecycle-provider.ts`    | Branch rename logic in `create()` and `receiveMigration()`; private `renameBranch(repoInfo, current, desired)` helper that wraps the `POST /branches/{branch}/rename` API call |
| `docs/configuration/lifecycle.md`               | Document new behaviour in Creation Settings table and Migration section                                                                                                        |
| `test/integration/github-lifecycle.test.ts`     | Integration tests — PAT auth (see below)                                                                                                                                       |
| `test/integration/github-lifecycle-app.test.ts` | Integration tests — GitHub App auth (mirrors PAT tests, consistent with existing coverage)                                                                                     |

## Testing

### Unit tests

- `create()` with `defaultBranch` set, GitHub created a different name → rename called
- `create()` with `defaultBranch` set, matches GitHub's created name → no rename called
- `create()` without `defaultBranch` → no extra API calls
- `create()` with `defaultBranch` set, rename API call fails → error propagates (does not proceed to `deleteReadme`)
- `receiveMigration()` with `defaultBranch` set, source HEAD differs → git rename applied
- `receiveMigration()` with `defaultBranch` matching source HEAD → no rename
- `receiveMigration()` without `defaultBranch` → no rename, no git ops
- `receiveMigration()` with `defaultBranch` set, `symbolic-ref HEAD` returns value not starting with `refs/heads/` → throws descriptive error
- `fork()` with `defaultBranch` set → `renameBranch` is never called and `fork()` completes without error

### Integration tests

Added to both `test/integration/github-lifecycle.test.ts` (PAT, CI job `integration-test-cli-lifecycle-github-pat`, concurrency group `integration-github-8`) and `test/integration/github-lifecycle-app.test.ts` (GitHub App, concurrency group `integration-github-9`). Both use ephemeral repos.

**Test 1 — migrate with defaultBranch rename (`master` → `main`)**

- Source: `https://dev.azure.com/aspruyt/fxg/_git/fxg-test` (default branch: `master`)
- Config: `settings.repo.defaultBranch: main`
- Assert: `gh api repos/{owner}/{repoName} --jq '.default_branch'` returns `main`
- Gated: `{ skip: !HAS_ADO_CREDS }` — requires `AZURE_DEVOPS_EXT_PAT`

**Test 2 — create with defaultBranch**

- Config: `settings.repo.defaultBranch: main`
- Assert: created repo's default branch is `main`
- Gated: none — runs unconditionally (consistent with other create tests in both files)

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
