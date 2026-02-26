# Design: Executable File Limitation & Signed Ref Operations

**Date:** 2026-02-26
**Status:** Draft
**Branch:** `feat/executable-mode-and-signed-refs`

## Problem Statement

The `GraphQLCommitStrategy` uses GitHub's `createCommitOnBranch` GraphQL mutation for signed commits via GitHub App authentication. Two issues exist:

1. **Executable file limitation:** `createCommitOnBranch` cannot set file modes. New files are always created as `100644`. Updating existing `100755` files preserves the mode. This is a GitHub API limitation.

2. **Unsigned git push in `ensureBranchExistsOnRemote`:** The method uses `git push` to create/delete branches on the remote. Repos with `required_signatures` on all branches reject these unsigned pushes. Branch ref operations must be replaced with GraphQL mutations.

## Design

### 1. Replace `ensureBranchExistsOnRemote` with GraphQL ref operations

**Current flow:**

```
ensureBranchExistsOnRemote
  ├─ git ls-remote (or gitOps.lsRemote) → check if branch exists
  ├─ if exists + force:
  │   ├─ git push --delete (or gitOps.pushRefspec with delete)
  │   └─ git push HEAD:branch (or gitOps.pushRefspec)
  └─ if not exists:
      └─ git push HEAD:branch (or gitOps.pushRefspec)
```

**New flow:** Replace all unsigned `git push` and `git ls-remote` calls with GraphQL queries and mutations.

#### 1a. New private method: `queryRemoteRef`

A single GraphQL query that returns both the repository Node ID and the ref Node ID (if the branch exists):

```graphql
query {
  repository(owner: "OWNER", name: "REPO") {
    id
    ref(qualifiedName: "refs/heads/BRANCH") {
      id
    }
  }
}
```

This replaces `git ls-remote` / `gitOps.lsRemote`. The repository `id` is needed for `createRef`, and the ref `id` is needed for `deleteRef`.

**Return type:**

```typescript
interface RemoteRefInfo {
  repositoryId: string; // Node ID of the repository
  refId: string | null; // Node ID of the ref, null if branch doesn't exist
}
```

**Error handling:** Uses `withRetry` with a GraphQL-specific set of permanent error patterns (e.g., `/not\s*found/i`, `/unauthorized/i`) rather than `DEFAULT_PERMANENT_ERROR_PATTERNS` which contains git-CLI-specific patterns like `/remote\s*rejected/i` that don't apply to GraphQL responses. A missing ref is not an error — the GraphQL query returns `data.repository.ref: null` when the branch doesn't exist, and the method returns `refId: null`.

#### 1b. New private method: `createRemoteRef`

Creates a branch ref on the remote using the `createRef` GraphQL mutation:

```graphql
mutation {
  createRef(
    input: {
      repositoryId: "REPO_NODE_ID"
      name: "refs/heads/BRANCH"
      oid: "COMMIT_SHA"
    }
  ) {
    ref {
      id
    }
  }
}
```

**Parameters:** `repositoryId` (from `queryRemoteRef`), `branchName`, `oid` (commit SHA), `workDir`, `repoInfo` (for hostname), `token` (optional).

The `oid` is the local HEAD SHA (`git rev-parse HEAD`). **Key invariant:** at this point in the flow, local HEAD is always a commit that already exists on the remote because the repo was just cloned from it. For PR branches (`force=true`), local HEAD is the default branch tip. For direct mode (`force=false`) when the branch doesn't exist yet, local HEAD is also the default branch tip post-clone. The `createRef` mutation creates a branch pointer to this existing commit — no new commits are pushed.

**`refs/heads/` prefix:** The `branchName` parameter (e.g., `"chore/sync-config"`) must be prefixed with `refs/heads/` to form the fully-qualified ref name `refs/heads/chore/sync-config` for the `createRef` `name` input. This differs from the `createCommitOnBranch` mutation which takes a plain branch name. The existing `SAFE_BRANCH_NAME_PATTERN` validation already ensures branch names contain only safe characters including `/`.

#### 1c. New private method: `deleteRemoteRef`

Deletes a branch ref on the remote using the `deleteRef` GraphQL mutation:

```graphql
mutation {
  deleteRef(input: { refId: "REF_NODE_ID" }) {
    clientMutationId
  }
}
```

**Parameters:** `refId` (from `queryRemoteRef`), `workDir`, `repoInfo` (for hostname), `token` (optional).

#### 1d. Updated `ensureBranchExistsOnRemote` signature

```typescript
private async ensureBranchExistsOnRemote(
  branchName: string,
  workDir: string,
  force?: boolean,
  repoInfo?: GitHubRepoInfo,
  token?: string
): Promise<void>
```

Changes from current signature:

- **Removed:** `gitOps?: IAuthenticatedGitOps` — no longer needed since we don't call `lsRemote` or `pushRefspec`
- **Added:** `repoInfo?: GitHubRepoInfo` — needed for GraphQL queries (owner, repo, host)
- **Added:** `token?: string` — needed for authenticated GraphQL calls

#### 1e. Updated logic

```
ensureBranchExistsOnRemote(branchName, workDir, force, repoInfo, token)
  ├─ queryRemoteRef(repoInfo, branchName, workDir, token)
  │   → { repositoryId, refId }
  ├─ if refId exists + force:
  │   ├─ deleteRemoteRef(refId, workDir, repoInfo, token)
  │   ├─ sha = git rev-parse HEAD
  │   └─ createRemoteRef(repositoryId, branchName, sha, workDir, repoInfo, token)  [with retry]
  ├─ if refId exists + !force:
  │   └─ (no-op, branch already exists)
  └─ if refId is null:
      ├─ sha = git rev-parse HEAD
      └─ createRemoteRef(repositoryId, branchName, sha, workDir, repoInfo, token)  [with retry]
```

**Atomicity note:** The delete-then-create path (`force=true`) is not atomic — there is a window where the remote branch does not exist after `deleteRemoteRef` succeeds but before `createRemoteRef` completes. If `createRemoteRef` fails (network error, rate limit), the branch is gone.

**Mitigation:** Both `createRemoteRef` and `deleteRemoteRef` are wrapped in `withRetry` for transient failures. For permanent failures, this is an accepted risk because:

1. The `force=true` path is only used for PR branches (not the default branch), so data loss is limited to a PR branch that was about to be recreated anyway.
2. The next xfg sync run will recreate the branch from scratch (the branch-doesn't-exist path handles this).
3. The old `git push --delete` + `git push` approach had the same non-atomic window.

#### 1f. Updated call site in `commit()`

```typescript
// Before:
await this.ensureBranchExistsOnRemote(
  branchName,
  workDir,
  options.force,
  gitOps
);

// After:
await this.ensureBranchExistsOnRemote(
  branchName,
  workDir,
  options.force,
  githubInfo,
  token
);
```

The `gitOps` parameter is no longer passed. The `gitOps.fetchBranch()` call in the retry loop (line 140) still uses `gitOps` — that's fine, `fetchBranch` is a read-only `git fetch` that doesn't push anything.

#### 1g. GraphQL execution pattern

All three new methods (`queryRemoteRef`, `createRemoteRef`, `deleteRemoteRef`) follow the same pattern as the existing `executeGraphQLMutation`:

1. Build a JSON request body with `query`/`mutation` and `variables`
2. Execute via `echo <json> | [GH_TOKEN=...] gh api graphql [--hostname host] --input -`
3. Parse the JSON response
4. Handle errors (check `parsed.errors` array)

The `--hostname` flag is included when `repoInfo.host !== "github.com"` (GitHub Enterprise support).

Note: The existing codebase uses `this.executor.exec()` (which wraps `execSync`) with shell commands piped through `gh api graphql`. This pattern is already established in `executeGraphQLMutation` and is the standard approach in this codebase for GitHub API interactions. The new methods follow this same pattern.

#### 1h. Removal of `IAuthenticatedGitOps` dependency from `ensureBranchExistsOnRemote`

After this change, `ensureBranchExistsOnRemote` no longer calls any `IAuthenticatedGitOps` methods. The only remaining usage of `gitOps` in the class is `fetchBranch()` in the retry loop of `commit()`. This import and parameter remain unchanged.

**JSDoc update in `src/vcs/types.ts`:** The `CommitOptions.gitOps` field's JSDoc currently says "used by GraphQLCommitStrategy for network ops." Update to: "used by GraphQLCommitStrategy for fetchBranch() during OID mismatch retries."

### 2. Executable file warning in FileWriter

**File:** `src/sync/file-writer.ts`

**Location:** In the Step 2 loop (executable permissions), after `shouldBeExecutable(file)` returns true.

**Logic:**

In the Step 2 loop of `writeFiles()`, the `fileChanges` variable refers to the local `Map<string, FileWriteResult>` that was populated in Step 1. This map only contains entries for files where `gitOps.wouldChange()` returned true, with `action` set to `"create"` (file didn't exist locally) or `"update"` (file existed locally).

```typescript
if (shouldBeExecutable(file)) {
  // Warn about GitHub App limitation for new executable files.
  // `fileChanges` is the local Map<string, FileWriteResult> from Step 1.
  // It only contains entries for files with actual content changes.
  const tracked = fileChanges.get(file.fileName);
  if (tracked?.action === "create" && hasGitHubAppCredentials()) {
    log.warn(
      `${file.fileName}: GitHub App commits cannot set executable mode on new files. ` +
        `The file will be created as non-executable (100644). ` +
        `See: https://anthony-spruyt.github.io/xfg/examples/executable-files/`
    );
  }
  log.info(`Setting executable: ${file.fileName}`);
  await gitOps.setExecutable(file.fileName);
}
```

**Import:** Add `import { hasGitHubAppCredentials } from "../vcs/commit-strategy-selector.js";`

**Edge case:** The `action` field is determined by `fileExistsLocal` (local filesystem check after clone), not whether the file exists on the remote branch. In normal operation these are equivalent — the repo was just cloned, so local state mirrors remote state. The only scenario where they'd diverge is if another process modified the working directory between clone and file-write, which is not a realistic concern.

**Note:** The `setExecutable` call still runs — it marks the file executable in the local git index. For the `GitCommitStrategy` (PAT), this mode is committed correctly. For `GraphQLCommitStrategy`, the mode is set locally but the GraphQL API creates the file as `100644` on the remote. On subsequent syncs, the file already exists on the remote with whatever mode it has, and updates preserve it.

### 3. Integration test: required_signatures on xfg-test-2

**Goal:** Validate that `ensureBranchExistsOnRemote` works on repos that require signed commits on all branches.

#### 3a. New settings fixture

**File:** `test/fixtures/integration-test-github-app-signed-refs-settings.yaml`

```yaml
# Settings fixture to enforce signed commits on all branches of xfg-test-2.
# Applied after reset in beforeEach to validate GraphQL ref operations
# work when unsigned git push would be rejected.
id: integration-test-github-app-signed-refs-settings

# Placeholder file required by schema — excluded from target repo
files:
  .xfg-signed-refs-test:
    content: "# Placeholder for signed-refs ruleset test"
    createOnly: true

settings:
  rulesets:
    xfg-require-signed-commits:
      target: branch
      enforcement: active
      conditions:
        refName:
          include:
            - "refs/heads/**"
          exclude: []
      rules:
        - type: required_signatures

repos:
  - git: https://github.com/anthony-spruyt/xfg-test-2.git
    files:
      .xfg-signed-refs-test: false
```

#### 3b. Test setup change

**File:** `test/integration/github-app.test.ts`

Add a helper function that applies the signed-refs settings after each repo reset. **Critical:** The settings command must use PAT credentials (needs repo admin permission to create rulesets), NOT GitHub App credentials. Since `exec()` inherits the full `process.env` (including `XFG_GITHUB_APP_ID` and `XFG_GITHUB_APP_PRIVATE_KEY` in CI), we must explicitly strip App credentials so the CLI falls back to `GH_TOKEN`:

```typescript
// Force PAT-only auth: strip App credentials so GH_TOKEN is used for admin operations
const patOnlyEnv = {
  env: {
    XFG_GITHUB_APP_ID: undefined,
    XFG_GITHUB_APP_PRIVATE_KEY: undefined,
  },
};

function setupSignedCommitRuleset(): void {
  console.log("  Applying required_signatures ruleset...");
  const configPath = join(
    fixturesDir,
    "integration-test-github-app-signed-refs-settings.yaml"
  );
  exec(`node dist/cli.js settings --config ${configPath}`, patOnlyEnv);
  console.log("  required_signatures ruleset active on all branches");
}
```

**Do NOT add to the existing first `describe` block's `beforeEach`.** Instead, add a new dedicated `describe` block for signed-ref tests. This avoids contaminating the existing 4 passing tests with a dependency on `setupSignedCommitRuleset()` — if the ruleset setup fails (permission issue, API rate limit), only the signed-ref tests break, not the existing suite.

```typescript
describe("GitHub App Signed Refs Test", { skip: SKIP_TESTS }, () => {
  beforeEach(() => {
    resetTestRepo();
    setupSignedCommitRuleset();
  });

  test("sync creates PR on repo with required_signatures on all branches", () => {
    const configPath = join(fixturesDir, "integration-test-github-app.yaml");
    console.log("Running xfg sync with required_signatures active...");
    const output = exec(`node dist/cli.js sync --config ${configPath}`, xfgEnv);
    console.log(output);
  });
});
```

This follows the existing pattern where the second `describe` block ("GitHub App Repo Settings Test") has its own independent setup.

**Note on test ordering:** The existing second `describe` block ("GitHub App Repo Settings Test", line 135) has no `beforeEach` reset and only calls `resetRepoSettings()`. It does NOT delete rulesets. If the signed-refs `describe` block runs before it, the `required_signatures` ruleset from the last `beforeEach` will persist. This is acceptable because the repo settings test only modifies repo-level settings (wiki, projects, merge types) via REST and does not perform git push operations.

#### 3c. What this validates

The new `describe` block runs the sync test against a repo with `required_signatures` on all branches:

| Test                                | What it validates                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| sync creates PR (signed-refs block) | `ensureBranchExistsOnRemote` creates branch via GraphQL when unsigned git push would be rejected |

The existing tests in the first `describe` block continue to run WITHOUT the ruleset, validating the normal flow. The new test validates the signed-commit-specific path.

If the old `git push` code were still in place, the signed-refs test would fail because the unsigned push would be rejected by the `required_signatures` ruleset.

#### 3d. CI workflow — no changes needed

The `integration-test-cli-sync-github-app` job already has both `GH_TOKEN` and App credentials. The settings command (run during test setup) uses `GH_TOKEN`. The xfg sync commands use App credentials. No workflow changes are required.

### 4. Documentation

#### 4a. `docs/examples/executable-files.md` — new section

Add a "GitHub App Limitation" section at the bottom of the file:

> **GitHub App Limitation**
>
> When using GitHub App authentication, xfg uses the `createCommitOnBranch` GraphQL API to create verified (signed) commits. This API does not support setting file modes.
>
> **Impact:**
>
> - New executable files are created as `100644` (non-executable) on the remote
> - Updating an existing file preserves whatever mode it already has — if a file is `100755`, it stays `100755`
>
> **Workaround:**
> After the first sync creates the file, manually set it to executable:
>
> ```bash
> git update-index --chmod=+x path/to/script.sh
> git commit -m "fix: set executable mode"
> git push
> ```
>
> All future xfg syncs will preserve the `100755` mode.
>
> **PAT authentication** is not affected — it uses `git commit` which correctly records file modes.

#### 4b. `docs/platforms/github-app.md` — add 5th limitation

Add to the existing Limitations section:

> 5. **Executable file modes** — The `createCommitOnBranch` GraphQL API cannot set file modes. New `.sh` files (or files with `executable: true`) are created as non-executable. See [Executable Files — GitHub App Limitation](../examples/executable-files.md#github-app-limitation) for details and workaround.

### 5. Cleanup

After implementation is verified and merged:

- Delete the `anthony-spruyt/xfg-mode-test` repository (manual, via `gh repo delete anthony-spruyt/xfg-mode-test --yes`)

### 6. Unit test updates

**File:** `test/unit/vcs/graphql-commit-strategy.test.ts`

#### Tests to DELETE (these test the old `git push` / `lsRemote` behavior):

These tests will pass vacuously after the change (mock `git push` / `git ls-remote` responses become dead code that never matches). They must be explicitly deleted and replaced, not left as silent no-ops:

- **"pushes branch to remote if it does not exist"** (~line 484): Asserts `git push origin HEAD:'feature-branch'` was called. Replace with GraphQL `createRef` assertion.
- **"deletes and recreates branch when force=true and branch exists"** (~line 529): Asserts `git push origin --delete` and `git push -u origin HEAD:'feature-branch'`. Replace with `deleteRef` then `createRef` assertions.
- **"does not delete branch when force=false and branch exists"** (~line 576): Currently asserts `git push origin --delete` was NOT called. Replace with assertion that `deleteRef` mutation was NOT in executor calls.
- **"uses gitOps for push commands when force=true (GitHub App auth)"** (~line 840): Asserts `gitOps.lsRemote` and `gitOps.pushRefspec` are called. Delete entirely — `ensureBranchExistsOnRemote` no longer uses `gitOps`.

Also clean up: remove all `mockExecutor.responses.set("git ls-remote", ...)` and `mockExecutor.responses.set("git push", ...)` entries from other test setups, as these become dead code that never matches.

#### Replacement test scenarios:

The mock executor must now return appropriate JSON responses for GraphQL queries. Set up mock responses for `gh api graphql` commands that return `{ "data": { "repository": { "id": "...", "ref": { "id": "..." } } } }` etc.

| Scenario                                      | Expected behavior                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Branch doesn't exist                          | `queryRemoteRef` returns `refId: null` → executor called with `createRef` mutation containing repo ID + HEAD SHA |
| Branch exists + force                         | `queryRemoteRef` returns `refId` → executor called with `deleteRef` mutation → then `createRef` mutation         |
| Branch exists + no force                      | `queryRemoteRef` returns `refId` → no `createRef` or `deleteRef` mutations in executor calls                     |
| GraphQL query error                           | Error propagated with sanitized message                                                                          |
| GitHub Enterprise host                        | `--hostname` flag included in all `gh api graphql` commands                                                      |
| `createRef` failure after `deleteRef` success | Error propagated (accepted risk, documented in atomicity note)                                                   |

#### Tests to keep unchanged:

- OID mismatch retry logic (uses `fetchBranch`, not affected)
- Payload size validation
- Branch name validation
- Error sanitization
- `executeGraphQLMutation` file additions/deletions

## Files Changed

| File                                                                  | Change                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/vcs/graphql-commit-strategy.ts`                                  | Replace `ensureBranchExistsOnRemote` internals with GraphQL ref operations; add `queryRemoteRef`, `createRemoteRef`, `deleteRemoteRef` private methods |
| `src/vcs/types.ts`                                                    | Update JSDoc on `CommitOptions.gitOps` — now only used for `fetchBranch()`, not branch create/delete                                                   |
| `src/sync/file-writer.ts`                                             | Add warning log for new executable files under GitHub App auth                                                                                         |
| `test/unit/vcs/graphql-commit-strategy.test.ts`                       | Delete 4 old `git push`/`lsRemote` tests; replace with GraphQL ref operation test scenarios; clean up dead mock responses                              |
| `test/fixtures/integration-test-github-app-signed-refs-settings.yaml` | New fixture for `required_signatures` ruleset                                                                                                          |
| `test/integration/github-app.test.ts`                                 | Add new `describe` block with `setupSignedCommitRuleset()` for signed-ref tests (separate from existing tests)                                         |
| `docs/examples/executable-files.md`                                   | Add "GitHub App Limitation" section                                                                                                                    |
| `docs/platforms/github-app.md`                                        | Add 5th limitation item                                                                                                                                |

## Verification

1. `npm test` — unit tests pass
2. `./lint.sh` — linting passes
3. `npm run test:integration:github-app` — GitHub App integration tests pass (includes new signed-refs `describe` block with `required_signatures` active)
4. Manual: review docs render correctly on GitHub Pages
5. Manual: delete `anthony-spruyt/xfg-mode-test` repo
