# Transient Error Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `withRetry()` to the 3 strategy methods that lack transient error handling, closing issue #422.

**Architecture:** Wrap command executor calls in `withRetry()` inside `GitHubRepoSettingsStrategy.ghApi()`, `GitHubRulesetStrategy.ghApi()`, and `GraphQLCommitStrategy.executeGraphQLMutation()`. Follows the identical pattern already used in `GitHubPRStrategy`, `AzurePRStrategy`, `GitLabPRStrategy`, and `GitHubLifecycleProvider`.

**Tech Stack:** TypeScript, `p-retry` (already a dependency via `retry-utils.ts`), Node.js test runner

---

### Task 1: Add retry to GitHubRepoSettingsStrategy

**Files:**

- Modify: `src/settings/repo-settings/github-repo-settings-strategy.ts` (import + ghApi method)
- Test: `test/unit/settings/repo-settings/github-repo-settings-strategy.test.ts`

**Step 1: Write failing test for transient error retry**

Add a `describe("retry behavior")` block at the end of the top-level `describe("GitHubRepoSettingsStrategy")` block. Tests use inline `ICommandExecutor` implementations for precise call-count tracking:

- Test 1: "should retry on transient error and succeed" — executor throws `"Connection timed out"` on first PATCH call, succeeds on second. Assert `callCount >= 2`.
- Test 2: "should not retry on permanent error" — executor always throws `"gh: Not Found (HTTP 404)"` on PATCH. Assert `callCount === 1`.
- Test 3: "should still return false for 404 on vulnerability-alerts with retry enabled" — executor throws `"gh: Not Found (HTTP 404)"` for vulnerability-alerts endpoint. Assert `result.vulnerability_alerts === false` and `callCount === 1`.

**Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/settings/repo-settings/github-repo-settings-strategy.test.ts`
Expected: FAIL — "should retry on transient error and succeed" fails because `callCount` is 1 (no retry)

**Step 3: Add withRetry to ghApi()**

- Add import: `import { withRetry } from "../../shared/retry-utils.js";`
- In `ghApi()`, wrap both `return await this.executor...` calls with `withRetry(() => this.executor...)`

**Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/settings/repo-settings/github-repo-settings-strategy.test.ts`
Expected: PASS

Note: The existing "should throw on non-404 errors for vulnerability_alerts" test (HTTP 500) will be slower (~7s) because 500 is a transient error that gets retried before failing. This is correct and desired behavior — the test still passes.

**Step 5: Commit**

```bash
git add src/settings/repo-settings/github-repo-settings-strategy.ts test/unit/settings/repo-settings/github-repo-settings-strategy.test.ts
git commit -m "feat: add transient error retry to GitHubRepoSettingsStrategy (#422)"
```

---

### Task 2: Add retry to GitHubRulesetStrategy

**Files:**

- Modify: `src/settings/rulesets/github-ruleset-strategy.ts` (import + ghApi method)
- Test: `test/unit/settings/rulesets/github-ruleset-strategy.test.ts`

**Step 1: Write failing test for transient error retry**

Add a `describe("retry behavior")` block at the end of the `describe("GitHubRulesetStrategy")` block. Tests use inline `ICommandExecutor` implementations:

- Test 1: "should retry on transient error and succeed" — executor throws `"Connection timed out"` on first `/rulesets` call, returns `"[]"` on second. Assert `callCount >= 2`.
- Test 2: "should not retry on permanent error" — executor always throws `"gh: Not Found (HTTP 404)"` for `/rulesets`. Assert `callCount === 1`.

**Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/settings/rulesets/github-ruleset-strategy.test.ts`
Expected: FAIL

**Step 3: Add withRetry to ghApi()**

- Add import: `import { withRetry } from "../../shared/retry-utils.js";`
- In `ghApi()`, wrap both `return await this.executor...` calls with `withRetry(() => this.executor...)`

**Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/settings/rulesets/github-ruleset-strategy.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/settings/rulesets/github-ruleset-strategy.ts test/unit/settings/rulesets/github-ruleset-strategy.test.ts
git commit -m "feat: add transient error retry to GitHubRulesetStrategy (#422)"
```

---

### Task 3: Add retry to GraphQLCommitStrategy

**Files:**

- Modify: `src/vcs/graphql-commit-strategy.ts` (import + executeGraphQLMutation)
- Test: `test/unit/vcs/graphql-commit-strategy.test.ts`

**Step 1: Write failing test for transient error retry on GraphQL call**

Add to the `describe("commit")` block. The existing mock executor already supports function-based responses for call-count tracking:

- Test 1: "should retry GraphQL API call on transient network error" — GraphQL call throws `"Connection timed out"` on first attempt, succeeds on second. Assert `graphqlCallCount >= 2` and result SHA is correct.
- Test 2: "should not retry GraphQL API call on permanent error" — GraphQL call always throws `"gh: Authentication failed (HTTP 401)"`. Assert `graphqlCallCount === 1`.

**Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/vcs/graphql-commit-strategy.test.ts`
Expected: FAIL — "should retry GraphQL API call on transient network error" fails

**Step 3: Add withRetry to executeGraphQLMutation()**

- Add import: `import { withRetry } from "../shared/retry-utils.js";`
- Replace `const response = await this.executor...` (line 248) with `const response = await withRetry(() => this.executor...)`

The existing OID-mismatch retry loop in `commit()` is unchanged — it handles optimistic locking, not network errors.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/vcs/graphql-commit-strategy.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/vcs/graphql-commit-strategy.ts test/unit/vcs/graphql-commit-strategy.test.ts
git commit -m "feat: add transient error retry to GraphQLCommitStrategy (#422)"
```

---

### Task 4: Run full test suite and lint

**Step 1: Build**

Run: `npm run build`
Expected: No compilation errors

**Step 2: Run full unit test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Run linter**

Run: `./lint.sh`
Expected: No lint errors

**Step 4: Verify all changes**

Run: `git diff --stat main`
Expected: 6 files changed (3 source + 3 test files)
