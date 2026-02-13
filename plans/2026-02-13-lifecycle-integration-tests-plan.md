# Lifecycle Integration Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two CI failures from PR #470 and add lifecycle integration tests for create/fork/migrate operations per issue #472.

**Architecture:** Bug fixes first (dry-run skip + description payload), then integration tests following existing patterns (CLI PAT, CLI App, Action PAT, Action App), using ephemeral repos with unique names and afterEach cleanup.

**Tech Stack:** TypeScript, Node.js test runner, gh CLI, GitHub Actions CI

---

### Task 1: Fix description missing from settings payload

**Files:**

- Modify: `src/settings/repo-settings/github-repo-settings-strategy.ts:34`
- Test: `test/unit/settings/repo-settings/github-repo-settings-strategy.test.ts`

**Step 1: Write the failing test**

Add to the `updateSettings` describe block in `test/unit/settings/repo-settings/github-repo-settings-strategy.test.ts`, after the `default_branch` test:

```typescript
test("should include description in payload", async () => {
  mockExecutor.setResponse("/repos/test-org/test-repo", "{}");

  const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
  await strategy.updateSettings(githubRepo, {
    description: "My repo description",
  });

  assert.equal(mockExecutor.commands.length, 1);
  assert.ok(mockExecutor.commands[0].includes("-X PATCH"));
  assert.ok(mockExecutor.commands[0].includes("description"));
  assert.ok(mockExecutor.commands[0].includes("My repo description"));
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "should include description in payload"`
Expected: FAIL — description not included in payload

**Step 3: Add "description" to directMappings**

In `src/settings/repo-settings/github-repo-settings-strategy.ts:34`, add `"description"` to the `directMappings` array:

```typescript
  const directMappings: (keyof GitHubRepoSettings)[] = [
    "description",
    "hasIssues",
    // ... rest unchanged
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "should include description in payload"`
Expected: PASS

**Step 5: Commit**

```
fix(settings): add description to repo settings payload

The configToGitHubPayload function was missing "description" in its
directMappings array, so description changes were detected but never
applied via the GitHub API.
```

---

### Task 2: Fix sync dry-run crash on non-existent repos

**Files:**

- Modify: `src/cli/sync-command.ts:227`
- Test: `test/unit/sync-command.test.ts`

**Step 1: Write the failing test**

Add a new lifecycle manager that simulates a "created" result:

```typescript
const creatingLifecycleManager: IRepoLifecycleManager = {
  async ensureRepo(_repoConfig, repoInfo) {
    return { repoInfo, action: "created" };
  },
};
```

Add test inside the `lifecycle integration` describe block:

```typescript
test("skips repo processing in dry-run when lifecycle would create repo", async () => {
  writeFileSync(
    testConfigPath,
    `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
`
  );

  const mockProcessor = createMockProcessor();

  await runSync(
    { config: testConfigPath, dryRun: true, workDir: testDir },
    () => mockProcessor,
    creatingLifecycleManager
  );

  // Processor should NOT be called — repo doesn't exist in dry-run
  assert.equal(
    (mockProcessor.process as MockFn).mock.calls.length,
    0,
    "processor.process should not be called for non-existent repo in dry-run"
  );

  const output = consoleOutput.join("\n");
  assert.ok(output.includes("CREATE"));
});
```

Note: You'll need to import `type Mock` and add a `type MockFn` alias like settings-command.test.ts has:

```typescript
import {
  test,
  describe,
  beforeEach,
  afterEach,
  mock,
  type Mock,
} from "node:test";
type MockFn = Mock<(...args: unknown[]) => unknown>;
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "skips repo processing in dry-run when lifecycle would create repo"`
Expected: FAIL — processor.process is called (mock.calls.length === 1)

**Step 3: Implement the dry-run skip in sync-command.ts**

In `src/cli/sync-command.ts`, change the lifecycle check block (lines 226-257) to also destructure `lifecycleResult` and skip processing:

```typescript
    // Check if repo exists, create/fork/migrate if needed
    try {
      const { outputLines, lifecycleResult } = await runLifecycleCheck(
        repoConfig,
        repoInfo,
        i,
        {
          dryRun: options.dryRun ?? false,
          resolvedWorkDir: workDir,
          githubHosts: config.githubHosts,
          token: lifecycleToken,
        },
        lm,
        config.settings?.repo
      );

      for (const line of outputLines) {
        logger.info(line);
      }

      // In dry-run, skip processing repos that don't exist yet
      if (options.dryRun && lifecycleResult.action !== "existed") {
        reportResults.push({
          repoName,
          success: true,
          fileChanges: [],
        });
        continue;
      }
    } catch (error) {
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "skips repo processing in dry-run when lifecycle would create repo"`
Expected: PASS

**Step 5: Run all sync-command tests**

Run: `npm test -- --test-name-pattern "sync-command"`
Expected: All pass

**Step 6: Commit**

```
fix(sync): skip repo processing in dry-run when lifecycle would create

When running sync --dry-run with a non-existent repo, the lifecycle
check correctly outputs "+ CREATE" but then sync tried to clone the
repo which doesn't exist. Now skips processing for repos that would
be created/forked/migrated in dry-run mode.
```

---

### Task 3: Fix settings dry-run skip for non-existent repos

**Files:**

- Modify: `src/cli/settings-command.ts:88-163` (runLifecycleChecks function)
- Test: `test/unit/settings-command.test.ts`

**Step 1: Write the failing test**

Add lifecycle manager that simulates creation in the test file (same as sync):

```typescript
const creatingLifecycleManager: IRepoLifecycleManager = {
  async ensureRepo(_repoConfig, repoInfo) {
    return { repoInfo, action: "created" };
  },
};
```

Add test inside the `lifecycle error handling` describe block:

```typescript
test("skips rulesets and repo settings in dry-run when lifecycle would create repo", async () => {
  writeFileSync(
    testConfigPath,
    `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:${VALID_RULESET}
      repo:
        has_issues: true
`
  );

  const mockRulesetProcessor = createMockRulesetProcessor();
  const mockRepoSettingsProcessor = createMockRepoSettingsProcessor();

  await runSettings(
    { config: testConfigPath, dryRun: true },
    () => mockRulesetProcessor,
    () => createMockRepoProcessor(),
    () => mockRepoSettingsProcessor,
    creatingLifecycleManager
  );

  // Neither processor should be called — repo doesn't exist in dry-run
  assert.equal(
    (mockRulesetProcessor.process as MockFn).mock.calls.length,
    0,
    "rulesets processor should not be called for non-existent repo in dry-run"
  );
  assert.equal(
    (mockRepoSettingsProcessor.process as MockFn).mock.calls.length,
    0,
    "repo settings processor should not be called for non-existent repo in dry-run"
  );

  const output = consoleOutput.join("\n");
  assert.ok(output.includes("CREATE"));
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "skips rulesets and repo settings in dry-run"`
Expected: FAIL — processors are called

**Step 3: Implement the dry-run skip in settings-command.ts**

In `src/cli/settings-command.ts`, modify `runLifecycleChecks()`. Change the lifecycle check inside the try block (around line 132-149):

```typescript
    try {
      const { outputLines, lifecycleResult } = await runLifecycleCheck(
        repoConfig,
        repoInfo,
        i,
        {
          dryRun: options.dryRun ?? false,
          workDir: options.workDir,
          githubHosts: config.githubHosts,
          token: lifecycleToken,
        },
        lifecycleManager,
        config.settings?.repo
      );

      for (const line of outputLines) {
        logger.info(line);
      }

      // In dry-run, skip processing repos that don't exist yet
      if (options.dryRun && lifecycleResult.action !== "existed") {
        failed.add(repoConfig.git);
      }
    } catch (error) {
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "skips rulesets and repo settings in dry-run"`
Expected: PASS

**Step 5: Run all settings-command tests**

Run: `npm test -- --test-name-pattern "settings-command"`
Expected: All pass

**Step 6: Run full test suite + lint**

Run: `npm test && ./lint.sh`
Expected: All 1864+ tests pass, lint clean

**Step 7: Commit**

```
fix(settings): skip processing in dry-run when lifecycle would create

Same fix as sync-command: when running settings --dry-run with a
non-existent repo, skip rulesets and repo settings processing since
the repo doesn't actually exist yet.
```

---

### Task 4: Add npm scripts for lifecycle integration tests

**Files:**

- Modify: `package.json`

**Step 1: Add the npm scripts**

Add to `package.json` scripts section (next to existing integration test scripts):

```json
"test:integration:github-lifecycle": "node --test dist/test/integration/github-lifecycle.test.js",
"test:integration:github-lifecycle-app": "node --test dist/test/integration/github-lifecycle-app.test.js"
```

**Step 2: Commit**

```
chore: add npm scripts for lifecycle integration tests
```

---

### Task 5: Create CLI PAT lifecycle integration test

**Files:**

- Create: `test/integration/github-lifecycle.test.ts`

**Step 1: Write the test file**

Create `test/integration/github-lifecycle.test.ts` following the patterns from `github.test.ts`:

- Import `test, describe, afterEach` from `node:test`
- Import the test helper `exec` and `projectRoot` from `./test-helpers.js`
- Import `randomBytes` from `node:crypto`, `writeFileSync, mkdirSync, rmSync` from `node:fs`, `join` from `node:path`, `tmpdir` from `node:os`
- Helper: `generateRepoName()` returns `xfg-lifecycle-test-${Date.now()}-${randomBytes(3).toString("hex")}`
- Helper: `deleteRepo(repoName)` wraps `gh repo delete --yes anthony-spruyt/${repoName}` in try/catch
- Helper: `repoExists(repoName)` calls `gh api repos/anthony-spruyt/${repoName}` and returns true/false
- Helper: `isForkedFrom(repoName, upstreamFullName)` checks `.parent.full_name` via `gh api`
- Helper: `writeConfig(tmpDir, configYaml)` writes YAML to temp file and returns path
- Constant: `OWNER = "anthony-spruyt"`
- Constant: `FORK_SOURCE = "anthony-spruyt/xfg-fork-source"` (the dedicated small public repo)

**Test cases in `describe("Lifecycle Integration Test (PAT)")`:**

Track repos to clean up in `const reposToDelete: string[] = []`, clean in `afterEach`.

1. **create: sync creates repo when it doesn't exist**
   - Generate unique name, add to reposToDelete
   - Write config with just `git:` (no upstream/source), files section with `lifecycle-test.json`
   - Run `node dist/cli.js sync --config <path> --merge direct`
   - Assert repo exists via API
   - Assert `lifecycle-test.json` exists on default branch via `gh api repos/.../contents/lifecycle-test.json`

2. **fork: sync forks upstream when repo doesn't exist**
   - Generate unique name, add to reposToDelete
   - Write config with `git:` + `upstream: https://github.com/anthony-spruyt/xfg-fork-source.git`
   - Run `node dist/cli.js sync --config <path> --merge direct`
   - Assert repo exists
   - Assert it's a fork of `xfg-fork-source` via API `.parent.full_name`

3. **create dry-run: shows CREATE but doesn't actually create repo**
   - Generate unique name (do NOT add to reposToDelete — repo should not exist)
   - Write config with just `git:`
   - Run `node dist/cli.js sync --config <path> --dry-run`
   - Assert output includes `CREATE`
   - Assert repo does NOT exist via API

Note: The `test-helpers.ts:exec()` function wraps `execSync` which uses shell. This is safe because inputs are controlled test constants, not user input. All existing integration tests use this pattern.

**Step 2: Verify it compiles**

Run: `npm run build`

**Step 3: Commit**

```
test: add CLI PAT lifecycle integration tests
```

---

### Task 6: Create CLI App lifecycle integration test

**Files:**

- Create: `test/integration/github-lifecycle-app.test.ts`

**Step 1: Write the test file**

Nearly identical to Task 5 but with App auth pattern from `github-app.test.ts`:

- Strip `GH_TOKEN` from env when running xfg commands: `{ cwd: projectRoot, env: { GH_TOKEN: undefined } }`
- Skip tests if `XFG_GITHUB_APP_ID` or `XFG_GITHUB_APP_PRIVATE_KEY` not set
- Use `GH_TOKEN` from process.env for setup/cleanup (`gh repo delete`, `gh api` verification)

**Test cases in `describe("Lifecycle Integration Test (GitHub App)")`:**

Same 3 test cases as Task 5, but xfg invocations use the App env (no GH_TOKEN).

**Step 2: Verify it compiles**

Run: `npm run build`

**Step 3: Commit**

```
test: add CLI GitHub App lifecycle integration tests
```

---

### Task 7: Add lifecycle CI jobs to workflow

**Files:**

- Modify: `.github/workflows/ci.yaml`

**Step 1: Add 4 new jobs**

Add after the existing integration test jobs, following the exact same pattern as `cli-sync-github-pat` and `cli-sync-github-app`.

**CLI PAT lifecycle job:**

```yaml
cli-lifecycle-github-pat:
  name: integration-test-cli-lifecycle-github-pat
  needs: build
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  concurrency:
    group: integration-github-8
    cancel-in-progress: false
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: "22"
    - uses: actions/download-artifact@v4
      with:
        name: dist
        path: dist
    - uses: actions/download-artifact@v4
      with:
        name: node_modules
        path: node_modules
    - name: Run lifecycle integration tests (PAT)
      env:
        GH_TOKEN: ${{ secrets.GH_PAT }}
      run: npm run test:integration:github-lifecycle
```

**CLI App lifecycle job:** Same but concurrency `integration-github-9`, with App env vars, run `test:integration:github-lifecycle-app`.

**Action PAT lifecycle job:** Concurrency `integration-github-10`. Uses arrange/act/assert pattern in inline steps:

1. Generate unique repo name
2. Write temp config
3. Run xfg action with config
4. Verify via `gh api`
5. Cleanup with `if: always()`

**Action App lifecycle job:** Concurrency `integration-github-11`. Same as PAT but with App credentials.

Add all 4 jobs to the `summary` job's `needs` array.

**Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yaml'))"`

**Step 3: Commit**

```
ci: add lifecycle integration test jobs for create/fork/migrate
```

---

### Task 8: Update integration test rules

**Files:**

- Modify: `.claude/rules/integration-tests.md`

**Step 1: Add ephemeral repo guidance**

Find the section about repo creation prohibition and update it. Replace the blanket prohibition with nuanced guidance:

**Add new section:**

```markdown
### Ephemeral repos (lifecycle tests only)

Tests that verify repo creation/forking/migration may create and delete repos:

- Use **unique names per run** (`xfg-lifecycle-test-<timestamp>-<random>`) — never reuse a deleted name
- Register cleanup (`gh repo delete --yes`) in `afterEach` / `after`, wrapped in try/catch
- Never delete then recreate the same repo name — this causes ghost-repo race conditions
- This is the same pattern used by the [`gh` CLI acceptance tests](https://github.com/cli/cli/tree/trunk/acceptance)
```

**Step 2: Commit**

```
docs: update integration test rules with ephemeral repo guidance
```

---

### Task 9: Final verification and PR

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Run lint**

Run: `./lint.sh`
Expected: Clean

**Step 3: Build**

Run: `npm run build`
Expected: Success

**Step 4: Create PR**

```
gh pr create --title "feat: lifecycle integration tests and bug fixes" --body "..."
```

Reference issue #472, list bug fixes and new tests.
