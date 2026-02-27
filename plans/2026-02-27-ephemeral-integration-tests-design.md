# Ephemeral Integration Tests Design

**Issue:** #558
**Date:** 2026-02-27

## Problem

Integration tests use persistent pre-created repos (`xfg-test` through `xfg-test-8`) reset via `reset-test-repo.sh`. The reset script is fragile (transient API failures, complex multi-step cleanup), and state leakage between runs is possible if reset fails partway.

## Solution

Migrate all 8 persistent-repo jobs to ephemeral repos with unique names per test run. Delete repos in cleanup. Remove `reset-test-repo.sh`. Remove concurrency groups from all GitHub jobs (ephemeral repos can't collide).

## Decisions

- **Owner:** `spruyt-labs` (org) for all ephemeral repos. `gh repo delete` works reliably on org repos. XFG Test App already installed on this org.
- **Secret:** `GH_PAT_ORG` replaces `GH_PAT` for all migrated jobs.
- **Approach:** Lift-and-shift each test file independently. No shared abstraction beyond `test-helpers.ts`.
- **Action job configs:** Generalize `create-ephemeral-repo-config.sh` to accept fixture templates with placeholder URLs (Option B).
- **Concurrency groups:** Remove from all 12 GitHub jobs (8 migrated + 4 lifecycle). ADO/GitLab keep theirs.
- **Persistent repo cleanup:** Manual deletion of `xfg-test` through `xfg-test-8` post-merge.

## Test Helpers Changes

### `generateRepoName(prefix?)`

Add optional prefix parameter, defaulting to `"lifecycle"` for backward compat.

```
xfg-${prefix}-test-${Date.now()}-${randomBytes(3).toString("hex")}
```

### `createRepo(owner, repoName)` (new)

Wraps `gh repo create ${owner}/${repoName} --private --confirm`.

## CLI Test File Pattern

Each of the 5 CLI test files (`github.test.ts`, `github-app.test.ts`, `github-rulesets.test.ts`, `github-repo-settings.test.ts`, `github-labels.test.ts`) gets:

```typescript
const OWNER = "spruyt-labs";
const reposToDelete: string[] = [];
let tmpDir: string;
let repoName: string;
let testRepo: string;

before(() => {
  tmpDir = mkdirSync(...);
  repoName = generateRepoName("<purpose>");
  testRepo = `${OWNER}/${repoName}`;
  reposToDelete.push(repoName);
  createRepo(OWNER, repoName);
});

afterEach(() => {
  for (const name of reposToDelete) deleteRepo(OWNER, name);
  reposToDelete.length = 0;
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });
```

Configs written at runtime via `writeConfig(tmpDir, yamlString)` with ephemeral repo URL interpolated. Static fixture files deleted.

### Per-file specifics

| File                           | Prefix          | Notes                                                                                                                 |
| ------------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `github.test.ts`               | `sync`          | 14 tests. All fixtures inlined. Tests that pre-create files on main swap repo name in `gh api` calls.                 |
| `github-app.test.ts`           | `app`           | `xfgEnv` strips `GH_TOKEN`. `resetRepoSettings()` and `patOnlyEnv` target ephemeral repo.                             |
| `github-rulesets.test.ts`      | `rulesets`      | 3 tests. Simple settings-only tests.                                                                                  |
| `github-repo-settings.test.ts` | `repo-settings` | No `reset-test-repo.sh` today. `resetRepoSettings()` + `resetSecuritySettings()` still needed, target ephemeral repo. |
| `github-labels.test.ts`        | `labels`        | 6 tests. Several already write inline configs.                                                                        |

## Action Job Changes

### `create-ephemeral-repo-config.sh` generalization

New signature:

```
create-ephemeral-repo-config.sh <prefix> <owner> <output-path> <fixture-path>
```

1. Generate unique repo name: `xfg-${PREFIX}-$(date +%s)-$(openssl rand -hex 3)`
2. Read fixture template from `<fixture-path>`
3. Replace placeholder `git: https://github.com/OWNER/REPO_PLACEHOLDER.git` with real ephemeral repo URL
4. Write to `<output-path>`
5. Output `repo_name` to `GITHUB_OUTPUT`

Existing lifecycle callers updated to new signature (or backward compat maintained with positional arg detection).

### Action fixture templates

3 fixture files kept as templates with placeholder URLs:

- `integration-test-action-github-pat.yaml`
- `integration-test-action-github-app.yaml`
- New `integration-test-action-github-settings.yaml`

### CI workflow steps

Replace:

```
- run: bash .github/scripts/reset-test-repo.sh $TEST_REPO
```

With:

```
- run: bash .github/scripts/create-ephemeral-repo-config.sh <prefix> <owner> <output> <fixture>
- run: bash .github/scripts/seed-manifest.sh ...  # where applicable
- ... (run action) ...
- run: bash .github/scripts/delete-ephemeral-repo.sh <owner/repo>
  if: always()
```

## CI Workflow Changes

- All 12 GitHub jobs: remove `concurrency` blocks
- 8 migrated jobs: switch `GH_TOKEN` from `GH_PAT` to `GH_PAT_ORG`
- ADO/GitLab: unchanged (keep concurrency groups)

## Files Deleted

- `.github/scripts/reset-test-repo.sh`
- ~20 static fixture YAML files (replaced by inline configs):
  - `integration-test-config-github.yaml`
  - `integration-test-direct-github.yaml`
  - `integration-test-createonly-github.yaml`
  - `integration-test-template-github.yaml`
  - `integration-test-unchanged-github.yaml`
  - `integration-test-divergent-github.yaml`
  - `integration-test-orphan-branch-github.yaml`
  - `integration-test-delete-orphaned-github.yaml`
  - `integration-test-delete-orphaned-phase2-github.yaml`
  - `integration-test-pr-labels-github.yaml`
  - `integration-test-pr-labels-override-github.yaml`
  - `integration-test-lifecycle-upstream-github.yaml`
  - `integration-test-lifecycle-source-github.yaml`
  - `integration-test-github-app.yaml`
  - `integration-test-github-app-direct.yaml`
  - `integration-test-github-app-settings.yaml`
  - `integration-test-github-app-delete-phase1.yaml`
  - `integration-test-github-app-delete-phase2.yaml`
  - `integration-test-github-app-repo-settings.yaml`
  - `integration-test-github-app-signed-refs-settings.yaml`
  - `integration-test-config-github-rulesets.yaml`
  - `integration-test-config-github-labels.yaml`

## Files Modified

- 5 CLI test files
- `test/integration/test-helpers.ts`
- `.github/workflows/_integration-tests.yaml`
- `.github/scripts/create-ephemeral-repo-config.sh`
- 3 action fixture templates (placeholder URLs)
- `.claude/rules/integration-tests.md`

## Documentation Updates

Rewrite `.claude/rules/integration-tests.md`:

- Remove persistent repo isolation table
- Document ephemeral repo pattern as standard
- Keep "never reuse deleted repo names" rule
- Note ADO/GitLab still use persistent repos with concurrency groups
- Remove references to `reset-test-repo.sh`

## Post-Merge Manual Cleanup

- Delete persistent repos `xfg-test` through `xfg-test-8` from `anthony-spruyt`
- Delete `anthony-spruyt/xfg-mode-test` (from prior issue)
