# Lifecycle Integration Tests Design

Issue: #472

## Prerequisites: Fix CI Failures on Main

Two bugs introduced by PR #470 must be fixed first:

### Bug 1: Sync dry-run crashes on non-existent repos

**Root cause:** `sync-command.ts` runs `runLifecycleCheck()` which correctly outputs `+ CREATE` in dry-run mode, but then continues to clone the repo. Since the repo doesn't actually exist (dry-run didn't create it), `git clone` fails.

**Fix:** After `runLifecycleCheck()`, if `lifecycleResult.action !== "existed"` and `dryRun` is true, skip repo processing for that repo. Same fix needed in `settings-command.ts` for consistency.

**Files:** `src/cli/sync-command.ts`, `src/cli/settings-command.ts`

### Bug 2: Description not applied by settings command

**Root cause:** `github-repo-settings-strategy.ts:configToGitHubPayload()` has a `directMappings` array that's missing `"description"`. The diff logic correctly detects description changes, but the apply payload never includes it.

**Fix:** Add `"description"` to the `directMappings` array.

**File:** `src/settings/repo-settings/github-repo-settings-strategy.ts`

## Integration Test Design

### Test Matrix

|            | PAT                        | App                            |
| ---------- | -------------------------- | ------------------------------ |
| **CLI**    | `github-lifecycle.test.ts` | `github-lifecycle-app.test.ts` |
| **Action** | `action-lifecycle-pat` job | `action-lifecycle-app` job     |

4 new CI jobs with concurrency groups `integration-github-8` through `integration-github-11`.

### Test Cases

Each level tests all three lifecycle operations:

1. **Create** — config with non-existent GitHub repo, no `upstream`/`source` -> verify repo created + files synced -> cleanup
2. **Fork** — config with non-existent GitHub repo + `upstream` pointing to `anthony-spruyt/xfg-fork-source` (dedicated small public repo) -> verify fork exists -> cleanup
3. **Migrate** — config with non-existent GitHub repo + `source` pointing to existing ADO integration test repo -> verify repo created with content -> cleanup

### Ephemeral Repo Strategy

Following `gh` CLI acceptance test pattern:

- **Unique names:** `xfg-lifecycle-test-<Date.now()>-<randomChars>`
- **Cleanup:** `gh repo delete --yes <name>` in `afterEach` (CLI tests) or `if: always()` step (Action tests)
- **Never reuse names** — avoids ghost-repo race conditions

### Dynamic Config Generation

Tests generate YAML config files dynamically in `beforeEach` with the unique repo name. Template:

```yaml
id: lifecycle-integration-test
files:
  test.txt:
    content: "lifecycle test"
repos:
  - git: https://github.com/anthony-spruyt/<unique-name>.git
    upstream: https://github.com/anthony-spruyt/xfg-fork-source.git # for fork test
    source: https://dev.azure.com/org/project/_git/repo # for migrate test
```

### CI Jobs

All 4 jobs:

- Run only on `push` to `main`
- Download build artifacts from `build` job
- Own concurrency group (`cancel-in-progress: false`)

**CLI PAT job (`cli-lifecycle-github-pat`):**

- Concurrency: `integration-github-8`
- Env: `GH_TOKEN` (PAT), ADO credentials for migrate test
- Script: `npm run test:integration:github-lifecycle`

**CLI App job (`cli-lifecycle-github-app`):**

- Concurrency: `integration-github-9`
- Env: `XFG_GITHUB_APP_ID`, `XFG_GITHUB_APP_PRIVATE_KEY`, `GH_TOKEN` (for setup/cleanup), ADO creds
- Script: `npm run test:integration:github-lifecycle-app`

**Action PAT job (`action-lifecycle-pat`):**

- Concurrency: `integration-github-10`
- Env: `GH_TOKEN` (PAT), ADO creds
- Pattern: arrange (generate config) / act (run action) / assert (verify via API) / cleanup

**Action App job (`action-lifecycle-app`):**

- Concurrency: `integration-github-11`
- Env: App creds + PAT for setup/cleanup, ADO creds
- Same pattern as action PAT but with App auth

### Files to Create/Modify

| File                                                          | Action                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/cli/sync-command.ts`                                     | Fix: skip repo processing in dry-run when lifecycle action != "existed" |
| `src/cli/settings-command.ts`                                 | Fix: same dry-run skip for settings                                     |
| `src/settings/repo-settings/github-repo-settings-strategy.ts` | Fix: add "description" to directMappings                                |
| `test/integration/github-lifecycle.test.ts`                   | Create: CLI PAT lifecycle tests                                         |
| `test/integration/github-lifecycle-app.test.ts`               | Create: CLI App lifecycle tests                                         |
| `.github/workflows/ci.yaml`                                   | Modify: add 4 new lifecycle CI jobs                                     |
| `.claude/rules/integration-tests.md`                          | Modify: add ephemeral repo guidance                                     |
| `package.json`                                                | Modify: add npm scripts for lifecycle tests                             |

### Prerequisites

- **Fork source repo:** `anthony-spruyt/xfg-fork-source` must exist (tiny public repo with README)
- **ADO source repo:** Reuse existing ADO integration test repo
- **GitHub App permissions:** Must have `repo:create` and `repo:delete` scopes
