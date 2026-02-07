# Design: Integration Test Isolation (#388, #389, #391)

## Problem

Three issues with the integration test files (`github.test.ts`, `ado.test.ts`, `gitlab.test.ts`):

1. **#388** — ADO and GitLab define their own `exec()` instead of using `test-helpers.ts`
2. **#389** — The "re-sync" test in all three files depends on the prior "sync creates PR" test
3. **#391** — Inline setup/cleanup scattered through each test body; if a test fails mid-way, cleanup doesn't run

## Approach

### 1. Share `exec` and `projectRoot` (#388)

- `ado.test.ts` and `gitlab.test.ts` import `exec` and `projectRoot` from `test-helpers.ts`
- Remove duplicate `exec()`, `__filename`, `__dirname`, `projectRoot` from both files
- Platform-specific helpers (`adoApi`, `glabApi`, `getFileContent`, etc.) stay in their respective files

### 2. Nuke scripts for ADO and GitLab (#391)

Create two new scripts alongside the existing `reset-test-repo.sh`:

**`.github/scripts/reset-test-repo-ado.sh`**

- Args: `<org-url> <project> <repo>`
- Auth: `AZURE_DEVOPS_EXT_PAT` env var
- Steps:
  1. Abandon all active PRs (`az repos pr list` + `az repos pr update --status abandoned`)
  2. Delete all branches except default (`az repos ref list` + `az repos ref delete`)
  3. Reset default branch to README-only (ADO pushes API — create commit that replaces tree)

**`.github/scripts/reset-test-repo-gitlab.sh`**

- Args: `<project-path>` (e.g., `anthony-spruyt1/xfg-test`)
- Auth: `GITLAB_TOKEN` env var (used by `glab`)
- Steps:
  1. Close all open MRs (`glab api` to list + update state_event=close)
  2. Delete all branches except default (`glab api` to list + delete)
  3. Reset default branch to README-only (GitLab repository files API — delete all files, create README.md)

### 3. Test structure: nuke-before-each (#389, #391)

Each test becomes fully self-contained:

```
test("scenario name", async () => {
  // Nuke — clean slate
  exec("bash .github/scripts/reset-test-repo-<platform>.sh <args>");

  // Arrange — seed files, set up preconditions
  ...

  // Act — run xfg
  exec("node dist/cli.js --config ...");

  // Assert — verify results
  ...

  // No cleanup needed — next test nukes
});
```

No `before()` or `after()` hooks at the suite level.

The "re-sync" test creates its own initial PR in the arrange phase:

```
test("re-sync closes existing PR and creates fresh one", async () => {
  // Nuke
  exec("bash .github/scripts/reset-test-repo-<platform>.sh <args>");

  // Arrange — create initial PR by running xfg
  exec("node dist/cli.js --config ...");
  const prBefore = /* get PR number/id */;

  // Act — run xfg again
  exec("node dist/cli.js --config ...");

  // Assert — old PR closed, new PR exists
  ...
});
```

### 4. Remove post-cleanup from GitHub tests

Currently `github.test.ts` has a `before()` hook (lines 26-117) that does inline cleanup (delete rulesets, close PRs, delete files, delete branches, clean tmp). This is replaced by the nuke script call at the start of each test. The `before()` hook is removed entirely.

Inline cleanup at the end of individual tests (e.g., the try/catch blocks deleting files and closing PRs at the bottom of each test) is also removed — the next test's nuke handles it.

### 5. CI workflow changes

Add nuke scripts to ADO and GitLab CI jobs (same before/after pattern GitHub already uses):

**`integration-test-cli-sync-ado-pat`** — add steps:

- Before tests: `reset-test-repo-ado.sh`
- After tests (`if: always()`): `reset-test-repo-ado.sh`

**`integration-test-cli-sync-gitlab-pat`** — add steps:

- Before tests: `reset-test-repo-gitlab.sh`
- After tests (`if: always()`): `reset-test-repo-gitlab.sh`

### 6. Files affected

**New files:**

- `.github/scripts/reset-test-repo-ado.sh`
- `.github/scripts/reset-test-repo-gitlab.sh`

**Modified files:**

- `test/integration/test-helpers.ts` — no changes needed (already exports `exec`, `projectRoot`)
- `test/integration/ado.test.ts` — import shared `exec`/`projectRoot`, remove duplicates, restructure each test to nuke-before pattern
- `test/integration/gitlab.test.ts` — same as ADO
- `test/integration/github.test.ts` — remove `before()` hook, remove inline cleanup from each test, each test calls nuke script at start
- `.github/workflows/ci.yaml` — add reset steps to ADO and GitLab jobs

**Not modified:**

- `test/integration/github-app.test.ts` — already uses shared helpers, CI handles cleanup
- `test/integration/github-rulesets.test.ts` — already has proper `before()`/`after()` with `deleteRulesetIfExists()`
- `test/integration/github-repo-settings.test.ts` — already has proper `before()`/`after()`, uses separate test repo

## Scope explicitly excluded

- **#390** (closed) — No cross-platform test deduplication. Platform-specific test files stay separate.
