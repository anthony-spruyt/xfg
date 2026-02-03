# Complete PR #319 Auth Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the PAT authentication flow that was broken when PR #319 removed global git config.

**Architecture:** Two changes: (1) Use `GH_TOKEN` env var for `AuthenticatedGitOps` when no GitHub App token, (2) Make `GitCommitStrategy` use `gitOps.push()` instead of raw `git push`.

**Tech Stack:** TypeScript, Node.js test runner, git

---

## Task 1: Add GH_TOKEN Fallback in repository-processor.ts (process method)

**Files:**

- Modify: `src/repository-processor.ts:154-164`
- Test: `src/repository-processor.test.ts`

**Step 1: Write the failing test**

Add test in `src/repository-processor.test.ts` after existing auth tests:

```typescript
test("uses GH_TOKEN for git auth when no GitHub App token", async () => {
  // Set up GH_TOKEN in environment
  const originalGhToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "ghp_test_pat_token";

  try {
    const processor = new RepositoryProcessor(
      mockLog,
      undefined, // no tokenManager = no GitHub App
      mockGitOpsFactory
    );

    await processor.process(repoConfig, githubRepoInfo, processorOptions);

    // Verify gitOpsFactory was called with auth options containing GH_TOKEN
    assert.ok(
      mockGitOpsFactory.calls.length > 0,
      "gitOpsFactory should be called"
    );
    const authOptions = mockGitOpsFactory.calls[0].authOptions;
    assert.ok(
      authOptions,
      "authOptions should be defined when GH_TOKEN is set"
    );
    assert.strictEqual(
      authOptions.token,
      "ghp_test_pat_token",
      "Should use GH_TOKEN"
    );
  } finally {
    if (originalGhToken) {
      process.env.GH_TOKEN = originalGhToken;
    } else {
      delete process.env.GH_TOKEN;
    }
  }
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="uses GH_TOKEN for git auth"`
Expected: FAIL - authOptions is undefined when no tokenManager

**Step 3: Write minimal implementation**

In `src/repository-processor.ts`, modify lines ~154-164 in `process()`:

```typescript
// Get installation token if needed
const token = await this.getInstallationToken(repoInfo);
if (token === null) {
  return {
    success: true,
    repoName,
    message: `No GitHub App installation found for ${repoInfo.owner}`,
    skipped: true,
  };
}

// Build auth options - use installation token OR fall back to GH_TOKEN for PAT flow
const effectiveToken =
  token ?? (isGitHubRepo(repoInfo) ? process.env.GH_TOKEN : undefined);
const authOptions: GitAuthOptions | undefined = effectiveToken
  ? {
      token: effectiveToken,
      host: isGitHubRepo(repoInfo)
        ? (repoInfo as GitHubRepoInfo).host
        : "github.com",
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    }
  : undefined;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="uses GH_TOKEN for git auth"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/repository-processor.ts src/repository-processor.test.ts
git commit -m "fix: use GH_TOKEN for git auth when no GitHub App token (process)"
```

---

## Task 2: Add GH_TOKEN Fallback in repository-processor.ts (updateManifestOnly method)

**Files:**

- Modify: `src/repository-processor.ts:661-671`
- Test: `src/repository-processor.test.ts`

**Step 1: Write the failing test**

Add test for `updateManifestOnly`:

```typescript
test("updateManifestOnly uses GH_TOKEN for git auth when no GitHub App token", async () => {
  const originalGhToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "ghp_test_pat_token";

  try {
    const processor = new RepositoryProcessor(
      mockLog,
      undefined, // no tokenManager
      mockGitOpsFactory
    );

    await processor.updateManifestOnly(
      githubRepoInfo,
      repoConfig,
      processorOptions,
      { rulesets: ["test-ruleset"] }
    );

    const authOptions = mockGitOpsFactory.calls[0].authOptions;
    assert.ok(
      authOptions,
      "authOptions should be defined when GH_TOKEN is set"
    );
    assert.strictEqual(authOptions.token, "ghp_test_pat_token");
  } finally {
    if (originalGhToken) {
      process.env.GH_TOKEN = originalGhToken;
    } else {
      delete process.env.GH_TOKEN;
    }
  }
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="updateManifestOnly uses GH_TOKEN"`
Expected: FAIL

**Step 3: Write minimal implementation**

In `src/repository-processor.ts`, modify lines ~661-671 in `updateManifestOnly()`:

```typescript
// Get installation token if needed
const token = await this.getInstallationToken(repoInfo);
if (token === null) {
  return {
    success: true,
    repoName,
    message: `No GitHub App installation found for ${repoInfo.owner}`,
    skipped: true,
  };
}

// Build auth options - use installation token OR fall back to GH_TOKEN for PAT flow
const effectiveToken =
  token ?? (isGitHubRepo(repoInfo) ? process.env.GH_TOKEN : undefined);
const authOptions: GitAuthOptions | undefined = effectiveToken
  ? {
      token: effectiveToken,
      host: isGitHubRepo(repoInfo)
        ? (repoInfo as GitHubRepoInfo).host
        : "github.com",
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    }
  : undefined;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="updateManifestOnly uses GH_TOKEN"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/repository-processor.ts src/repository-processor.test.ts
git commit -m "fix: use GH_TOKEN for git auth when no GitHub App token (updateManifestOnly)"
```

---

## Task 3: Make GitCommitStrategy use gitOps.push()

**Files:**

- Modify: `src/strategies/git-commit-strategy.ts`
- Test: `src/strategies/git-commit-strategy.test.ts`

**Step 1: Write the failing test**

Add test in `src/strategies/git-commit-strategy.test.ts`:

```typescript
test("uses gitOps.push() when gitOps is provided", async () => {
  const mockGitOps = {
    push: mock.fn(async () => {}),
  };

  const strategy = new GitCommitStrategy(mockExecutor);

  await strategy.commit({
    repoInfo: githubRepoInfo,
    branchName: "test-branch",
    message: "test commit",
    fileChanges: [{ path: "test.txt", content: "content" }],
    workDir: "/tmp/test",
    gitOps: mockGitOps as unknown as IAuthenticatedGitOps,
    force: true,
  });

  // Verify gitOps.push was called
  assert.strictEqual(
    mockGitOps.push.mock.calls.length,
    1,
    "gitOps.push should be called once"
  );
  assert.deepStrictEqual(mockGitOps.push.mock.calls[0].arguments, [
    "test-branch",
    { force: true },
  ]);

  // Verify raw git push was NOT called
  const pushCalls = mockExecutor.calls.filter((c) =>
    c.command.includes("git push")
  );
  assert.strictEqual(
    pushCalls.length,
    0,
    "Should not call raw git push when gitOps is provided"
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="uses gitOps.push"`
Expected: FAIL - raw git push is called instead of gitOps.push

**Step 3: Write minimal implementation**

In `src/strategies/git-commit-strategy.ts`, update the `commit` method:

```typescript
  async commit(options: CommitOptions): Promise<CommitResult> {
    const { branchName, message, workDir, retries = 3, force = true, gitOps } = options;

    // Stage all changes
    await this.executor.exec("git add -A", workDir);

    // Commit with the message (--no-verify to skip pre-commit hooks)
    await this.executor.exec(
      `git commit --no-verify -m ${escapeShellArg(message)}`,
      workDir
    );

    // Push with authentication via gitOps if available
    if (gitOps) {
      await gitOps.push(branchName, { force });
    } else {
      // Fallback for non-authenticated scenarios (shouldn't happen in practice)
      const forceFlag = force ? "--force-with-lease " : "";
      const pushCommand = `git push ${forceFlag}-u origin ${escapeShellArg(branchName)}`;
      await withRetry(() => this.executor.exec(pushCommand, workDir), {
        retries,
      });
    }

    // Get the commit SHA
    const sha = await this.executor.exec("git rev-parse HEAD", workDir);

    return {
      sha: sha.trim(),
      verified: false, // Git-based commits are not verified
      pushed: true,
    };
  }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="uses gitOps.push"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/strategies/git-commit-strategy.ts src/strategies/git-commit-strategy.test.ts
git commit -m "fix: GitCommitStrategy uses gitOps.push() for authenticated push"
```

---

## Task 4: Add test for GitCommitStrategy fallback (no gitOps)

**Files:**

- Test: `src/strategies/git-commit-strategy.test.ts`

**Step 1: Write the test**

```typescript
test("falls back to raw git push when gitOps is not provided", async () => {
  const strategy = new GitCommitStrategy(mockExecutor);

  await strategy.commit({
    repoInfo: githubRepoInfo,
    branchName: "test-branch",
    message: "test commit",
    fileChanges: [{ path: "test.txt", content: "content" }],
    workDir: "/tmp/test",
    // gitOps NOT provided
    force: true,
  });

  // Verify raw git push WAS called
  const pushCalls = mockExecutor.calls.filter((c) =>
    c.command.includes("git push")
  );
  assert.strictEqual(
    pushCalls.length,
    1,
    "Should call raw git push when no gitOps"
  );
  assert.ok(
    pushCalls[0].command.includes("--force-with-lease"),
    "Should use force flag"
  );
});
```

**Step 2: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="falls back to raw git push"`
Expected: PASS (this should already work)

**Step 3: Commit**

```bash
git add src/strategies/git-commit-strategy.test.ts
git commit -m "test: add coverage for GitCommitStrategy fallback path"
```

---

## Task 5: Run Full Test Suite and Lint

**Step 1: Build**

Run: `npm run build`
Expected: No TypeScript errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Run linter**

Run: `./lint.sh`
Expected: No lint errors

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address lint/test issues"
```

---

## Verification

After all tasks complete:

1. Push branch to trigger CI
2. CI should pass (unit tests + lint)
3. After merge to main, integration tests will run and should pass

---

## References

- Issue #316: Refactor - Simplify git authentication
- Issue #312: GitHub App auth integration testing
- PR #314: Fix missing env vars
- PR #315: Reset URL after clone (now removed)
- PR #319: Centralize git auth (this completes it)
