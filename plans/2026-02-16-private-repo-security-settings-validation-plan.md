# Private Repo Security Settings Validation - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect and fail repos that configure security settings incompatible with their visibility/owner type, in both dry-run and apply modes.

**Architecture:** Add `owner_type` to `CurrentRepoSettings`, extract it from the GitHub API response in `getSettings()`, then validate desired security settings against the repo's visibility and owner type in `RepoSettingsProcessor.process()` before computing the diff.

**Tech Stack:** TypeScript, node:test, node:assert

---

### Task 1: Add `owner_type` to `CurrentRepoSettings`

**Files:**

- Modify: `src/settings/repo-settings/types.ts:12-42`

**Step 1: Write the failing test**

Add a test to `test/unit/settings/repo-settings/github-repo-settings-strategy.test.ts` in the `getSettings` describe block:

```typescript
test("should extract owner_type from API response", async () => {
  mockExecutor.setResponse(
    "/repos/test-org/test-repo'",
    JSON.stringify({
      has_issues: true,
      owner: { type: "Organization", login: "test-org" },
    })
  );
  mockExecutor.setResponse("vulnerability-alerts", "");
  mockExecutor.setResponse("automated-security-fixes", "");
  mockExecutor.setResponse(
    "private-vulnerability-reporting",
    JSON.stringify({ enabled: false })
  );

  const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
  const result = await strategy.getSettings(githubRepo);

  assert.equal(result.owner_type, "Organization");
});

test("should extract owner_type User from API response", async () => {
  mockExecutor.setResponse(
    "/repos/test-org/test-repo'",
    JSON.stringify({
      has_issues: true,
      owner: { type: "User", login: "test-org" },
    })
  );
  mockExecutor.setResponse("vulnerability-alerts", "");
  mockExecutor.setResponse("automated-security-fixes", "");
  mockExecutor.setResponse(
    "private-vulnerability-reporting",
    JSON.stringify({ enabled: false })
  );

  const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
  const result = await strategy.getSettings(githubRepo);

  assert.equal(result.owner_type, "User");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -E "(owner_type|FAIL|✓|✗)"`
Expected: FAIL — `result.owner_type` is `undefined`

**Step 3: Add `owner_type` to type and extract in strategy**

In `src/settings/repo-settings/types.ts`, add to `CurrentRepoSettings`:

```typescript
  // Owner metadata (extracted from API response)
  owner_type?: string;
```

In `src/settings/repo-settings/github-repo-settings-strategy.ts`, in `getSettings()` after `const settings = JSON.parse(result) as CurrentRepoSettings;`, add:

```typescript
// Extract owner type from nested API response
const parsed = JSON.parse(result);
settings.owner_type = parsed.owner?.type;
```

Note: we need to parse `result` again (or parse once and assign) since `CurrentRepoSettings` doesn't model the nested `owner` object. The cleanest approach: parse once into a local variable, cast to `CurrentRepoSettings`, then extract `owner_type`.

Revised approach — replace the two-line parse block at lines 110-111 with:

```typescript
const parsed = JSON.parse(result);
const settings = parsed as CurrentRepoSettings;

// Extract owner type from nested API response
settings.owner_type = parsed.owner?.type;
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/settings/repo-settings/types.ts src/settings/repo-settings/github-repo-settings-strategy.ts test/unit/settings/repo-settings/github-repo-settings-strategy.test.ts
git commit -m "feat(settings): extract owner_type from GitHub API response"
```

---

### Task 2: Add security settings validation to processor

**Files:**

- Modify: `src/settings/repo-settings/processor.ts:58-111`
- Test: `test/unit/repo-settings-processor.test.ts`

**Step 1: Write failing tests for `privateVulnerabilityReporting` on non-public repos**

Add a new `describe("security settings validation", ...)` block to `test/unit/repo-settings-processor.test.ts`:

```typescript
describe("security settings validation", () => {
  test("should fail when privateVulnerabilityReporting is true on a private repo", async () => {
    mockStrategy.getSettingsResult = {
      visibility: "private",
      owner_type: "User",
    };

    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: { repo: { privateVulnerabilityReporting: true } },
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: false,
    });

    assert.equal(result.success, false);
    assert.ok(
      result.message.includes("privateVulnerabilityReporting"),
      `Expected message to mention privateVulnerabilityReporting, got: ${result.message}`
    );
    assert.ok(
      result.message.includes("public"),
      `Expected message to mention public repos, got: ${result.message}`
    );
  });

  test("should fail when privateVulnerabilityReporting is true on a private repo in dry-run mode", async () => {
    mockStrategy.getSettingsResult = {
      visibility: "private",
      owner_type: "Organization",
    };

    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: { repo: { privateVulnerabilityReporting: true } },
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: true,
    });

    assert.equal(result.success, false);
    assert.ok(result.message.includes("privateVulnerabilityReporting"));
  });

  test("should allow privateVulnerabilityReporting on public repos", async () => {
    mockStrategy.getSettingsResult = {
      visibility: "public",
      owner_type: "User",
      private_vulnerability_reporting: false,
    };

    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: { repo: { privateVulnerabilityReporting: true } },
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: true,
    });

    assert.equal(result.success, true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -E "(security settings|FAIL)"`
Expected: FAIL — processor returns `success: true` instead of `false`

**Step 3: Write failing tests for `secretScanning` on user-owned private repos**

Add to the same `describe` block:

```typescript
test("should fail when secretScanning is true on a user-owned private repo", async () => {
  mockStrategy.getSettingsResult = {
    visibility: "private",
    owner_type: "User",
  };

  const processor = new RepoSettingsProcessor(mockStrategy);
  const repoConfig: RepoConfig = {
    git: githubRepo.gitUrl,
    files: [],
    settings: { repo: { secretScanning: true } },
  };

  const result = await processor.process(repoConfig, githubRepo, {
    dryRun: false,
  });

  assert.equal(result.success, false);
  assert.ok(result.message.includes("secretScanning"));
});

test("should fail when secretScanningPushProtection is true on a user-owned private repo", async () => {
  mockStrategy.getSettingsResult = {
    visibility: "private",
    owner_type: "User",
  };

  const processor = new RepoSettingsProcessor(mockStrategy);
  const repoConfig: RepoConfig = {
    git: githubRepo.gitUrl,
    files: [],
    settings: { repo: { secretScanningPushProtection: true } },
  };

  const result = await processor.process(repoConfig, githubRepo, {
    dryRun: false,
  });

  assert.equal(result.success, false);
  assert.ok(result.message.includes("secretScanningPushProtection"));
});

test("should fail when secretScanning is true on org-owned private repo without GHAS", async () => {
  mockStrategy.getSettingsResult = {
    visibility: "private",
    owner_type: "Organization",
    security_and_analysis: undefined,
  };

  const processor = new RepoSettingsProcessor(mockStrategy);
  const repoConfig: RepoConfig = {
    git: githubRepo.gitUrl,
    files: [],
    settings: { repo: { secretScanning: true } },
  };

  const result = await processor.process(repoConfig, githubRepo, {
    dryRun: false,
  });

  assert.equal(result.success, false);
  assert.ok(result.message.includes("secretScanning"));
});

test("should allow secretScanning on org-owned private repo with GHAS enabled", async () => {
  mockStrategy.getSettingsResult = {
    visibility: "private",
    owner_type: "Organization",
    security_and_analysis: {
      secret_scanning: { status: "disabled" },
    },
  };

  const processor = new RepoSettingsProcessor(mockStrategy);
  const repoConfig: RepoConfig = {
    git: githubRepo.gitUrl,
    files: [],
    settings: { repo: { secretScanning: true } },
  };

  const result = await processor.process(repoConfig, githubRepo, {
    dryRun: true,
  });

  assert.equal(result.success, true);
});

test("should allow secretScanning on public repos", async () => {
  mockStrategy.getSettingsResult = {
    visibility: "public",
    owner_type: "User",
  };

  const processor = new RepoSettingsProcessor(mockStrategy);
  const repoConfig: RepoConfig = {
    git: githubRepo.gitUrl,
    files: [],
    settings: { repo: { secretScanning: true } },
  };

  const result = await processor.process(repoConfig, githubRepo, {
    dryRun: true,
  });

  assert.equal(result.success, true);
});

test("should not fail when setting these to false on private repos", async () => {
  mockStrategy.getSettingsResult = {
    visibility: "private",
    owner_type: "User",
  };

  const processor = new RepoSettingsProcessor(mockStrategy);
  const repoConfig: RepoConfig = {
    git: githubRepo.gitUrl,
    files: [],
    settings: {
      repo: {
        secretScanning: false,
        secretScanningPushProtection: false,
        privateVulnerabilityReporting: false,
      },
    },
  };

  const result = await processor.process(repoConfig, githubRepo, {
    dryRun: true,
  });

  assert.equal(result.success, true);
});

test("should collect all incompatible settings into one error message", async () => {
  mockStrategy.getSettingsResult = {
    visibility: "private",
    owner_type: "User",
  };

  const processor = new RepoSettingsProcessor(mockStrategy);
  const repoConfig: RepoConfig = {
    git: githubRepo.gitUrl,
    files: [],
    settings: {
      repo: {
        secretScanning: true,
        secretScanningPushProtection: true,
        privateVulnerabilityReporting: true,
      },
    },
  };

  const result = await processor.process(repoConfig, githubRepo, {
    dryRun: false,
  });

  assert.equal(result.success, false);
  assert.ok(result.message.includes("secretScanning"));
  assert.ok(result.message.includes("privateVulnerabilityReporting"));
});
```

**Step 4: Implement validation in processor**

In `src/settings/repo-settings/processor.ts`, add a private method and call it after `getSettings()`:

```typescript
  /**
   * Validates that desired security settings are compatible with the repo's
   * visibility and owner type. Returns error messages for incompatible settings.
   */
  private validateSecuritySettings(
    desiredSettings: GitHubRepoSettings,
    currentSettings: CurrentRepoSettings
  ): string[] {
    const errors: string[] = [];
    const isPublic = currentSettings.visibility === "public";

    // privateVulnerabilityReporting is only available on public repos
    if (desiredSettings.privateVulnerabilityReporting === true && !isPublic) {
      errors.push(
        "privateVulnerabilityReporting is only available for public repositories"
      );
    }

    // secretScanning and secretScanningPushProtection:
    // - Available on public repos (free)
    // - Available on org private repos with GHAS (security_and_analysis is populated)
    // - NOT available on user private repos or org private repos without GHAS
    if (!isPublic) {
      const isUserOwned = currentSettings.owner_type === "User";
      const hasGHAS = currentSettings.security_and_analysis != null;

      if (desiredSettings.secretScanning === true && (isUserOwned || !hasGHAS)) {
        errors.push(
          "secretScanning requires GitHub Advanced Security (not available for this repository)"
        );
      }

      if (
        desiredSettings.secretScanningPushProtection === true &&
        (isUserOwned || !hasGHAS)
      ) {
        errors.push(
          "secretScanningPushProtection requires GitHub Advanced Security (not available for this repository)"
        );
      }
    }

    return errors;
  }
```

Then in the `process()` method, after `const currentSettings = await this.strategy.getSettings(...)` and before `const changes = diffRepoSettings(...)`, add:

```typescript
// Validate security settings compatibility
const securityErrors = this.validateSecuritySettings(
  desiredSettings,
  currentSettings
);
if (securityErrors.length > 0) {
  return {
    success: false,
    repoName,
    message: `Failed: ${securityErrors.join("; ")}`,
  };
}
```

**Step 5: Run all tests**

Run: `npm test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/settings/repo-settings/processor.ts test/unit/repo-settings-processor.test.ts
git commit -m "feat(settings): validate security settings against repo visibility and owner type"
```

---

### Task 3: Verify build and lint

**Step 1: Build**

Run: `npm run build`
Expected: Clean compilation

**Step 2: Lint**

Run: `./lint.sh`
Expected: Pass

**Step 3: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "fix(settings): lint fixes for security settings validation"
```

(Only if lint required fixes)
