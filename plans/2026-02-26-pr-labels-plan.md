# PR Labels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `labels` support to `prOptions` so PRs created during sync can have labels applied automatically (GitHub only).

**Architecture:** Add `labels?: string[]` to three interfaces (`PRMergeOptions`, `PROptions`, `PRStrategyOptions`), wire it through the normalizer and PR creation call chain, and append `--label` flags to the `gh pr create` command in `GitHubPRStrategy`.

**Tech Stack:** TypeScript, Node.js test runner, `gh` CLI

---

### Task 1: Add `labels` to `PRMergeOptions` type

**Files:**

- Modify: `src/config/types.ts:10-15`

**Step 1: Write the failing test**

Add to `test/unit/config-normalizer.test.ts` at the end of the top-level describe block:

```typescript
describe("PR options merging", () => {
  test("global labels propagate to repo", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "config.json": { content: { key: "value" } } },
      repos: [{ git: "git@github.com:org/repo.git" }],
      prOptions: {
        labels: ["config-sync", "automated"],
      },
    };

    const result = normalizeConfig(raw);
    assert.deepEqual(result.repos[0].prOptions?.labels, [
      "config-sync",
      "automated",
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "global labels propagate to repo" 2>&1 | tail -20`
Expected: FAIL — TypeScript compilation error, `labels` does not exist on `PRMergeOptions`

**Step 3: Add `labels` to `PRMergeOptions`**

In `src/config/types.ts`, add after line 14 (`bypassReason?: string;`):

```typescript
  labels?: string[];
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "global labels propagate to repo" 2>&1 | tail -20`
Expected: PASS — global prOptions flow through to repo config

**Step 5: Commit**

```bash
git add src/config/types.ts test/unit/config-normalizer.test.ts
git commit -m "feat(config): add labels field to PRMergeOptions type"
```

---

### Task 2: Add labels merging in normalizer

**Files:**

- Modify: `src/config/normalizer.ts:39-59` (`mergePROptions`)
- Modify: `test/unit/config-normalizer.test.ts`

**Step 1: Write the failing tests**

Add these tests inside the `describe("PR options merging")` block from Task 1:

```typescript
test("per-repo labels replace global labels", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: { key: "value" } } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        prOptions: {
          labels: ["critical-config"],
        },
      },
    ],
    prOptions: {
      labels: ["config-sync", "automated"],
    },
  };

  const result = normalizeConfig(raw);
  assert.deepEqual(result.repos[0].prOptions?.labels, ["critical-config"]);
});

test("per-repo empty labels array clears global labels", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: { key: "value" } } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        prOptions: {
          labels: [],
        },
      },
    ],
    prOptions: {
      labels: ["config-sync"],
    },
  };

  const result = normalizeConfig(raw);
  assert.deepEqual(result.repos[0].prOptions?.labels, []);
});

test("repo without labels inherits global labels", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: { key: "value" } } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        prOptions: {
          merge: "manual",
        },
      },
    ],
    prOptions: {
      labels: ["config-sync"],
      merge: "auto",
    },
  };

  const result = normalizeConfig(raw);
  assert.deepEqual(result.repos[0].prOptions?.labels, ["config-sync"]);
  assert.equal(result.repos[0].prOptions?.merge, "manual");
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "per-repo labels|per-repo empty labels|repo without labels" 2>&1 | tail -20`
Expected: FAIL — `per-repo labels replace` fails because `mergePROptions` doesn't handle `labels` yet

**Step 3: Add labels merging to `mergePROptions`**

In `src/config/normalizer.ts`, inside `mergePROptions()`, after line 51 (`const bypassReason = ...`), add:

```typescript
const labels = perRepo.labels ?? global.labels;
```

After line 56 (`if (bypassReason !== undefined) result.bypassReason = bypassReason;`), add:

```typescript
if (labels !== undefined) result.labels = labels;
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "PR options merging" 2>&1 | tail -20`
Expected: PASS — all 4 PR options merging tests pass

**Step 5: Commit**

```bash
git add src/config/normalizer.ts test/unit/config-normalizer.test.ts
git commit -m "feat(config): add labels merging to mergePROptions"
```

---

### Task 3: Add `labels` to config schema

**Files:**

- Modify: `config-schema.json` (repository root, lines 234-269)

**Important context:** `validateRawConfig` in `src/config/validator.ts` is a hand-written validator — it does NOT use `config-schema.json` at runtime. The schema file is only for IDE/editor autocompletion. Runtime validation requires explicit code in `validator.ts`.

**Step 1: Write the failing tests**

Add to `test/unit/config-validator.test.ts` inside the `describe("validateRawConfig")` block (find an appropriate nested describe, or add a new one):

```typescript
describe("prOptions labels validation", () => {
  test("accepts valid labels array in prOptions", () => {
    const config = {
      id: "test",
      files: { "config.json": { content: { key: "value" } } },
      repos: [{ git: "git@github.com:org/repo.git" }],
      prOptions: {
        labels: ["config-sync", "automated"],
      },
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("throws when prOptions labels is not an array", () => {
    const config = {
      id: "test",
      files: { "config.json": { content: { key: "value" } } },
      repos: [{ git: "git@github.com:org/repo.git" }],
      prOptions: {
        labels: "not-an-array",
      },
    } as unknown as RawConfig;
    assert.throws(
      () => validateRawConfig(config),
      /prOptions\.labels must be an array/
    );
  });
});
```

Note: `validateRawConfig` throws on validation errors and returns void on success. Use `assert.doesNotThrow` for valid configs and `assert.throws` for invalid ones. This matches the existing test patterns throughout `test/unit/config-validator.test.ts`.

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "accepts valid labels array in prOptions|throws when prOptions labels is not an array" 2>&1 | tail -20`
Expected: FAIL — the "throws when not an array" test fails because no validation exists yet for `prOptions.labels`

**Step 3: Add labels validation to `validator.ts` and labels to schema**

In `src/config/validator.ts`, find the `validateRawConfig` function and add a check for `prOptions.labels` type. Look for where prOptions is accessed (search for `prOptions`) and add after the existing prOptions handling:

```typescript
// Validate prOptions.labels if present
if (
  config.prOptions?.labels !== undefined &&
  !Array.isArray(config.prOptions.labels)
) {
  throw new Error("prOptions.labels must be an array of strings");
}
```

In `config-schema.json`, inside the `prOptions` definition's `properties` object (after the closing `}` of `bypassReason` at line 267 — `bypassReason` starts at line 264, its closing `}` is at line 267, and the closing `}` of `properties` is at line 268), add:

```json
        "labels": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "description": "Labels to apply to created PRs/MRs. Labels must exist on the target repository."
        }
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "accepts valid labels array in prOptions|throws when prOptions labels is not an array" 2>&1 | tail -20`
Expected: PASS

**Step 5: Commit**

```bash
git add config-schema.json src/config/validator.ts test/unit/config-validator.test.ts
git commit -m "feat(config): add labels to prOptions schema and validation"
```

---

### Task 4: Wire labels through PR creation interfaces

**Files:**

- Modify: `src/vcs/types.ts:24-35` (`PRStrategyOptions`)
- Modify: `src/vcs/pr-creator.ts:18-33` (`PROptions`)
- Modify: `src/vcs/pr-creator.ts:147-183` (`createPR`)
- Modify: `src/sync/pr-merge-handler.ts:32-43` (the `createPR` call)

**Step 1: Write the failing test**

Add to `test/unit/sync/pr-merge-handler.test.ts` inside the `describe("createAndMerge")` block:

```typescript
test("passes labels to createPR", async () => {
  const { mock: mockLogger } = createMockLogger();
  const { mock: mockExecutor, calls } = createMockExecutor({
    responses: new Map([
      ["gh pr list", ""],
      ["gh pr create", "https://github.com/test/repo/pull/1"],
      ["gh pr merge", ""],
    ]),
  });

  const handler = new PRMergeHandler(mockLogger);
  const changedFiles: FileAction[] = [
    { fileName: "config.json", action: "create" },
  ];
  const repoConfig: RepoConfig = {
    gitUrl: mockRepoInfo.gitUrl,
    files: [],
    prOptions: {
      labels: ["config-sync", "automated"],
    },
  };

  await handler.createAndMerge(
    mockRepoInfo,
    repoConfig,
    {
      branchName: "chore/sync",
      baseBranch: "main",
      workDir,
      dryRun: false,
      retries: 1,
      executor: mockExecutor,
    },
    changedFiles,
    "test/repo"
  );

  const createCall = calls.find((c) => c.command.includes("gh pr create"));
  assert.ok(createCall, "gh pr create should have been called");
  assert.ok(
    createCall.command.includes("--label"),
    "gh pr create should include --label flag"
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "passes labels to createPR" 2>&1 | tail -20`
Expected: FAIL — `--label` not in the command because labels aren't wired through

**Step 3: Add `labels` to interfaces and wire through**

In `src/vcs/types.ts`, add after line 34 (`token?: string;`) inside `PRStrategyOptions`:

```typescript
  /** Labels to apply to the created PR */
  labels?: string[];
```

In `src/vcs/pr-creator.ts`, add after line 32 (`token?: string;`) inside `PROptions`:

```typescript
  /** Labels to apply to the created PR */
  labels?: string[];
```

In `src/vcs/pr-creator.ts`, in the `createPR` function destructuring at line 148, add `labels`:

```typescript
const {
  repoInfo,
  branchName,
  baseBranch,
  files,
  workDir,
  dryRun,
  retries,
  prTemplate,
  executor,
  token,
  labels,
} = options;
```

In the `strategy.execute()` call at line 173, add `labels`:

```typescript
return strategy.execute({
  repoInfo,
  title,
  body,
  branchName,
  baseBranch,
  workDir,
  retries,
  token,
  labels,
});
```

In `src/sync/pr-merge-handler.ts`, in the `createPR` call at line 32, add `labels`:

```typescript
const prResult: PRResult = await createPR({
  repoInfo,
  branchName: options.branchName,
  baseBranch: options.baseBranch,
  files: changedFiles,
  workDir: options.workDir,
  dryRun: options.dryRun,
  retries: options.retries,
  prTemplate: options.prTemplate,
  executor: options.executor,
  token: options.token,
  labels: repoConfig.prOptions?.labels,
});
```

**Step 4: Run test to verify it still fails (labels not yet used in strategy)**

Run: `npm test -- --test-name-pattern "passes labels to createPR" 2>&1 | tail -20`
Expected: FAIL — labels are passed through but `GitHubPRStrategy.create()` doesn't use them yet

**Step 5: Commit (partial — wiring only)**

```bash
git add src/vcs/types.ts src/vcs/pr-creator.ts src/sync/pr-merge-handler.ts test/unit/sync/pr-merge-handler.test.ts
git commit -m "feat(vcs): wire labels through PR creation interfaces"
```

---

### Task 5: Implement labels in GitHubPRStrategy

**Files:**

- Modify: `src/vcs/github-pr-strategy.ts:157-213` (`create` method)
- Modify: `test/unit/vcs/github-pr-strategy.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/vcs/github-pr-strategy.test.ts` inside the `describe("create")` block:

```typescript
test("includes --label flags when labels provided", async () => {
  mockExecutor.responses.set(
    "gh pr create",
    "https://github.com/owner/repo/pull/123"
  );

  const strategy = new GitHubPRStrategy(mockExecutor);
  const options: PRStrategyOptions = {
    repoInfo: githubRepoInfo,
    title: "Test PR",
    body: "Test body",
    branchName: "test-branch",
    baseBranch: "main",
    workDir: testDir,
    retries: 0,
    labels: ["config-sync", "automated"],
  };

  const result = await strategy.create(options);

  assert.equal(result.success, true);
  const createCall = mockExecutor.calls.find((c) =>
    c.command.includes("gh pr create")
  );
  assert.ok(createCall);
  assert.ok(createCall.command.includes("--label 'config-sync'"));
  assert.ok(createCall.command.includes("--label 'automated'"));
});

test("creates PR without --label flags when no labels", async () => {
  mockExecutor.responses.set(
    "gh pr create",
    "https://github.com/owner/repo/pull/124"
  );

  const strategy = new GitHubPRStrategy(mockExecutor);
  const options: PRStrategyOptions = {
    repoInfo: githubRepoInfo,
    title: "Test PR",
    body: "Test body",
    branchName: "test-branch",
    baseBranch: "main",
    workDir: testDir,
    retries: 0,
  };

  const result = await strategy.create(options);

  assert.equal(result.success, true);
  const createCall = mockExecutor.calls.find((c) =>
    c.command.includes("gh pr create")
  );
  assert.ok(createCall);
  assert.ok(!createCall.command.includes("--label"));
});

test("creates PR without --label flags when labels is empty array", async () => {
  mockExecutor.responses.set(
    "gh pr create",
    "https://github.com/owner/repo/pull/125"
  );

  const strategy = new GitHubPRStrategy(mockExecutor);
  const options: PRStrategyOptions = {
    repoInfo: githubRepoInfo,
    title: "Test PR",
    body: "Test body",
    branchName: "test-branch",
    baseBranch: "main",
    workDir: testDir,
    retries: 0,
    labels: [],
  };

  const result = await strategy.create(options);

  assert.equal(result.success, true);
  const createCall = mockExecutor.calls.find((c) =>
    c.command.includes("gh pr create")
  );
  assert.ok(createCall);
  assert.ok(!createCall.command.includes("--label"));
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "includes --label flags|creates PR without --label" 2>&1 | tail -20`
Expected: FAIL — `--label` not in command

**Step 3: Implement labels in `GitHubPRStrategy.create()`**

In `src/vcs/github-pr-strategy.ts`, in the `create` method, add `labels` to the destructuring at line 158:

```typescript
const {
  repoInfo,
  title,
  body,
  branchName,
  baseBranch,
  workDir,
  retries = 3,
  token,
  labels,
} = options;
```

After building the base command at line 179, append label flags:

```typescript
let command = `gh pr create --title ${escapeShellArg(title)} --body-file ${escapeShellArg(bodyFile)} --base ${escapeShellArg(baseBranch)} --head ${escapeShellArg(branchName)}`;

// Append label flags
if (labels && labels.length > 0) {
  for (const label of labels) {
    command += ` --label ${escapeShellArg(label)}`;
  }
}
```

Note: Change the `const command =` on line 179 to `let command =`.

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "includes --label flags|creates PR without --label" 2>&1 | tail -20`
Expected: PASS

**Step 5: Also run the pr-merge-handler test from Task 4**

Run: `npm test -- --test-name-pattern "passes labels to createPR" 2>&1 | tail -20`
Expected: PASS — now the full pipeline works

**Step 6: Commit**

```bash
git add src/vcs/github-pr-strategy.ts test/unit/vcs/github-pr-strategy.test.ts
git commit -m "feat(github): implement --label flags in gh pr create"
```

---

### Task 6: Update documentation

**Files:**

- Modify: `docs/configuration/pr-options.md`

**Step 1: Update the PR Options docs page**

Add `labels` to the fields table at the top:

```markdown
| `labels` | Labels to apply to created PRs (GitHub only, more platforms coming) | - |
```

Add a new section after the "Global vs Per-Repo Options" section:

````markdown
## PR Labels

Apply labels to PRs automatically:

```yaml
prOptions:
  labels: ["config-sync", "automated"]

repos:
  # Uses global labels
  - git: git@github.com:org/frontend.git

  # Override with repo-specific labels (replaces global)
  - git: git@github.com:org/critical.git
    prOptions:
      labels: ["critical-config", "urgent"]

  # Clear labels for this repo
  - git: git@github.com:org/no-labels.git
    prOptions:
      labels: []
```
````

**Note:** Labels must already exist on the target repository. If a label doesn't exist, the PR creation will fail. Currently supported on GitHub only.

````

**Step 2: Commit**

```bash
git add docs/configuration/pr-options.md
git commit -m "docs: add labels to PR options documentation"
````

---

### Task 7: Run full test suite and lint

**Step 1: Run all unit tests**

Run: `npm test 2>&1 | tail -30`
Expected: All tests pass

**Step 2: Run linter**

Run: `./lint.sh 2>&1 | tail -30`
Expected: No lint errors

**Step 3: Fix any issues found**

If tests fail or lint errors appear, fix them and re-run.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address lint and test issues"
```
