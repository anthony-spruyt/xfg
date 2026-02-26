# Executable Mode & Signed Refs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace unsigned `git push` in `ensureBranchExistsOnRemote` with GraphQL ref mutations (so repos with `required_signatures` on all branches work), and add a warning when GitHub App auth creates new executable files.

**Architecture:** Add three private GraphQL methods (`queryRemoteRef`, `createRemoteRef`, `deleteRemoteRef`) to `GraphQLCommitStrategy`, replace `ensureBranchExistsOnRemote` internals, add executable-file warning in `FileWriter`, update unit tests, add integration test with `required_signatures` ruleset, and update docs.

**Tech Stack:** TypeScript, Node.js test runner, GitHub GraphQL API (`createRef`/`deleteRef` mutations), `gh` CLI

---

### Task 1: Update JSDoc on `CommitOptions.gitOps`

**Files:**

- Modify: `src/vcs/types.ts:119-120`

**Step 1: Update the JSDoc**

In `src/vcs/types.ts`, change line 119:

```typescript
// Before:
/** Authenticated git operations wrapper (used by GraphQLCommitStrategy for network ops) */

// After:
/** Authenticated git operations wrapper (used by GraphQLCommitStrategy for fetchBranch() during OID mismatch retries) */
```

**Step 2: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: PASS -- no build errors

**Step 3: Commit**

```bash
git add src/vcs/types.ts
git commit -m "docs: update CommitOptions.gitOps JSDoc to reflect reduced scope"
```

---

### Task 2: Add GraphQL ref operation methods + new unit tests

**Files:**

- Modify: `src/vcs/graphql-commit-strategy.ts`
- Modify: `test/unit/vcs/graphql-commit-strategy.test.ts`

**Step 1: Write the failing tests**

Add a new `describe("ensureBranchExistsOnRemote (GraphQL ref operations)")` block inside the existing `describe("GraphQLCommitStrategy")` block, after the `describe("commit")` block. These tests call `commit()` which internally exercises the new GraphQL ref operations.

**Key testing pattern:** The mock executor matches commands via `command.includes(pattern)`. Since both ref operations and `createCommitOnBranch` use `gh api graphql`, use a counter-based function mock that returns different responses for each sequential call:

1. First `gh api graphql` call = `queryRemoteRef` response
2. Second call = `createRef` or `deleteRef` response (if applicable)
3. Final call = `createCommitOnBranch` response

```typescript
describe("ensureBranchExistsOnRemote (GraphQL ref operations)", () => {
  test("creates branch via GraphQL createRef when branch does not exist", async () => {
    const queryResponse = JSON.stringify({
      data: {
        repository: { id: "R_repo123", ref: null },
      },
    });
    const createRefResponse = JSON.stringify({
      data: { createRef: { ref: { id: "REF_new123" } } },
    });
    const commitResponse = JSON.stringify({
      data: { createCommitOnBranch: { commit: { oid: "newcommitsha" } } },
    });

    let graphqlCallCount = 0;
    mockExecutor.responses.set("git rev-parse HEAD", "abc123def456");
    mockExecutor.responses.set("git fetch", "");
    mockExecutor.responses.set("git rev-parse origin/", "abc123def456");
    mockExecutor.responses.set("gh api graphql", () => {
      graphqlCallCount++;
      if (graphqlCallCount === 1) return queryResponse;
      if (graphqlCallCount === 2) return createRefResponse;
      return commitResponse;
    });

    const strategy = new GraphQLCommitStrategy(mockExecutor);
    const result = await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "feature-branch",
      message: "Test",
      fileChanges: [{ path: "file.txt", content: "content" }],
      workDir: testDir,
      token: "ghs_test_token",
    });

    assert.equal(result.sha, "newcommitsha");

    const graphqlCalls = mockExecutor.calls.filter((c) =>
      c.command.includes("gh api graphql")
    );
    assert.ok(
      graphqlCalls.length >= 3,
      `Expected >= 3 GraphQL calls, got ${graphqlCalls.length}`
    );
    assert.ok(
      graphqlCalls[0].command.includes("repository(owner:"),
      "First call should be queryRemoteRef"
    );
    assert.ok(
      graphqlCalls[1].command.includes("createRef"),
      "Second call should be createRef"
    );

    // No git push or git ls-remote calls
    const pushCalls = mockExecutor.calls.filter((c) =>
      c.command.includes("git push")
    );
    assert.equal(pushCalls.length, 0, "Should NOT use git push");
    const lsRemoteCalls = mockExecutor.calls.filter((c) =>
      c.command.includes("git ls-remote")
    );
    assert.equal(lsRemoteCalls.length, 0, "Should NOT use git ls-remote");
  });

  test("deletes and recreates branch via GraphQL when force=true and branch exists", async () => {
    const queryResponse = JSON.stringify({
      data: { repository: { id: "R_repo123", ref: { id: "REF_existing456" } } },
    });
    const deleteRefResponse = JSON.stringify({
      data: { deleteRef: { clientMutationId: null } },
    });
    const createRefResponse = JSON.stringify({
      data: { createRef: { ref: { id: "REF_new789" } } },
    });
    const commitResponse = JSON.stringify({
      data: { createCommitOnBranch: { commit: { oid: "sha123" } } },
    });

    let graphqlCallCount = 0;
    mockExecutor.responses.set("git rev-parse HEAD", "headsha123");
    mockExecutor.responses.set("git fetch", "");
    mockExecutor.responses.set("git rev-parse origin/", "headsha123");
    mockExecutor.responses.set("gh api graphql", () => {
      graphqlCallCount++;
      if (graphqlCallCount === 1) return queryResponse;
      if (graphqlCallCount === 2) return deleteRefResponse;
      if (graphqlCallCount === 3) return createRefResponse;
      return commitResponse;
    });

    const strategy = new GraphQLCommitStrategy(mockExecutor);
    const result = await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "feature-branch",
      message: "Test",
      fileChanges: [{ path: "file.txt", content: "content" }],
      workDir: testDir,
      force: true,
      token: "ghs_test_token",
    });

    assert.equal(result.sha, "sha123");
    const graphqlCalls = mockExecutor.calls.filter((c) =>
      c.command.includes("gh api graphql")
    );
    assert.ok(
      graphqlCalls.length >= 4,
      `Expected >= 4 GraphQL calls, got ${graphqlCalls.length}`
    );
    assert.ok(
      graphqlCalls[1].command.includes("deleteRef"),
      "Second call should be deleteRef"
    );
    assert.ok(
      graphqlCalls[2].command.includes("createRef"),
      "Third call should be createRef"
    );
    const pushCalls = mockExecutor.calls.filter((c) =>
      c.command.includes("git push")
    );
    assert.equal(pushCalls.length, 0, "Should NOT use git push");
  });

  test("does not delete or create ref when force=false and branch exists", async () => {
    const queryResponse = JSON.stringify({
      data: { repository: { id: "R_repo123", ref: { id: "REF_existing456" } } },
    });
    const commitResponse = JSON.stringify({
      data: { createCommitOnBranch: { commit: { oid: "sha123" } } },
    });

    let graphqlCallCount = 0;
    mockExecutor.responses.set("git fetch", "");
    mockExecutor.responses.set("git rev-parse origin/", "abc123");
    mockExecutor.responses.set("gh api graphql", () => {
      graphqlCallCount++;
      if (graphqlCallCount === 1) return queryResponse;
      return commitResponse;
    });

    const strategy = new GraphQLCommitStrategy(mockExecutor);
    const result = await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "main",
      message: "Direct commit",
      fileChanges: [{ path: "file.txt", content: "content" }],
      workDir: testDir,
      force: false,
      token: "ghs_test_token",
    });

    assert.equal(result.sha, "sha123");
    const graphqlCalls = mockExecutor.calls.filter((c) =>
      c.command.includes("gh api graphql")
    );
    assert.equal(
      graphqlCalls.length,
      2,
      `Expected 2 GraphQL calls, got ${graphqlCalls.length}`
    );
    assert.ok(
      !graphqlCalls.some((c) => c.command.includes("deleteRef")),
      "Should NOT call deleteRef"
    );
    assert.ok(
      !graphqlCalls.some((c) => c.command.includes("createRef")),
      "Should NOT call createRef"
    );
  });

  test("includes --hostname flag for GitHub Enterprise in ref operations", async () => {
    const queryResponse = JSON.stringify({
      data: { repository: { id: "R_ghe_repo", ref: null } },
    });
    const createRefResponse = JSON.stringify({
      data: { createRef: { ref: { id: "REF_ghe_new" } } },
    });
    const commitResponse = JSON.stringify({
      data: { createCommitOnBranch: { commit: { oid: "ghesha" } } },
    });

    let graphqlCallCount = 0;
    mockExecutor.responses.set("git rev-parse HEAD", "gheheadsha");
    mockExecutor.responses.set("git fetch", "");
    mockExecutor.responses.set("git rev-parse origin/", "gheheadsha");
    mockExecutor.responses.set("gh api graphql", () => {
      graphqlCallCount++;
      if (graphqlCallCount === 1) return queryResponse;
      if (graphqlCallCount === 2) return createRefResponse;
      return commitResponse;
    });

    const strategy = new GraphQLCommitStrategy(mockExecutor);
    await strategy.commit({
      repoInfo: gheRepoInfo,
      branchName: "feature",
      message: "GHE commit",
      fileChanges: [{ path: "file.txt", content: "content" }],
      workDir: testDir,
      token: "ghs_ghe_token",
    });

    const graphqlCalls = mockExecutor.calls.filter((c) =>
      c.command.includes("gh api graphql")
    );
    for (const call of graphqlCalls) {
      assert.ok(
        call.command.includes("--hostname") &&
          call.command.includes("github.enterprise.com"),
        `GraphQL call should include GHE hostname: ${call.command.substring(0, 100)}...`
      );
    }
  });

  test("propagates GraphQL query error from queryRemoteRef", async () => {
    mockExecutor.responses.set("gh api graphql", () => {
      throw new Error(
        "Command failed: gh api graphql\nGraphQL: Could not resolve to a Repository"
      );
    });

    const strategy = new GraphQLCommitStrategy(mockExecutor);
    await assert.rejects(
      () =>
        strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "feature",
          message: "Test",
          fileChanges: [{ path: "f.txt", content: "c" }],
          workDir: testDir,
          token: "ghs_token",
        }),
      /Could not resolve|GraphQL|failed/i,
      "Should propagate queryRemoteRef errors"
    );
  });

  test("propagates createRef failure after deleteRef success", async () => {
    const queryResponse = JSON.stringify({
      data: { repository: { id: "R_repo123", ref: { id: "REF_existing" } } },
    });
    const deleteRefResponse = JSON.stringify({
      data: { deleteRef: { clientMutationId: null } },
    });

    let graphqlCallCount = 0;
    mockExecutor.responses.set("git rev-parse HEAD", "headsha");
    mockExecutor.responses.set("git fetch", "");
    mockExecutor.responses.set("git rev-parse origin/", "headsha");
    mockExecutor.responses.set("gh api graphql", () => {
      graphqlCallCount++;
      if (graphqlCallCount === 1) return queryResponse;
      if (graphqlCallCount === 2) return deleteRefResponse;
      // createRef fails
      throw new Error(
        "Command failed: gh api graphql\nGraphQL: Name already exists"
      );
    });

    const strategy = new GraphQLCommitStrategy(mockExecutor);
    await assert.rejects(
      () =>
        strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "feature-branch",
          message: "Test",
          fileChanges: [{ path: "f.txt", content: "c" }],
          workDir: testDir,
          force: true,
          token: "ghs_token",
        }),
      /Name already exists|GraphQL|failed/i,
      "Should propagate createRef error even after successful deleteRef"
    );
  });

  test("uses token in GraphQL ref operation commands", async () => {
    const queryResponse = JSON.stringify({
      data: { repository: { id: "R_repo", ref: null } },
    });
    const createRefResponse = JSON.stringify({
      data: { createRef: { ref: { id: "REF_new" } } },
    });
    const commitResponse = JSON.stringify({
      data: { createCommitOnBranch: { commit: { oid: "sha" } } },
    });

    let graphqlCallCount = 0;
    mockExecutor.responses.set("git rev-parse HEAD", "headsha");
    mockExecutor.responses.set("git fetch", "");
    mockExecutor.responses.set("git rev-parse origin/", "headsha");
    mockExecutor.responses.set("gh api graphql", () => {
      graphqlCallCount++;
      if (graphqlCallCount === 1) return queryResponse;
      if (graphqlCallCount === 2) return createRefResponse;
      return commitResponse;
    });

    const strategy = new GraphQLCommitStrategy(mockExecutor);
    await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "feature",
      message: "Test",
      fileChanges: [{ path: "f.txt", content: "c" }],
      workDir: testDir,
      token: "ghs_my_secret_token",
    });

    const graphqlCalls = mockExecutor.calls.filter((c) =>
      c.command.includes("gh api graphql")
    );
    // First two calls are ref operations (query + create)
    for (let i = 0; i < 2; i++) {
      assert.ok(
        graphqlCalls[i].command.includes("GH_TOKEN=ghs_my_secret_token"),
        `GraphQL ref call ${i} should include token`
      );
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "ensureBranchExistsOnRemote" 2>&1 | tail -20`
Expected: FAIL -- current code uses `git ls-remote` and `git push`, not GraphQL

**Step 3: Add `GRAPHQL_PERMANENT_ERROR_PATTERNS` static field**

Add to `GraphQLCommitStrategy` class, after the `executor` field declaration:

```typescript
/**
 * GraphQL permanent error patterns for ref operations.
 * Differs from DEFAULT_PERMANENT_ERROR_PATTERNS which has
 * git-CLI-specific patterns (/remote\s*rejected/i) that don't
 * apply to GraphQL responses.
 */
private static readonly GRAPHQL_PERMANENT_ERROR_PATTERNS: RegExp[] = [
  /not\s*found/i,
  /unauthorized/i,
  /permission\s*denied/i,
  /bad\s*credentials/i,
  /invalid\s*(token|credentials)/i,
  /401\b/,
  /403\b/,
  /does\s*not\s*exist/i,
  /could\s*not\s*resolve/i,
];
```

**Step 4: Implement `queryRemoteRef`**

Add after `isHeadOidMismatchError`:

```typescript
/**
 * Query the remote for a repository's Node ID and a ref's Node ID.
 * Returns repositoryId (always) and refId (null if branch doesn't exist).
 */
private async queryRemoteRef(
  repoInfo: GitHubRepoInfo,
  branchName: string,
  workDir: string,
  token?: string
): Promise<{ repositoryId: string; refId: string | null }> {
  const query = `{ repository(owner: ${JSON.stringify(repoInfo.owner)}, name: ${JSON.stringify(repoInfo.repo)}) { id ref(qualifiedName: ${JSON.stringify(`refs/heads/${branchName}`)}) { id } } }`;
  const requestBody = JSON.stringify({ query });

  const hostnameArg =
    repoInfo.host !== "github.com"
      ? `--hostname ${escapeShellArg(repoInfo.host)}`
      : "";
  const tokenPrefix = token ? `GH_TOKEN=${token} ` : "";
  const command = `echo ${escapeShellArg(requestBody)} | ${tokenPrefix}gh api graphql ${hostnameArg} --input -`;

  let response: string;
  try {
    response = await withRetry(() => this.executor.exec(command, workDir), {
      permanentErrorPatterns: GraphQLCommitStrategy.GRAPHQL_PERMANENT_ERROR_PATTERNS,
    });
  } catch (error) {
    throw this.sanitizeCommandError(error, `${repoInfo.owner}/${repoInfo.repo}`);
  }

  const parsed = JSON.parse(response);
  if (parsed.errors) {
    throw new Error(
      `GraphQL error: ${parsed.errors.map((e: { message: string }) => e.message).join(", ")}`
    );
  }

  const repositoryId = parsed.data?.repository?.id;
  if (!repositoryId) {
    throw new Error(`GraphQL response missing repository ID for ${repoInfo.owner}/${repoInfo.repo}`);
  }

  return { repositoryId, refId: parsed.data?.repository?.ref?.id ?? null };
}
```

**Step 5: Implement `createRemoteRef`**

Add after `queryRemoteRef`:

```typescript
/**
 * Create a branch ref on the remote via GraphQL createRef mutation.
 */
private async createRemoteRef(
  repositoryId: string,
  branchName: string,
  oid: string,
  workDir: string,
  repoInfo: GitHubRepoInfo,
  token?: string
): Promise<void> {
  const mutation = `mutation { createRef(input: { repositoryId: ${JSON.stringify(repositoryId)}, name: ${JSON.stringify(`refs/heads/${branchName}`)}, oid: ${JSON.stringify(oid)} }) { ref { id } } }`;
  const requestBody = JSON.stringify({ query: mutation });

  const hostnameArg =
    repoInfo.host !== "github.com"
      ? `--hostname ${escapeShellArg(repoInfo.host)}`
      : "";
  const tokenPrefix = token ? `GH_TOKEN=${token} ` : "";
  const command = `echo ${escapeShellArg(requestBody)} | ${tokenPrefix}gh api graphql ${hostnameArg} --input -`;

  let response: string;
  try {
    response = await withRetry(() => this.executor.exec(command, workDir), {
      permanentErrorPatterns: GraphQLCommitStrategy.GRAPHQL_PERMANENT_ERROR_PATTERNS,
    });
  } catch (error) {
    throw this.sanitizeCommandError(error, `${repoInfo.owner}/${repoInfo.repo}`);
  }

  const parsed = JSON.parse(response);
  if (parsed.errors) {
    throw new Error(
      `GraphQL error: ${parsed.errors.map((e: { message: string }) => e.message).join(", ")}`
    );
  }
}
```

**Step 6: Implement `deleteRemoteRef`**

Add after `createRemoteRef`:

```typescript
/**
 * Delete a branch ref on the remote via GraphQL deleteRef mutation.
 */
private async deleteRemoteRef(
  refId: string,
  workDir: string,
  repoInfo: GitHubRepoInfo,
  token?: string
): Promise<void> {
  const mutation = `mutation { deleteRef(input: { refId: ${JSON.stringify(refId)} }) { clientMutationId } }`;
  const requestBody = JSON.stringify({ query: mutation });

  const hostnameArg =
    repoInfo.host !== "github.com"
      ? `--hostname ${escapeShellArg(repoInfo.host)}`
      : "";
  const tokenPrefix = token ? `GH_TOKEN=${token} ` : "";
  const command = `echo ${escapeShellArg(requestBody)} | ${tokenPrefix}gh api graphql ${hostnameArg} --input -`;

  let response: string;
  try {
    response = await withRetry(() => this.executor.exec(command, workDir), {
      permanentErrorPatterns: GraphQLCommitStrategy.GRAPHQL_PERMANENT_ERROR_PATTERNS,
    });
  } catch (error) {
    throw this.sanitizeCommandError(error, `${repoInfo.owner}/${repoInfo.repo}`);
  }

  const parsed = JSON.parse(response);
  if (parsed.errors) {
    throw new Error(
      `GraphQL error: ${parsed.errors.map((e: { message: string }) => e.message).join(", ")}`
    );
  }
}
```

**Step 7: Replace `ensureBranchExistsOnRemote`**

Replace the entire method (lines 305-355):

```typescript
/**
 * Ensure the branch exists on the remote and matches local HEAD.
 * createCommitOnBranch requires the branch to already exist.
 *
 * Uses GraphQL ref mutations instead of git push to support repos
 * with required_signatures on all branches.
 *
 * For PR branches (force=true): delete existing remote branch and recreate
 * from local HEAD to ensure a fresh start from main.
 *
 * For direct mode (force=false): just ensure branch exists.
 */
private async ensureBranchExistsOnRemote(
  branchName: string,
  workDir: string,
  force?: boolean,
  repoInfo?: GitHubRepoInfo,
  token?: string
): Promise<void> {
  if (!repoInfo) {
    throw new Error("repoInfo is required for GraphQL ref operations");
  }

  const { repositoryId, refId } = await this.queryRemoteRef(
    repoInfo,
    branchName,
    workDir,
    token
  );

  if (refId && force) {
    // Branch exists + force: delete then recreate from local HEAD
    await this.deleteRemoteRef(refId, workDir, repoInfo, token);
    const sha = (await this.executor.exec("git rev-parse HEAD", workDir)).trim();
    await this.createRemoteRef(repositoryId, branchName, sha, workDir, repoInfo, token);
  } else if (!refId) {
    // Branch doesn't exist: create from local HEAD
    const sha = (await this.executor.exec("git rev-parse HEAD", workDir)).trim();
    await this.createRemoteRef(repositoryId, branchName, sha, workDir, repoInfo, token);
  }
  // refId exists + !force: no-op (branch already exists)
}
```

**Step 8: Update the call site in `commit()`**

Change lines 125-130 from:

```typescript
await this.ensureBranchExistsOnRemote(
  branchName,
  workDir,
  options.force,
  gitOps
);
```

To:

```typescript
await this.ensureBranchExistsOnRemote(
  branchName,
  workDir,
  options.force,
  githubInfo,
  token
);
```

**Step 9: Run the new tests**

Run: `npm test -- --test-name-pattern "ensureBranchExistsOnRemote" 2>&1 | tail -30`
Expected: PASS

**Step 10: Commit**

```bash
git add src/vcs/graphql-commit-strategy.ts test/unit/vcs/graphql-commit-strategy.test.ts
git commit -m "feat: replace git push with GraphQL ref mutations in ensureBranchExistsOnRemote"
```

---

### Task 3: Delete old tests and update remaining test mocks

**Files:**

- Modify: `test/unit/vcs/graphql-commit-strategy.test.ts`

**Step 1: Delete old tests**

Delete these tests from `describe("commit")` (they test removed `git push`/`lsRemote` behavior):

1. **"pushes branch to remote if it does not exist"** (~line 484)
2. **"deletes and recreates branch when force=true and branch exists"** (~line 529)
3. **"does not delete branch when force=false and branch exists"** (~line 576)
4. **"uses gitOps for push commands when force=true (GitHub App auth)"** (~line 840)
5. **"uses gitOps for push when branch does not exist (GitHub App auth)"** (~line 906)
6. **"uses gitOps for fetch and ls-remote commands (GitHub App auth)"** (~line 962)
7. **"uses gitOps for GitHub Enterprise repos"** (~line 1011)

**Step 2: Update remaining tests to use GraphQL mocks instead of `git ls-remote`**

For each remaining test in `describe("commit")` that uses `mockExecutor.responses.set("git ls-remote", ...)`:

Replace with a counter-based `gh api graphql` mock that returns:

1. First call: `queryRemoteRef` response (branch exists, no force needed)
2. Subsequent calls: the original `createCommitOnBranch` response

**Pattern for each test:**

```typescript
// REMOVE these lines:
mockExecutor.responses.set("git ls-remote", "abc123\trefs/heads/...");
// And if present:
mockExecutor.responses.set("git push", "...");
mockExecutor.responses.set("git push origin --delete", "...");
mockExecutor.responses.set("git push -u", "...");

// REPLACE the gh api graphql mock with:
const queryRefResponse = JSON.stringify({
  data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
});
let graphqlCallCount = 0;
mockExecutor.responses.set("gh api graphql", () => {
  graphqlCallCount++;
  if (graphqlCallCount === 1) return queryRefResponse;
  return /* original response */;
});
```

**Special case: "retries on expectedHeadOid mismatch" test** -- its counter-based mock already exists for `gh api graphql`. Update it to account for the queryRemoteRef call being the first call:

```typescript
// queryRemoteRef is call 1, then the OID mismatch retry logic starts at call 2
const queryRefResponse = JSON.stringify({
  data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
});
let graphqlCallCount = 0;
mockExecutor.responses.set("gh api graphql", () => {
  graphqlCallCount++;
  if (graphqlCallCount === 1) return queryRefResponse; // queryRemoteRef
  if (graphqlCallCount === 2) {
    // First createCommitOnBranch attempt -- OID mismatch
    throw new Error(
      "Expected branch to point to abc123 but it points to xyz789"
    );
  }
  return JSON.stringify({
    data: { createCommitOnBranch: { commit: { oid: "successsha" } } },
  });
});
```

Also update the assertion from `graphqlCallCount === 2` to `graphqlCallCount === 3` (1 queryRemoteRef + 1 OID mismatch + 1 success).

**Special case: "should not waste inner retries on OID mismatch errors" test** -- currently its counter starts at call 1. Update:

```typescript
const queryRefResponse = JSON.stringify({
  data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
});
let graphqlCallCount = 0;
mockExecutor.responses.set("gh api graphql", () => {
  graphqlCallCount++;
  if (graphqlCallCount === 1) return queryRefResponse; // queryRemoteRef
  if (graphqlCallCount === 2) {
    // createCommitOnBranch -- OID mismatch
    throw new Error(
      "Expected branch to point to abc123 but it points to xyz789"
    );
  }
  return JSON.stringify({
    data: { createCommitOnBranch: { commit: { oid: "successsha" } } },
  });
});
```

Also update the assertion from `graphqlCallCount === 2` to `graphqlCallCount === 3` (1 queryRemoteRef + 1 OID mismatch + 1 success).

**Special case: "should retry GraphQL API call on transient network error" test** -- same adjustment: queryRemoteRef is call 1, transient error on call 2, success on call 3.

**Special case: "uses token parameter for authorization when provided" test** -- update assertions to check that token appears in ref operation calls too (or only check the createCommitOnBranch call by index).

**Special case: "sanitizes error messages to exclude GraphQL payload" test** -- replace `git ls-remote` mock with counter-based GraphQL mock; the sanitization error happens on createCommitOnBranch (call 2), not queryRemoteRef (call 1).

**Step 3: Run all tests**

Run: `npm test 2>&1 | tail -30`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add test/unit/vcs/graphql-commit-strategy.test.ts
git commit -m "refactor(test): remove old git push/lsRemote tests, update mocks for GraphQL ref ops"
```

---

### Task 4: Lint check

**Files:** None (verification only)

**Step 1: Run lint**

Run: `./lint.sh 2>&1 | tail -30`
Expected: PASS

**Step 2: Fix any lint issues and commit if needed**

```bash
git add -A
git commit -m "fix: lint issues from GraphQL ref operations"
```

---

### Task 5: Add executable file warning in FileWriter

**Files:**

- Modify: `src/sync/file-writer.ts`
- Modify: test file for FileWriter (find it first)

**Step 1: Find existing FileWriter tests**

Look for `test/unit/sync/file-writer.test.ts` or search for tests that import `FileWriter` or `shouldBeExecutable`.

**Step 2: Write the failing test**

Add a test that verifies: when `shouldBeExecutable()` returns true, the file action is `"create"`, and `hasGitHubAppCredentials()` returns true, a warning is logged via `log.info()` containing "cannot set executable mode".

**Important:** `ILogger` has no `warn()` method. The warning MUST use `log.info()` with a warning prefix. The mock logger captures `info()` calls in its `messages[]` array, so assert against that.

Since `hasGitHubAppCredentials()` reads `process.env`, set the env vars in the test and restore after:

```typescript
test("warns when creating new executable file under GitHub App auth", async () => {
  const origAppId = process.env.XFG_GITHUB_APP_ID;
  const origKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;
  process.env.XFG_GITHUB_APP_ID = "12345";
  process.env.XFG_GITHUB_APP_PRIVATE_KEY = "fake-key";

  try {
    const writtenFiles: Array<{ fileName: string; content: string }> = [];
    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      fileExists: false,
      wouldChange: true,
      onWriteFile: (fileName, content) => {
        writtenFiles.push({ fileName, content });
      },
    });
    const { mock: mockLogger, messages } = createMockLogger();

    const writer = new FileWriter();
    const files: FileContent[] = [
      {
        fileName: "deploy.sh",
        content: "#!/bin/bash\necho hello",
      },
    ];

    await writer.writeFiles(
      files,
      {
        repoInfo: mockRepoInfo,
        baseBranch: "main",
        workDir,
        dryRun: false,
        noDelete: false,
        configId: "test",
      },
      {
        gitOps: mockGitOps,
        log: mockLogger,
      }
    );

    const warningMsg = messages.find((m) =>
      /cannot set executable mode/i.test(m)
    );
    assert.ok(
      warningMsg,
      `Expected warning about executable mode, got messages: ${JSON.stringify(messages)}`
    );
  } finally {
    if (origAppId === undefined) delete process.env.XFG_GITHUB_APP_ID;
    else process.env.XFG_GITHUB_APP_ID = origAppId;
    if (origKey === undefined) delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
    else process.env.XFG_GITHUB_APP_PRIVATE_KEY = origKey;
  }
});
```

**Step 3: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "warns when creating new executable" 2>&1 | tail -20`
Expected: FAIL -- no warning logged yet

**Step 4: Add the warning**

In `src/sync/file-writer.ts`, add import:

```typescript
import { hasGitHubAppCredentials } from "../vcs/commit-strategy-selector.js";
```

In the Step 2 loop (~line 145), change:

```typescript
// Before:
if (shouldBeExecutable(file)) {
  log.info(`Setting executable: ${file.fileName}`);
  await gitOps.setExecutable(file.fileName);
}

// After:
if (shouldBeExecutable(file)) {
  const tracked = fileChanges.get(file.fileName);
  if (tracked?.action === "create" && hasGitHubAppCredentials()) {
    log.info(
      `Warning: ${file.fileName}: GitHub App commits cannot set executable mode on new files. ` +
        `The file will be created as non-executable (100644). ` +
        `See: https://anthony-spruyt.github.io/xfg/examples/executable-files/`
    );
  }
  log.info(`Setting executable: ${file.fileName}`);
  await gitOps.setExecutable(file.fileName);
}
```

**Step 5: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "warns when creating new executable" 2>&1 | tail -20`
Expected: PASS

**Step 6: Run all tests**

Run: `npm test 2>&1 | tail -20`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/sync/file-writer.ts test/unit/sync/file-writer.test.ts
git commit -m "feat: warn when GitHub App creates new executable files"
```

---

### Task 6: Add integration test for signed refs

**Files:**

- Create: `test/fixtures/integration-test-github-app-signed-refs-settings.yaml`
- Modify: `test/integration/github-app.test.ts`

**Step 1: Create the settings fixture**

Create `test/fixtures/integration-test-github-app-signed-refs-settings.yaml`:

```yaml
# Settings fixture to enforce signed commits on all branches of xfg-test-2.
# Applied after reset in beforeEach to validate GraphQL ref operations
# work when unsigned git push would be rejected.
id: integration-test-github-app-signed-refs-settings

# Placeholder file required by schema - excluded from target repo
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

**Step 2: Add the new `describe` block**

In `test/integration/github-app.test.ts`, add after the last `describe` block:

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

**Step 3: Run unit tests (integration tests skip without credentials)**

Run: `npm test 2>&1 | tail -20`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add test/fixtures/integration-test-github-app-signed-refs-settings.yaml test/integration/github-app.test.ts
git commit -m "test: add integration test for signed refs with required_signatures"
```

---

### Task 7: Update documentation

**Files:**

- Modify: `docs/examples/executable-files.md`
- Modify: `docs/platforms/github-app.md`

**Step 1: Add "GitHub App Limitation" section to `docs/examples/executable-files.md`**

Append after the Summary table at the end of the file:

````markdown
## GitHub App Limitation

When using GitHub App authentication, xfg uses the `createCommitOnBranch` GraphQL API to create verified (signed) commits. This API does not support setting file modes.

**Impact:**

- New executable files are created as `100644` (non-executable) on the remote
- Updating an existing file preserves whatever mode it already has -- if a file is `100755`, it stays `100755`

**Workaround:**

After the first sync creates the file, manually set it to executable:

```bash
git update-index --chmod=+x path/to/script.sh
git commit -m "fix: set executable mode"
git push
```

All future xfg syncs will preserve the `100755` mode.

**PAT authentication** is not affected -- it uses `git commit` which correctly records file modes.
````

**Step 2: Add 5th limitation to `docs/platforms/github-app.md`**

After item `4. **Atomic commits**`, add:

```markdown
5. **Executable file modes** -- The `createCommitOnBranch` GraphQL API cannot set file modes. New `.sh` files (or files with `executable: true`) are created as non-executable. See [Executable Files -- GitHub App Limitation](../examples/executable-files.md#github-app-limitation) for details and workaround.
```

**Step 3: Run lint**

Run: `./lint.sh 2>&1 | tail -10`
Expected: PASS

**Step 4: Commit**

```bash
git add docs/examples/executable-files.md docs/platforms/github-app.md
git commit -m "docs: document executable file mode limitation with GitHub App auth"
```

---

### Task 8: Final verification

**Files:** None (verification only)

**Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -30`
Expected: ALL PASS

**Step 2: Run lint**

Run: `./lint.sh 2>&1 | tail -20`
Expected: PASS

**Step 3: Build**

Run: `npm run build 2>&1 | tail -10`
Expected: PASS

**Step 4: Review commit log**

Run: `git log --oneline main..HEAD`
Expected: 5-7 commits covering JSDoc, GraphQL ref ops, test updates, executable warning, integration test, docs

---

### Task 9: Post-merge cleanup (manual)

After the PR is merged and CI passes on main:

```bash
gh repo delete anthony-spruyt/xfg-mode-test --yes
```
