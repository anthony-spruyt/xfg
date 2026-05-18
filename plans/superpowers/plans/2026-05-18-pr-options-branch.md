# `prOptions.branch` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `prOptions.branch` in config YAML to set the PR branch name, with per-repo/group/global layering and CLI override.

**Architecture:** Add `branch?: string` to `PRMergeOptions`. Move `validateBranchName` to `src/shared/branch-validation.ts` so both `src/config/` and `src/cli/` can import it. Validation added to config validator. Branch resolution in `repo-sync-runner.ts` picks per-repo config branch before falling back to the auto-generated name.

**Tech Stack:** TypeScript, Node.js test runner (`node:test`), `node:assert/strict`

______________________________________________________________________

## Task 1: Move `validateBranchName` to shared

**Files:**

- Create: `src/shared/branch-validation.ts`

- Modify: `src/cli/branch-utils.ts:16-37`

- Modify: `src/cli/sync-command.ts:9`

- Modify: `test/unit/cli/branch-utils.test.ts:5-6`

- Create: `test/unit/shared/branch-validation.test.ts`

- [ ] **Step 1: Create `src/shared/branch-validation.ts`**

```typescript
import { ValidationError } from "./errors.js";

export function validateBranchName(branchName: string): void {
  if (!branchName || branchName.trim() === "") {
    throw new ValidationError("Branch name cannot be empty");
  }

  if (branchName.startsWith(".") || branchName.startsWith("-")) {
    throw new ValidationError('Branch name cannot start with "." or "-"');
  }

  // Git disallows: space, ~, ^, :, ?, *, [, \, and consecutive dots (..)
  if (/[\s~^:?*[\\]/.test(branchName) || branchName.includes("..")) {
    throw new ValidationError("Branch name contains invalid characters");
  }

  if (
    branchName.endsWith("/") ||
    branchName.endsWith(".lock") ||
    branchName.endsWith(".")
  ) {
    throw new ValidationError("Branch name has invalid ending");
  }
}
```

- [ ] **Step 2: Update `src/cli/branch-utils.ts` to re-export from shared**

Replace `validateBranchName` in `src/cli/branch-utils.ts` with a re-export. The file should become:

```typescript
import { ValidationError } from "../shared/errors.js";

export { validateBranchName } from "../shared/branch-validation.js";

export function sanitizeBranchName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
```

Note: The `ValidationError` import can also be removed since `sanitizeBranchName` doesn't use it. Check if anything else in this file uses it — if not, remove it.

Actually, `sanitizeBranchName` doesn't throw `ValidationError`. Remove the unused import:

```typescript
export { validateBranchName } from "../shared/branch-validation.js";

export function sanitizeBranchName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
```

- [ ] **Step 3: Create `test/unit/shared/branch-validation.test.ts`**

Test that the shared module exports work correctly:

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { validateBranchName } from "../../../src/shared/branch-validation.js";
import { ValidationError } from "../../../src/shared/errors.js";

describe("shared/branch-validation", () => {
  test("accepts valid branch name", () => {
    assert.doesNotThrow(() => validateBranchName("feature/my-branch"));
  });

  test("accepts branch with slashes and dashes", () => {
    assert.doesNotThrow(() => validateBranchName("chore/sync-config"));
  });

  test("rejects empty string", () => {
    assert.throws(
      () => validateBranchName(""),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects whitespace-only", () => {
    assert.throws(
      () => validateBranchName("   "),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch starting with dot", () => {
    assert.throws(
      () => validateBranchName(".hidden"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch starting with dash", () => {
    assert.throws(
      () => validateBranchName("-invalid"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch with spaces", () => {
    assert.throws(
      () => validateBranchName("my branch"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch ending with .lock", () => {
    assert.throws(
      () => validateBranchName("branch.lock"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch ending with dot", () => {
    assert.throws(
      () => validateBranchName("branch."),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch with consecutive dots", () => {
    assert.throws(
      () => validateBranchName("feature..name"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch ending with slash", () => {
    assert.throws(
      () => validateBranchName("feature/"),
      (err: unknown) => err instanceof ValidationError
    );
  });
});
```

- [ ] **Step 4: Run tests to verify move didn't break anything**

Run: `npm test` Expected: All existing tests pass. The `branch-utils.test.ts` tests still pass because `branch-utils.ts` re-exports `validateBranchName`. The new `branch-validation.test.ts` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/branch-validation.ts src/cli/branch-utils.ts test/unit/shared/branch-validation.test.ts
git commit -m "refactor: move validateBranchName to src/shared/branch-validation.ts"
```

______________________________________________________________________

## Task 2: Add `branch` to `PRMergeOptions`

**Files:**

- Modify: `src/config/types.ts:6-12`

- [ ] **Step 1: Write failing type test**

There's no separate type test needed — the config validator test (Task 3) will fail to compile if the type doesn't have `branch`. Proceed to implementation.

- [ ] **Step 2: Add `branch` field to `PRMergeOptions`**

In `src/config/types.ts`, change `PRMergeOptions`:

```typescript
export interface PRMergeOptions {
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
  bypassReason?: string;
  labels?: string[];
  branch?: string;
}
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit` Expected: PASS — `branch` is optional, no breaking changes.

- [ ] **Step 4: Commit**

```bash
git add src/config/types.ts
git commit -m "feat: add branch field to PRMergeOptions interface"
```

______________________________________________________________________

## Task 3: Config validation for `prOptions.branch`

**Files:**

- Modify: `src/config/validator.ts:1-9,125-138`

- Test: `test/unit/config/validator.test.ts`

- [ ] **Step 1: Write failing tests for branch validation**

Add to `test/unit/config/validator.test.ts`, inside the existing `describe("prOptions labels validation", ...)` block (or create a sibling `describe`):

```typescript
describe("prOptions.branch validation", () => {
  test("accepts valid branch name in global prOptions", () => {
    const config = createValidConfig({
      prOptions: { branch: "chore/custom-sync" },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("rejects invalid branch name in global prOptions", () => {
    const config = createValidConfig({
      prOptions: { branch: ".invalid-branch" },
    });
    assert.throws(
      () => validateRawConfig(config),
      /Branch name cannot start with/
    );
  });

  test("rejects empty branch name in global prOptions", () => {
    const config = createValidConfig({
      prOptions: { branch: "" },
    });
    assert.throws(
      () => validateRawConfig(config),
      /Branch name cannot be empty/
    );
  });

  test("rejects invalid branch name in per-repo prOptions", () => {
    const config = createValidConfig({
      repos: [
        {
          git: "git@github.com:org/repo.git",
          prOptions: { branch: "branch with spaces" },
        },
      ],
    });
    assert.throws(
      () => validateRawConfig(config),
      /Branch name contains invalid characters/
    );
  });

  test("rejects invalid branch name in group prOptions", () => {
    const config = createValidConfig({
      files: { "f.json": { content: {} } },
      groups: {
        mygroup: {
          prOptions: { branch: "branch.lock" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    });
    assert.throws(
      () => validateRawConfig(config),
      /Branch name has invalid ending/
    );
  });

  test("rejects invalid branch name in conditional group prOptions", () => {
    const config = createValidConfig({
      files: { "f.json": { content: {} } },
      groups: {
        "group-a": { files: { "f.json": { content: {} } } },
      },
      conditionalGroups: [
        {
          when: { allOf: ["group-a"] },
          prOptions: { branch: "..bad" },
        },
      ],
      repos: [{ git: "git@github.com:org/repo.git", groups: ["group-a"] }],
    });
    assert.throws(
      () => validateRawConfig(config),
      /Branch name cannot start with/
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- --test-name-pattern "prOptions.branch"` Expected: FAIL — `validateRawConfig` does not yet validate `prOptions.branch`.

Note: The "accepts valid branch name" test will pass (no validation = no rejection). The rejection tests will fail because no validation logic exists yet.

- [ ] **Step 3: Add branch validation to `validatePrOptions`**

In `src/config/validator.ts`, add import at the top:

```typescript
import { validateBranchName } from "../shared/branch-validation.js";
```

Then modify the `validatePrOptions` function (lines 125-138) to also validate `branch`:

```typescript
function validatePrOptions(config: RawConfig): void {
  if (config.prOptions?.branch !== undefined) {
    validateBranchName(config.prOptions.branch);
  }

  if (config.prOptions?.labels === undefined) return;

  if (!Array.isArray(config.prOptions.labels)) {
    throw new ValidationError("prOptions.labels must be an array of strings");
  }
  for (const label of config.prOptions.labels) {
    if (typeof label !== "string" || label.length === 0) {
      throw new ValidationError(
        "prOptions.labels entries must be non-empty strings"
      );
    }
  }
}
```

Add per-repo validation inside `validateRepoEntry` in `src/config/validators/repo-entry-validator.ts`. Add import at the top:

```typescript
import { validateBranchName } from "../../shared/branch-validation.js";
```

Add a new function and call it from `validateRepoEntry`:

```typescript
function validateRepoPrOptions(repo: RawConfig["repos"][number]): void {
  if (repo.prOptions?.branch !== undefined) {
    validateBranchName(repo.prOptions.branch);
  }
}
```

Call it in `validateRepoEntry` after `validateRepoSettingsEntry`:

```typescript
export function validateRepoEntry(
  config: RawConfig,
  repo: RawConfig["repos"][number],
  index: number
): void {
  const repoLabel = validateRepoGitField(repo, index);
  validateRepoOrigins(config, repo, repoLabel);
  validateRepoGroups(config, repo, index);
  validateRepoFiles(config, repo, index, repoLabel);
  validateRepoSettingsEntry(config, repo, repoLabel);
  validateRepoPrOptions(repo);
}
```

Add group validation inside `validateGroups` in `src/config/validators/group-validator.ts`. Add import at the top:

```typescript
import { validateBranchName } from "../../shared/branch-validation.js";
```

Add branch validation at the end of the group loop, after the settings validation block (around line 168):

```typescript
    if (group.prOptions?.branch !== undefined) {
      validateBranchName(group.prOptions.branch);
    }
```

Add conditional group validation inside `validateConditionalGroups`, after the settings validation block (around line 251):

```typescript
    if (entry.prOptions?.branch !== undefined) {
      validateBranchName(entry.prOptions.branch);
    }
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npm test -- --test-name-pattern "prOptions.branch"` Expected: PASS — all branch validation tests pass.

- [ ] **Step 5: Run full test suite**

Run: `npm test` Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/config/validator.ts src/config/validators/repo-entry-validator.ts src/config/validators/group-validator.ts test/unit/config/validator.test.ts
git commit -m "feat: validate prOptions.branch in config at all layers"
```

______________________________________________________________________

## Task 4: `mergePROptions` handles `branch` (normalizer)

**Files:**

- Test: `test/unit/config/normalizer.test.ts`

No production code changes needed — `mergePROptions` already uses spread semantics (`{ ...global, ...perRepo }`), so `branch` merges automatically. This task adds tests to prove it.

- [ ] **Step 1: Write tests for branch merging**

Add to `test/unit/config/normalizer.test.ts`, near the existing prOptions merge tests (around line 3165):

```typescript
  test("global prOptions.branch propagates to repo", () => {
    const raw: RawConfig = {
      id: "test",
      files: { "f.json": { content: {} } },
      prOptions: { branch: "chore/global-sync" },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.branch, "chore/global-sync");
  });

  test("per-repo prOptions.branch overrides global", () => {
    const raw: RawConfig = {
      id: "test",
      files: { "f.json": { content: {} } },
      prOptions: { branch: "chore/global-sync" },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          prOptions: { branch: "chore/repo-specific" },
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.branch, "chore/repo-specific");
  });

  test("group prOptions.branch merges into chain", () => {
    const raw: RawConfig = {
      id: "test",
      files: { "f.json": { content: {} } },
      groups: {
        mygroup: {
          prOptions: { branch: "chore/group-sync" },
        },
      },
      repos: [
        { git: "git@github.com:org/repo.git", groups: ["mygroup"] },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.branch, "chore/group-sync");
  });

  test("per-repo prOptions.branch overrides group prOptions.branch", () => {
    const raw: RawConfig = {
      id: "test",
      files: { "f.json": { content: {} } },
      groups: {
        mygroup: {
          prOptions: { branch: "chore/group-sync" },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
          prOptions: { branch: "chore/repo-override" },
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.branch, "chore/repo-override");
  });

  test("global prOptions.branch merges with per-repo other prOptions fields", () => {
    const raw: RawConfig = {
      id: "test",
      files: { "f.json": { content: {} } },
      prOptions: { branch: "chore/global-sync", merge: "auto" },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          prOptions: { labels: ["config"] },
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.branch, "chore/global-sync");
    assert.equal(result.repos[0].prOptions?.merge, "auto");
    assert.deepStrictEqual(result.repos[0].prOptions?.labels, ["config"]);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "prOptions.branch"` Expected: PASS — all tests pass without production code changes (spread merge handles `branch` automatically).

- [ ] **Step 3: Commit**

```bash
git add test/unit/config/normalizer.test.ts
git commit -m "test: verify mergePROptions handles branch field correctly"
```

______________________________________________________________________

## Task 5: Wire `effectivePrOptions` and branch resolution in `repo-sync-runner.ts`

**Files:**

- Modify: `src/cli/repo-sync-runner.ts:118-127,172-182`

- Test: `test/unit/cli/sync-command.test.ts`

- [ ] **Step 1: Write failing test for per-repo branch resolution**

Add to `test/unit/cli/sync-command.test.ts`, inside the existing `describe("sync-command", ...)`:

```typescript
  test("prOptions.branch in config sets branch name per-repo", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
${MINIMAL_FILES}
prOptions:
  branch: chore/custom-branch
repos:
  - git: https://github.com/test/repo
`
    );

    const mockProcessor = createMockProcessor();

    await runSync(
      { config: testConfigPath, dryRun: true, workDir: testDir },
      {
        processorFactory: () => mockProcessor,
        lifecycleManager: noopLifecycleManager,
      }
    );

    const processMock = mockProcessor.process as MockFn;
    const callArgs = processMock.mock.calls[0].arguments;
    const options = callArgs[2] as { branchName: string };
    assert.equal(options.branchName, "chore/custom-branch");
  });

  test("per-repo prOptions.branch overrides global", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
${MINIMAL_FILES}
prOptions:
  branch: chore/global-branch
repos:
  - git: https://github.com/test/repo
    prOptions:
      branch: chore/repo-specific
`
    );

    const mockProcessor = createMockProcessor();

    await runSync(
      { config: testConfigPath, dryRun: true, workDir: testDir },
      {
        processorFactory: () => mockProcessor,
        lifecycleManager: noopLifecycleManager,
      }
    );

    const processMock = mockProcessor.process as MockFn;
    const callArgs = processMock.mock.calls[0].arguments;
    const options = callArgs[2] as { branchName: string };
    assert.equal(options.branchName, "chore/repo-specific");
  });

  test("CLI --branch overrides prOptions.branch in config", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
${MINIMAL_FILES}
prOptions:
  branch: chore/config-branch
repos:
  - git: https://github.com/test/repo
`
    );

    const mockProcessor = createMockProcessor();

    await runSync(
      {
        config: testConfigPath,
        dryRun: true,
        workDir: testDir,
        branch: "chore/cli-override",
      },
      {
        processorFactory: () => mockProcessor,
        lifecycleManager: noopLifecycleManager,
      }
    );

    const processMock = mockProcessor.process as MockFn;
    const callArgs = processMock.mock.calls[0].arguments;
    const options = callArgs[2] as { branchName: string };
    assert.equal(options.branchName, "chore/cli-override");
  });

  test("auto-generated branch used when no prOptions.branch set", async () => {
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
      {
        processorFactory: () => mockProcessor,
        lifecycleManager: noopLifecycleManager,
      }
    );

    const processMock = mockProcessor.process as MockFn;
    const callArgs = processMock.mock.calls[0].arguments;
    const options = callArgs[2] as { branchName: string };
    assert.equal(options.branchName, "chore/sync-placeholder");
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- --test-name-pattern "prOptions.branch in config"` Expected: FAIL — the processor currently receives `ctx.branchName` (auto-generated), not the per-repo config branch.

- [ ] **Step 3: Add `branch` to `effectivePrOptions` merge**

In `src/cli/repo-sync-runner.ts`, modify the `effectivePrOptions` block (lines 172-182):

```typescript
  const effectivePrOptions =
    options.merge || options.mergeStrategy || options.deleteBranch || options.branch
      ? {
          ...repoConfig.prOptions,
          merge: options.merge ?? repoConfig.prOptions?.merge,
          mergeStrategy:
            options.mergeStrategy ?? repoConfig.prOptions?.mergeStrategy,
          deleteBranch:
            options.deleteBranch ?? repoConfig.prOptions?.deleteBranch,
          branch: options.branch ?? repoConfig.prOptions?.branch,
        }
      : repoConfig.prOptions;
```

- [ ] **Step 4: Add per-repo branch resolution in `runFileSyncPhase`**

In `src/cli/repo-sync-runner.ts`, in `runFileSyncPhase` (around line 126), replace:

```typescript
    const result = await ctx.processor.process(repo.repoConfig, repo.repoInfo, {
      branchName: ctx.branchName,
```

with:

```typescript
    const branchName = repo.repoConfig.prOptions?.branch ?? ctx.branchName;
    const result = await ctx.processor.process(repo.repoConfig, repo.repoInfo, {
      branchName,
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `npm test -- --test-name-pattern "prOptions.branch"` Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run: `npm test` Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli/repo-sync-runner.ts test/unit/cli/sync-command.test.ts
git commit -m "feat: resolve prOptions.branch per-repo with CLI override"
```

______________________________________________________________________

## Task 6: Lint and type check

**Files:** None (verification only)

- [ ] **Step 1: Run type check**

Run: `npm run test:typecheck` Expected: PASS.

- [ ] **Step 2: Run linter**

Run: `./lint.sh` Expected: PASS.

- [ ] **Step 3: Run full test suite one more time**

Run: `npm test` Expected: All tests pass.

- [ ] **Step 4: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "chore: lint fixes"
```

______________________________________________________________________

## Task 7: Integration tests

**Files:**

- Modify: `test/integration/github.test.ts`

- [ ] **Step 1: Write integration test for `prOptions.branch` creating PR on correct branch**

Add to `test/integration/github.test.ts`, near the existing prOptions.labels tests:

```typescript
  test("prOptions.branch creates PR on configured branch", async () => {
    const customBranch = "chore/custom-pr-branch";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-pr-branch-github
files:
  pr-branch-test.json:
    content:
      prBranchTest: true
prOptions:
  branch: ${customBranch}
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const pr = await waitForPrVisible(testRepo, customBranch, "number,headRefName");
    assert.equal(pr.headRefName, customBranch);
  });

  test("per-repo prOptions.branch creates PR on repo-specific branch", async () => {
    const repoBranch = "chore/repo-pr-branch";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-pr-branch-override-github
files:
  pr-branch-override-test.json:
    content:
      prBranchOverrideTest: true
prOptions:
  branch: chore/global-should-not-use
repos:
  - git: https://github.com/${testRepo}.git
    prOptions:
      branch: ${repoBranch}
`
    );

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const pr = await waitForPrVisible(testRepo, repoBranch, "number,headRefName");
    assert.equal(pr.headRefName, repoBranch);
  });
```

- [ ] **Step 2: Build before running integration tests**

Run: `npm run build` Expected: PASS.

- [ ] **Step 3: Run GitHub integration tests**

Run: `npm run test:integration:github` Expected: PASS — both new tests create PRs on the configured branch names.

- [ ] **Step 4: Commit**

```bash
git add test/integration/github.test.ts
git commit -m "test: add integration tests for prOptions.branch"
```

______________________________________________________________________

## Task 8: Update documentation

**Files:**

- Modify: `docs/configuration.md` (or equivalent config reference page)

- [ ] **Step 1: Find the config documentation file**

Run: `grep -rn "prOptions" docs/ | head -20`

Look for where `prOptions` is documented.

- [ ] **Step 2: Add `branch` to the prOptions documentation**

Add `branch` to the prOptions table/section wherever labels, merge, mergeStrategy, deleteBranch, and bypassReason are documented. Document:

- Field name: `branch`

- Type: `string`

- Description: Branch name for sync PRs. Supports global, group, and per-repo levels. Per-repo overrides group, group overrides global. CLI `--branch` flag overrides all config values.

- Example showing global and per-repo usage

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: document prOptions.branch configuration"
```

______________________________________________________________________

## Task 9: Final verification and push

- [ ] **Step 1: Run full verification suite**

```bash
npm test && npm run test:typecheck && ./lint.sh
```

Expected: All pass.

- [ ] **Step 2: Push branch**

```bash
git push -u origin HEAD
```
