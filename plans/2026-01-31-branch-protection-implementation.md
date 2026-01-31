# Branch Protection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `xfg protect` subcommand to manage GitHub branch protection rules declaratively.

**Architecture:** Extend config schema with `settings.branchProtection`, add manifest V3 for typed resource tracking, create `BranchProtectionProcessor` following existing `RepositoryProcessor` patterns, use strategy pattern for GitHub API calls.

**Tech Stack:** TypeScript, Commander.js (subcommands), GitHub REST API via `gh` CLI, Node.js test runner.

---

## Task 1: Add Settings Types to Config

**Files:**

- Modify: `src/config.ts`
- Test: `src/config.test.ts`

**Step 1: Write the failing test**

Add to `src/config.test.ts`:

```typescript
describe("settings types", () => {
  test("BranchProtectionRule has all expected optional fields", () => {
    const rule: BranchProtectionRule = {
      requiredReviews: 2,
      dismissStaleReviews: true,
    };
    assert.equal(rule.requiredReviews, 2);
    assert.equal(rule.dismissStaleReviews, true);
  });

  test("RepoSettings includes branchProtection map", () => {
    const settings: RepoSettings = {
      branchProtection: {
        main: { requiredReviews: 1 },
      },
    };
    assert.equal(settings.branchProtection?.main?.requiredReviews, 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="settings types"`
Expected: FAIL with "BranchProtectionRule is not defined"

**Step 3: Write types in config.ts**

Add to `src/config.ts` after existing types:

```typescript
// =============================================================================
// Branch Protection Types
// =============================================================================

export interface RequiredStatusChecks {
  strict?: boolean;
  checks?: string[];
}

export interface BranchProtectionRule {
  // Required reviews
  requiredReviews?: number;
  dismissStaleReviews?: boolean;
  requireCodeOwners?: boolean;
  requireLastPushApproval?: boolean;

  // Status checks
  requiredStatusChecks?: RequiredStatusChecks;

  // Restrictions
  enforceAdmins?: boolean;
  requiredLinearHistory?: boolean;
  allowForcePushes?: boolean;
  allowDeletions?: boolean;
  requiredConversationResolution?: boolean;

  // Signatures
  requiredSignatures?: boolean;
}

export interface RepoSettings {
  branchProtection?: Record<string, BranchProtectionRule>;
  deleteOrphaned?: boolean;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="settings types"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(config): add branch protection and settings types"
```

---

## Task 2: Add Raw Settings Types for Config Parsing

**Files:**

- Modify: `src/config.ts`
- Test: `src/config.test.ts`

**Step 1: Write the failing test**

Add to `src/config.test.ts`:

```typescript
describe("raw settings types", () => {
  test("RawRepoSettings can hold branchProtection", () => {
    const settings: RawRepoSettings = {
      branchProtection: {
        main: { requiredReviews: 2 },
      },
    };
    assert.ok(settings.branchProtection);
  });

  test("RawConfig can include settings at root", () => {
    const config: RawConfig = {
      id: "test",
      files: {},
      repos: [],
      settings: {
        branchProtection: {
          main: { requiredReviews: 1 },
        },
      },
    };
    assert.ok(config.settings?.branchProtection);
  });

  test("RawRepoConfig can include settings", () => {
    const repo: RawRepoConfig = {
      git: "org/repo",
      settings: {
        branchProtection: {
          main: { requiredReviews: 3 },
        },
      },
    };
    assert.ok(repo.settings?.branchProtection);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="raw settings types"`
Expected: FAIL with "RawRepoSettings is not defined"

**Step 3: Add raw types to config.ts**

Add after `RawRepoFileOverride` interface:

```typescript
// Raw settings (before normalization)
export interface RawRepoSettings {
  branchProtection?: Record<string, BranchProtectionRule>;
  deleteOrphaned?: boolean;
}
```

Update `RawRepoConfig`:

```typescript
export interface RawRepoConfig {
  git: string | string[];
  files?: Record<string, RawRepoFileOverride | false>;
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings; // ADD THIS LINE
}
```

Update `RawConfig`:

```typescript
export interface RawConfig {
  id: string;
  files: Record<string, RawFileConfig>;
  repos: RawRepoConfig[];
  prOptions?: PRMergeOptions;
  prTemplate?: string;
  githubHosts?: string[];
  deleteOrphaned?: boolean;
  settings?: RawRepoSettings; // ADD THIS LINE
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="raw settings types"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(config): add raw settings types for config parsing"
```

---

## Task 3: Add Settings to Normalized Config Types

**Files:**

- Modify: `src/config.ts`
- Test: `src/config.test.ts`

**Step 1: Write the failing test**

Add to `src/config.test.ts`:

```typescript
describe("normalized config types", () => {
  test("RepoConfig can include resolved settings", () => {
    const repo: RepoConfig = {
      git: "org/repo",
      files: [],
      settings: {
        branchProtection: {
          main: { requiredReviews: 2 },
        },
      },
    };
    assert.ok(repo.settings?.branchProtection);
  });

  test("Config can include root settings", () => {
    const config: Config = {
      id: "test",
      repos: [],
      settings: {
        branchProtection: {
          main: { requiredReviews: 1 },
        },
      },
    };
    assert.ok(config.settings?.branchProtection);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="normalized config types"`
Expected: FAIL - `settings` not assignable to RepoConfig

**Step 3: Update normalized types**

Update `RepoConfig`:

```typescript
export interface RepoConfig {
  git: string;
  files: FileContent[];
  prOptions?: PRMergeOptions;
  settings?: RepoSettings; // ADD THIS LINE
}
```

Update `Config`:

```typescript
export interface Config {
  id: string;
  repos: RepoConfig[];
  prTemplate?: string;
  githubHosts?: string[];
  deleteOrphaned?: boolean;
  settings?: RepoSettings; // ADD THIS LINE
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="normalized config types"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(config): add settings to normalized config types"
```

---

## Task 4: Validate Settings in Config Validator

**Files:**

- Modify: `src/config-validator.ts`
- Test: `src/config-validator.test.ts`

**Step 1: Write the failing test**

Add to `src/config-validator.test.ts`:

```typescript
describe("settings validation", () => {
  test("accepts valid branchProtection settings", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.json": { content: {} } },
      repos: [{ git: "org/repo" }],
      settings: {
        branchProtection: {
          main: { requiredReviews: 2 },
        },
      },
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("rejects non-object branchProtection", () => {
    const config = {
      id: "test",
      files: { "test.json": { content: {} } },
      repos: [{ git: "org/repo" }],
      settings: {
        branchProtection: "invalid",
      },
    } as unknown as RawConfig;
    assert.throws(
      () => validateRawConfig(config),
      /branchProtection must be an object/
    );
  });

  test("rejects non-integer requiredReviews", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.json": { content: {} } },
      repos: [{ git: "org/repo" }],
      settings: {
        branchProtection: {
          main: { requiredReviews: 1.5 },
        },
      },
    };
    assert.throws(
      () => validateRawConfig(config),
      /requiredReviews must be a non-negative integer/
    );
  });

  test("rejects negative requiredReviews", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.json": { content: {} } },
      repos: [{ git: "org/repo" }],
      settings: {
        branchProtection: {
          main: { requiredReviews: -1 },
        },
      },
    };
    assert.throws(
      () => validateRawConfig(config),
      /requiredReviews must be a non-negative integer/
    );
  });

  test("validates per-repo settings override", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.json": { content: {} } },
      repos: [
        {
          git: "org/repo",
          settings: {
            branchProtection: {
              main: { requiredReviews: 3 },
            },
          },
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="settings validation"`
Expected: FAIL - validation not implemented

**Step 3: Add validation function**

Add to `src/config-validator.ts`:

```typescript
/**
 * Validates branch protection rule fields.
 */
function validateBranchProtectionRule(
  rule: unknown,
  branchName: string,
  context: string
): void {
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
    throw new Error(
      `${context}: branchProtection.${branchName} must be an object`
    );
  }

  const r = rule as Record<string, unknown>;

  if (r.requiredReviews !== undefined) {
    if (
      typeof r.requiredReviews !== "number" ||
      !Number.isInteger(r.requiredReviews) ||
      r.requiredReviews < 0
    ) {
      throw new Error(
        `${context}: branchProtection.${branchName}.requiredReviews must be a non-negative integer`
      );
    }
  }

  const booleanFields = [
    "dismissStaleReviews",
    "requireCodeOwners",
    "requireLastPushApproval",
    "enforceAdmins",
    "requiredLinearHistory",
    "allowForcePushes",
    "allowDeletions",
    "requiredConversationResolution",
    "requiredSignatures",
  ];

  for (const field of booleanFields) {
    if (r[field] !== undefined && typeof r[field] !== "boolean") {
      throw new Error(
        `${context}: branchProtection.${branchName}.${field} must be a boolean`
      );
    }
  }

  if (r.requiredStatusChecks !== undefined) {
    const checks = r.requiredStatusChecks;
    if (
      typeof checks !== "object" ||
      checks === null ||
      Array.isArray(checks)
    ) {
      throw new Error(
        `${context}: branchProtection.${branchName}.requiredStatusChecks must be an object`
      );
    }
    const c = checks as Record<string, unknown>;
    if (c.strict !== undefined && typeof c.strict !== "boolean") {
      throw new Error(
        `${context}: branchProtection.${branchName}.requiredStatusChecks.strict must be a boolean`
      );
    }
    if (c.checks !== undefined) {
      if (
        !Array.isArray(c.checks) ||
        !c.checks.every((x) => typeof x === "string")
      ) {
        throw new Error(
          `${context}: branchProtection.${branchName}.requiredStatusChecks.checks must be an array of strings`
        );
      }
    }
  }
}

/**
 * Validates settings object.
 */
function validateSettings(settings: unknown, context: string): void {
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    throw new Error(`${context}: settings must be an object`);
  }

  const s = settings as Record<string, unknown>;

  if (s.branchProtection !== undefined) {
    if (
      typeof s.branchProtection !== "object" ||
      s.branchProtection === null ||
      Array.isArray(s.branchProtection)
    ) {
      throw new Error(`${context}: branchProtection must be an object`);
    }

    const bp = s.branchProtection as Record<string, unknown>;
    for (const [branchName, rule] of Object.entries(bp)) {
      validateBranchProtectionRule(rule, branchName, context);
    }
  }

  if (s.deleteOrphaned !== undefined && typeof s.deleteOrphaned !== "boolean") {
    throw new Error(`${context}: settings.deleteOrphaned must be a boolean`);
  }
}
```

Then update `validateRawConfig` to call it:

After validating `config.githubHosts`, add:

```typescript
// Validate root settings
if (config.settings !== undefined) {
  validateSettings(config.settings, "Root");
}
```

Inside the repo validation loop, after file override validation:

```typescript
// Validate per-repo settings
if (repo.settings !== undefined) {
  validateSettings(repo.settings, `Repo ${getGitDisplayName(repo.git)}`);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="settings validation"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-validator.ts src/config-validator.test.ts
git commit -m "feat(config): add settings validation"
```

---

## Task 5: Deep Merge Settings in Normalizer

**Files:**

- Modify: `src/config-normalizer.ts`
- Test: `src/config-normalizer.test.ts`

**Step 1: Write the failing test**

Add to `src/config-normalizer.test.ts`:

```typescript
describe("settings normalization", () => {
  test("inherits root settings when repo has no settings", () => {
    const raw: RawConfig = {
      id: "test",
      files: { "test.json": { content: {} } },
      repos: [{ git: "org/repo" }],
      settings: {
        branchProtection: {
          main: { requiredReviews: 1 },
        },
      },
    };
    const config = normalizeConfig(raw);
    assert.deepEqual(config.repos[0].settings, {
      branchProtection: {
        main: { requiredReviews: 1 },
      },
    });
  });

  test("deep merges repo settings with root settings", () => {
    const raw: RawConfig = {
      id: "test",
      files: { "test.json": { content: {} } },
      repos: [
        {
          git: "org/repo",
          settings: {
            branchProtection: {
              main: { requiredReviews: 3 }, // override
              develop: { requiredReviews: 1 }, // add
            },
          },
        },
      ],
      settings: {
        branchProtection: {
          main: { requiredReviews: 1, dismissStaleReviews: true },
        },
      },
    };
    const config = normalizeConfig(raw);
    // main should be merged: requiredReviews overridden, dismissStaleReviews inherited
    assert.equal(
      config.repos[0].settings?.branchProtection?.main?.requiredReviews,
      3
    );
    assert.equal(
      config.repos[0].settings?.branchProtection?.main?.dismissStaleReviews,
      true
    );
    // develop should be added
    assert.equal(
      config.repos[0].settings?.branchProtection?.develop?.requiredReviews,
      1
    );
  });

  test("uses repo settings when no root settings", () => {
    const raw: RawConfig = {
      id: "test",
      files: { "test.json": { content: {} } },
      repos: [
        {
          git: "org/repo",
          settings: {
            branchProtection: {
              main: { requiredReviews: 2 },
            },
          },
        },
      ],
    };
    const config = normalizeConfig(raw);
    assert.equal(
      config.repos[0].settings?.branchProtection?.main?.requiredReviews,
      2
    );
  });

  test("returns undefined settings when neither root nor repo has settings", () => {
    const raw: RawConfig = {
      id: "test",
      files: { "test.json": { content: {} } },
      repos: [{ git: "org/repo" }],
    };
    const config = normalizeConfig(raw);
    assert.equal(config.repos[0].settings, undefined);
  });

  test("preserves root settings in normalized config", () => {
    const raw: RawConfig = {
      id: "test",
      files: { "test.json": { content: {} } },
      repos: [{ git: "org/repo" }],
      settings: {
        branchProtection: {
          main: { requiredReviews: 1 },
        },
      },
    };
    const config = normalizeConfig(raw);
    assert.deepEqual(config.settings, {
      branchProtection: {
        main: { requiredReviews: 1 },
      },
    });
  });

  test("settings.deleteOrphaned merges correctly", () => {
    const raw: RawConfig = {
      id: "test",
      files: { "test.json": { content: {} } },
      repos: [
        {
          git: "org/repo",
          settings: { deleteOrphaned: true },
        },
      ],
      settings: { deleteOrphaned: false },
    };
    const config = normalizeConfig(raw);
    // Per-repo overrides root
    assert.equal(config.repos[0].settings?.deleteOrphaned, true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="settings normalization"`
Expected: FAIL - settings not being processed

**Step 3: Add settings merging to normalizer**

Add imports and helper functions, then update `normalizeConfig` to merge settings.

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="settings normalization"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-normalizer.ts src/config-normalizer.test.ts
git commit -m "feat(config): deep merge settings in normalizer"
```

---

## Task 6-7: Upgrade Manifest to V3

Upgrade manifest structure to support typed resources (files, branchProtection).

---

## Task 8: Fix Existing Tests After V3 Upgrade

Update any tests that break due to manifest V3 changes.

---

## Task 9: Add Subcommand Structure to CLI

Refactor index.ts to use Commander subcommands (sync, protect).

---

## Task 10-11: Create GitHub Protection Strategy

Create strategy for GitHub API calls to get/set/delete branch protection.

---

## Task 12: Create Protection Diff Utility

Utility to compare current vs desired protection and generate diffs.

---

## Task 13: Create Branch Protection Processor

Main orchestrator for `xfg protect` command.

---

## Task 14: Wire Up protect Command in CLI

Connect the processor to the CLI command.

---

## Task 15: Add Integration Tests

Create integration tests for the protect command.

---

## Task 16: Update config-schema.json

Add settings schema for IDE validation.

---

## Task 17: Final Testing and Cleanup

Run full test suite, linting, and verify builds.

---

Plan complete and saved to `plans/2026-01-31-branch-protection-implementation.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
