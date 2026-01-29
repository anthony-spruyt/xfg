# GitHub App Verified Commits Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional GitHub App authentication with verified commits via GraphQL API.

**Architecture:** Create a `CommitStrategy` abstraction (similar to existing `PRStrategy`). `GitCommitStrategy` wraps current git-based flow. `GraphQLCommitStrategy` uses GitHub's `createCommitOnBranch` mutation for verified commits. Strategy selection based on `GH_INSTALLATION_TOKEN` env var.

**Tech Stack:** TypeScript, Node.js built-in test runner, GitHub GraphQL API, `gh` CLI for API calls.

**Note:** Code examples use existing `CommandExecutor` interface from `src/command-executor.ts`.

---

## Task 1: Create CommitStrategy Interface

**Files:**

- Create: `src/strategies/commit-strategy.ts`

**Step 1: Write the interface and types**

```typescript
// src/strategies/commit-strategy.ts
import { RepoInfo } from "../repo-detector.js";

export interface FileChange {
  path: string;
  content: string | null; // null = deletion
}

export interface CommitOptions {
  repoInfo: RepoInfo;
  branchName: string;
  message: string;
  fileChanges: FileChange[];
  workDir: string;
  retries?: number;
}

export interface CommitResult {
  sha: string;
  verified: boolean;
  pushed: boolean;
}

/**
 * Strategy interface for creating commits.
 * Implementations handle platform-specific commit mechanisms.
 */
export interface CommitStrategy {
  /**
   * Create a commit with the given file changes and push to remote.
   * @returns Commit result with SHA and verification status
   */
  commit(options: CommitOptions): Promise<CommitResult>;
}
```

**Step 2: Run TypeScript compiler to verify no errors**

Run: `npm run build`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add src/strategies/commit-strategy.ts
git commit -m "feat: add CommitStrategy interface"
```

---

## Task 2: Implement GitCommitStrategy

**Files:**

- Create: `src/strategies/git-commit-strategy.ts`
- Create: `src/strategies/git-commit-strategy.test.ts`

**Step 1: Write the failing test**

Create test file with mock executor pattern matching existing tests in `src/strategies/*.test.ts`.

Test cases:

- stages files, commits, and pushes
- uses retry for push failures
- escapes branch name in push command

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "GitCommitStrategy"`
Expected: FAIL with "Cannot find module"

**Step 3: Write the implementation**

Implementation should:

- Use existing `CommandExecutor` interface
- Run `git add -A`, `git commit`, `git push --force-with-lease`
- Use `withRetry` from `src/retry-utils.ts` for push
- Use `escapeShellArg` from `src/shell-utils.ts`
- Return `{ sha, verified: false, pushed: true }`

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "GitCommitStrategy"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/strategies/git-commit-strategy.ts src/strategies/git-commit-strategy.test.ts
git commit -m "feat: implement GitCommitStrategy"
```

---

## Task 3: Implement GraphQLCommitStrategy

**Files:**

- Create: `src/strategies/graphql-commit-strategy.ts`
- Create: `src/strategies/graphql-commit-strategy.test.ts`

**Step 1: Write failing tests**

Test cases:

- calls GraphQL API with createCommitOnBranch mutation
- base64 encodes file contents
- handles file deletions
- throws error when payload exceeds size limit (50MB)
- supports GitHub Enterprise with custom host
- retries on expectedHeadOid mismatch
- throws descriptive error for permission denied
- throws error for non-GitHub repos

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "GraphQLCommitStrategy"`
Expected: FAIL with "Cannot find module"

**Step 3: Write the implementation**

Key implementation details:

- Export `MAX_PAYLOAD_SIZE = 50 * 1024 * 1024`
- Validate payload size before API call (base64 adds ~33%)
- Get HEAD SHA via `git rev-parse HEAD`
- Build GraphQL mutation with:
  - `branch.repositoryNameWithOwner`
  - `branch.branchName`
  - `expectedHeadOid` (for optimistic locking)
  - `message.headline`
  - `fileChanges.additions` (path + base64 contents)
  - `fileChanges.deletions` (path only)
- Call via `gh api graphql --hostname <host> -f query=<mutation>`
- Handle retry on "Expected branch to point to" error
- Return `{ sha: oid, verified: true, pushed: true }`

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "GraphQLCommitStrategy"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/strategies/graphql-commit-strategy.ts src/strategies/graphql-commit-strategy.test.ts
git commit -m "feat: implement GraphQLCommitStrategy for verified commits"
```

---

## Task 4: Add Strategy Selection and Export

**Files:**

- Create: `src/strategies/commit-strategy-selector.ts`
- Create: `src/strategies/commit-strategy-selector.test.ts`
- Modify: `src/strategies/index.ts`

**Step 1: Write failing test for selector**

Test cases:

- returns GitCommitStrategy for GitHub with GH_TOKEN
- returns GraphQLCommitStrategy for GitHub with GH_INSTALLATION_TOKEN
- GH_INSTALLATION_TOKEN takes precedence over GH_TOKEN
- returns GitCommitStrategy for Azure DevOps (ignores GH_INSTALLATION_TOKEN)
- returns GitCommitStrategy for GitLab (ignores GH_INSTALLATION_TOKEN)

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "getCommitStrategy"`
Expected: FAIL with "Cannot find module"

**Step 3: Write the selector implementation**

```typescript
export function getCommitStrategy(
  repoInfo: RepoInfo,
  executor?: CommandExecutor
): CommitStrategy {
  if (isGitHubRepo(repoInfo) && process.env.GH_INSTALLATION_TOKEN) {
    return new GraphQLCommitStrategy(executor);
  }
  return new GitCommitStrategy(executor);
}
```

**Step 4: Update index.ts exports**

Add exports for:

- `CommitStrategy`, `CommitOptions`, `CommitResult`, `FileChange`
- `GitCommitStrategy`
- `GraphQLCommitStrategy`
- `getCommitStrategy`

**Step 5: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/strategies/commit-strategy-selector.ts src/strategies/commit-strategy-selector.test.ts src/strategies/index.ts
git commit -m "feat: add commit strategy selector with GH_INSTALLATION_TOKEN support"
```

---

## Task 5: Integrate CommitStrategy into RepositoryProcessor

**Files:**

- Modify: `src/repository-processor.ts`
- Modify: `src/repository-processor.test.ts`

**Step 1: Write failing test for GraphQL integration**

Add test that:

- Sets `process.env.GH_INSTALLATION_TOKEN`
- Verifies `gh api graphql` is called
- Verifies `createCommitOnBranch` is in the call
- Verifies `git commit` is NOT called

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "GH_INSTALLATION_TOKEN"`
Expected: FAIL (still using git commit)

**Step 3: Modify repository-processor.ts**

Changes needed:

1. Import `getCommitStrategy` and `FileChange`
2. Add method to collect file changes from written files
3. Replace `gitOps.commit()` + `gitOps.push()` with `commitStrategy.commit()`
4. Log commit result including verified status

**Step 4: Run tests**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/repository-processor.ts src/repository-processor.test.ts
git commit -m "feat: integrate CommitStrategy into RepositoryProcessor"
```

---

## Task 6: Add Documentation

**Files:**

- Create: `docs/platforms/github-app.md`
- Modify: `docs/platforms/github.md`
- Modify: `docs/ci-cd/github-actions.md`

**Step 1: Create GitHub App documentation**

`docs/platforms/github-app.md` should cover:

- Benefits (no user-tied credentials, verified commits, audit trails)
- Setup steps (create app, configure permissions, install, store credentials)
- Workflow example using `actions/create-github-app-token@v2`
- How it works (GraphQL API)
- Limitations (commit author, file size, GHE compatibility)
- Troubleshooting

**Step 2: Update GitHub platform docs**

Add "Authentication Options" section to `docs/platforms/github.md` linking to GitHub App docs.

**Step 3: Update GitHub Actions docs**

Add GitHub App workflow example to `docs/ci-cd/github-actions.md`.

**Step 4: Commit**

```bash
git add docs/platforms/github-app.md docs/platforms/github.md docs/ci-cd/github-actions.md
git commit -m "docs: add GitHub App authentication documentation"
```

---

## Task 7: Run Full Test Suite and Coverage Check

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 2: Check coverage**

Run: `npm test` (check output for coverage or run `npm run test:coverage` if available)
Expected: 95%+ coverage on new code

**Step 3: Run linter**

Run: `./lint.sh`
Expected: PASS

**Step 4: Build**

Run: `npm run build`
Expected: PASS

---

## Task 8: Manual Testing Preparation

**User Action Required:**

1. Create a test GitHub App in the xfg-test organization
2. Install the app on the `xfg-test` repository
3. Add to repository: `TEST_APP_ID` variable and `TEST_APP_PRIVATE_KEY` secret
4. Run integration tests: `npm run test:integration:github-app`

---

## Task 9: Create Integration Test (After User Setup)

**Files:**

- Create: `test/integration/github-app.test.ts`
- Modify: `package.json`

**Step 1: Write integration test**

Test cases (skip if `GH_INSTALLATION_TOKEN` not set):

- creates verified commit via GraphQL API
- creates PR with app as author
- direct mode commits to main branch

**Step 2: Add npm script**

Add to `package.json`:

```json
"test:integration:github-app": "node --import tsx --test test/integration/github-app.test.ts"
```

**Step 3: Commit**

```bash
git add test/integration/github-app.test.ts package.json
git commit -m "test: add GitHub App integration tests"
```

---

## Summary

| Task | Description                          |
| ---- | ------------------------------------ |
| 1    | CommitStrategy interface             |
| 2    | GitCommitStrategy implementation     |
| 3    | GraphQLCommitStrategy implementation |
| 4    | Strategy selector                    |
| 5    | RepositoryProcessor integration      |
| 6    | Documentation                        |
| 7    | Verification (tests, coverage, lint) |
| 8    | Manual setup (user action)           |
| 9    | Integration tests                    |
