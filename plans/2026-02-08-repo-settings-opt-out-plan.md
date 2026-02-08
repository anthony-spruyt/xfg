# Repo Settings Opt-Out Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow repos to opt out of all root-level repo settings with `repo: false`.

**Architecture:** Add `| false` to the `RawRepoSettings.repo` type, handle the false case in the normalizer's `mergeSettings()`, and validate it in `validateSettings()`. The processor needs no changes since it already skips repos with no settings.

**Tech Stack:** TypeScript, Node.js test runner (node:test + node:assert)

---

### Task 1: Type Change

**Files:**

- Modify: `src/config.ts:457-461`

**Step 1: Update the `RawRepoSettings` interface**

Change line 459 from:

```typescript
  repo?: GitHubRepoSettings;
```

to:

```typescript
  repo?: GitHubRepoSettings | false;
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: Compilation errors in `config-validator.ts` and `config-normalizer.ts` where `repo` is used without checking for `false`. That's fine — we'll fix those in the next tasks.

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): allow repo: false in RawRepoSettings type"
```

---

### Task 2: Validator — Reject `repo: false` at Root Level

**Files:**

- Modify: `src/config-validator.ts:843-894` (the `validateSettings` function)
- Test: `test/unit/config-validator.test.ts`

**Step 1: Write the failing test**

Add to the `validateRawConfig` describe block, near the existing rulesets validation tests (around line 1494):

```typescript
test("throws when root settings has repo: false", () => {
  const config = createValidConfig({
    settings: {
      repo: false as never,
    },
    files: undefined,
  });

  assert.throws(
    () => validateRawConfig(config),
    /repo: false is not valid at root level/
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsc --noEmit && node --test test/unit/config-validator.test.ts --test-name-pattern "throws when root settings has repo: false"`
Expected: FAIL — no validation exists yet.

**Step 3: Implement the validation**

In `src/config-validator.ts`, inside the `validateSettings` function (line ~891), change:

```typescript
// Validate repo settings
if (s.repo !== undefined) {
  validateRepoSettings(s.repo, context);
}
```

to:

```typescript
// Validate repo settings
if (s.repo !== undefined) {
  if (s.repo === false) {
    if (!rootRulesetNames) {
      // Root level — repo: false not valid here
      throw new Error(
        `${context}: repo: false is not valid at root level. Define repo settings or remove the field.`
      );
    }
    // Per-repo level — handled below after rootRulesetNames check
  } else {
    validateRepoSettings(s.repo, context);
  }
}
```

Note: `rootRulesetNames` is only passed for per-repo validation (it's `undefined` at root level). This is the existing convention for distinguishing root vs per-repo context.

**Step 4: Run test to verify it passes**

Run: `npx tsc --noEmit && node --test test/unit/config-validator.test.ts --test-name-pattern "throws when root settings has repo: false"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-validator.ts test/unit/config-validator.test.ts
git commit -m "feat(validator): reject repo: false at root level"
```

---

### Task 3: Validator — Reject `repo: false` When No Root Repo Settings

**Files:**

- Modify: `src/config-validator.ts:843-894`
- Test: `test/unit/config-validator.test.ts`

**Step 1: Write the failing test**

Add after the previous test:

```typescript
test("throws when per-repo repo: false but no root repo settings defined", () => {
  const config = createValidConfig({
    settings: {
      rulesets: {
        "main-protection": { target: "branch" },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          repo: false as never,
        },
      },
    ],
  });

  assert.throws(
    () => validateRawConfig(config),
    /Cannot opt out of repo settings .* not defined in root settings/
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsc --noEmit && node --test test/unit/config-validator.test.ts --test-name-pattern "throws when per-repo repo: false but no root repo settings defined"`
Expected: FAIL

**Step 3: Implement the validation**

In `src/config-validator.ts`, inside the `validateSettings` function, update the `repo: false` handling to also check for root repo settings. We need to pass the root repo settings info. The cleanest approach: add an optional `hasRootRepoSettings` parameter to `validateSettings`.

Update the `validateSettings` signature (line ~843):

```typescript
export function validateSettings(
  settings: unknown,
  context: string,
  rootRulesetNames?: string[],
  hasRootRepoSettings?: boolean
): void {
```

Then update the `repo: false` block:

```typescript
// Validate repo settings
if (s.repo !== undefined) {
  if (s.repo === false) {
    if (!rootRulesetNames) {
      // Root level — repo: false not valid here
      throw new Error(
        `${context}: repo: false is not valid at root level. Define repo settings or remove the field.`
      );
    }
    // Per-repo level — check root has repo settings to opt out of
    if (!hasRootRepoSettings) {
      throw new Error(
        `${context}: Cannot opt out of repo settings — not defined in root settings.repo`
      );
    }
    // Valid opt-out, skip further repo validation
  } else {
    validateRepoSettings(s.repo, context);
  }
}
```

Update the call site in `validateRawConfig` (line ~398-407) to pass the new parameter:

```typescript
// Validate per-repo settings
if (repo.settings !== undefined) {
  const rootRulesetNames = config.settings?.rulesets
    ? Object.keys(config.settings.rulesets).filter((k) => k !== "inherit")
    : [];
  const hasRootRepoSettings =
    config.settings?.repo !== undefined && config.settings.repo !== false;
  validateSettings(
    repo.settings,
    `Repo ${getGitDisplayName(repo.git)}`,
    rootRulesetNames,
    hasRootRepoSettings
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsc --noEmit && node --test test/unit/config-validator.test.ts --test-name-pattern "throws when per-repo repo: false but no root repo settings defined"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-validator.ts test/unit/config-validator.test.ts
git commit -m "feat(validator): reject repo: false when no root repo settings exist"
```

---

### Task 4: Validator — Allow Valid `repo: false` Per-Repo

**Files:**

- Test: `test/unit/config-validator.test.ts`

**Step 1: Write the passing test (green check)**

Add after the previous tests:

```typescript
test("allows per-repo repo: false when root repo settings exist", () => {
  const config = createValidConfig({
    settings: {
      repo: {
        hasIssues: true,
        hasWiki: true,
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          repo: false as never,
        },
      },
    ],
    files: undefined,
  });

  assert.doesNotThrow(() => validateRawConfig(config));
});
```

**Step 2: Run test to verify it passes**

Run: `npx tsc --noEmit && node --test test/unit/config-validator.test.ts --test-name-pattern "allows per-repo repo: false when root repo settings exist"`
Expected: PASS (already implemented in Task 3)

**Step 3: Commit**

```bash
git add test/unit/config-validator.test.ts
git commit -m "test(validator): verify repo: false accepted when root repo settings exist"
```

---

### Task 5: Normalizer — Handle `repo: false`

**Files:**

- Modify: `src/config-normalizer.ts:138-143`
- Test: `test/unit/config-normalizer.test.ts`

**Step 1: Write failing tests**

Add a new describe block after the existing "rulesets opt-out" describe (around line 2100):

```typescript
describe("repo settings opt-out", () => {
  test("repo: false excludes all root repo settings", () => {
    const raw: RawConfig = {
      id: "test-config",
      settings: {
        repo: {
          hasIssues: true,
          hasWiki: true,
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          settings: {
            repo: false as never,
          },
        },
      ],
    };

    const result = normalizeConfig(raw);
    assert.equal(result.repos[0].settings?.repo, undefined);
  });

  test("repo: false still allows rulesets to be inherited", () => {
    const raw: RawConfig = {
      id: "test-config",
      settings: {
        repo: {
          hasIssues: true,
        },
        rulesets: {
          "main-protection": { target: "branch", enforcement: "active" },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          settings: {
            repo: false as never,
          },
        },
      ],
    };

    const result = normalizeConfig(raw);
    assert.equal(result.repos[0].settings?.repo, undefined);
    assert.ok(result.repos[0].settings?.rulesets?.["main-protection"]);
  });
});
```

Also add a unit test for `mergeSettings` directly, in the existing "mergeSettings with repo" describe (around line 2104):

```typescript
test("should return no repo settings when per-repo repo is false", () => {
  const root: RawRepoSettings = {
    repo: {
      hasIssues: true,
      hasWiki: true,
    },
  };
  const perRepo: RawRepoSettings = {
    repo: false,
  };
  const result = mergeSettings(root, perRepo);
  assert.equal(result?.repo, undefined);
});

test("should return no repo settings when per-repo repo is false even without root", () => {
  const perRepo: RawRepoSettings = {
    repo: false,
  };
  const result = mergeSettings(undefined, perRepo);
  assert.equal(result?.repo, undefined);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsc --noEmit && node --test test/unit/config-normalizer.test.ts --test-name-pattern "repo settings opt-out|should return no repo settings when per-repo repo is false"`
Expected: FAIL — `repo: false` currently gets spread into the merge.

**Step 3: Implement the change**

In `src/config-normalizer.ts`, replace lines 138-143:

```typescript
// Merge repo settings: per-repo overrides root (shallow merge)
const rootRepo = root?.repo;
const perRepoRepo = perRepo?.repo;
if (rootRepo || perRepoRepo) {
  result.repo = { ...rootRepo, ...perRepoRepo };
}
```

with:

```typescript
// Merge repo settings: per-repo overrides root (shallow merge)
// repo: false means opt out of all root repo settings
if (perRepo?.repo === false) {
  // Opt-out: don't include any repo settings
} else {
  const rootRepo = root?.repo;
  const perRepoRepo = perRepo?.repo;
  if (rootRepo || perRepoRepo) {
    result.repo = {
      ...(rootRepo === false ? {} : rootRepo),
      ...perRepoRepo,
    } as GitHubRepoSettings;
  }
}
```

Note: We also guard against `rootRepo === false` defensively (even though validation prevents it at root level, belt-and-suspenders for the merge function).

**Step 4: Run tests to verify they pass**

Run: `npx tsc --noEmit && node --test test/unit/config-normalizer.test.ts --test-name-pattern "repo settings opt-out|should return no repo settings when per-repo repo is false"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-normalizer.ts test/unit/config-normalizer.test.ts
git commit -m "feat(normalizer): handle repo: false opt-out in mergeSettings"
```

---

### Task 6: Validator — Update `hasActionableSettings` for `repo: false`

**Files:**

- Modify: `src/config-validator.ts:925-941`
- Test: `test/unit/config-validator.test.ts`

**Step 1: Write the failing test**

Add in the `hasActionableSettings` describe block (around line 2487):

```typescript
test("returns false when repo is false (opt-out)", () => {
  assert.equal(hasActionableSettings({ repo: false as never }), false);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsc --noEmit && node --test test/unit/config-validator.test.ts --test-name-pattern "returns false when repo is false"`
Expected: FAIL — `false` is truthy and `Object.keys(false)` returns `[]` but the current code checks `settings.repo && Object.keys(settings.repo).length > 0`. Actually `false` is falsy, so `settings.repo && ...` would be `false`. Let's verify.

Looking at the code: `if (settings.repo && Object.keys(settings.repo).length > 0)` — `false && ...` is `false`, so this would already return `false`. The test should pass already. Let's verify this is correct and just add the test as documentation.

**Step 2 (revised): Run test to verify it passes**

Run: `npx tsc --noEmit && node --test test/unit/config-validator.test.ts --test-name-pattern "returns false when repo is false"`
Expected: PASS (already handles this case because `false` is falsy)

**Step 3: Commit**

```bash
git add test/unit/config-validator.test.ts
git commit -m "test(validator): verify hasActionableSettings returns false for repo: false"
```

---

### Task 7: Processor — Verify Skipping Behavior

**Files:**

- Test: `test/unit/repo-settings-processor.test.ts`

**Step 1: Write the test**

This test verifies the end-to-end behavior: after normalization, a repo with `repo: false` has no settings, so the processor skips it. Add after the existing "should skip repos with no repo settings" test (around line 128):

```typescript
test("should skip repos where repo settings were opted out (undefined after normalization)", async () => {
  const processor = new RepoSettingsProcessor(mockStrategy);
  const repoConfig: RepoConfig = {
    git: githubRepo.gitUrl,
    files: [],
    settings: {
      rulesets: {
        "main-protection": { target: "branch", enforcement: "active" },
      },
      // repo is undefined (opted out via repo: false, stripped by normalizer)
    },
  };

  const result = await processor.process(repoConfig, githubRepo, {
    dryRun: false,
  });

  assert.equal(result.skipped, true);
  assert.ok(result.message.includes("No repo settings configured"));
  assert.equal(mockStrategy.getSettingsCalls.length, 0);
});
```

**Step 2: Run test to verify it passes**

Run: `npx tsc --noEmit && node --test test/unit/repo-settings-processor.test.ts --test-name-pattern "should skip repos where repo settings were opted out"`
Expected: PASS (processor already handles this — this is a documentation test)

**Step 3: Commit**

```bash
git add test/unit/repo-settings-processor.test.ts
git commit -m "test(processor): verify processor skips repos with opted-out repo settings"
```

---

### Task 8: Run Full Test Suite

**Step 1: Run all unit tests**

Run: `npm test`
Expected: All tests PASS

**Step 2: Run linter**

Run: `./lint.sh`
Expected: No lint errors

**Step 3: If any failures, fix and re-run**

Fix any issues found, commit the fixes.

---

### Task 9: Update Documentation

**Files:**

- Modify: `docs/settings.md` (or equivalent settings docs page)

**Step 1: Find the settings docs**

Run: `ls docs/` to find the settings documentation file.

**Step 2: Add repo settings opt-out documentation**

Add a section documenting the `repo: false` opt-out, mirroring how rulesets opt-out is documented. Include a YAML example.

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: document repo settings opt-out with repo: false"
```
