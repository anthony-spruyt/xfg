# GitHub Repository Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add support for managing GitHub repository settings (features, merge options, security) via the `settings` command.

**Architecture:** New processor/strategy/diff/formatter modules following the existing ruleset pattern. Types added to config.ts, validation in config-validator.ts, inheritance in config-normalizer.ts. Integration in index.ts runSettings().

**Tech Stack:** TypeScript, Node.js, GitHub REST API via `gh api` CLI, Vitest for testing.

---

## Task 1: Add RepoSettings Types to config.ts

**Files:**

- Modify: `src/config.ts:338-343` (after existing RepoSettings interface)

**Step 1: Write the failing test**

Create test in `test/unit/config.test.ts` that imports the new type:

```typescript
// Add to existing imports at top of file
import type { GitHubRepoSettings } from "../src/config.js";

// Add new describe block
describe("GitHubRepoSettings type", () => {
  it("should accept valid repo settings", () => {
    const settings: GitHubRepoSettings = {
      hasIssues: true,
      hasWiki: false,
      allowSquashMerge: true,
      secretScanning: true,
    };
    expect(settings.hasIssues).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testNamePattern="GitHubRepoSettings type"`
Expected: FAIL with "Module has no exported member 'GitHubRepoSettings'"

**Step 3: Write minimal implementation**

Add to `src/config.ts` after line 343 (after existing RepoSettings interface):

```typescript
// =============================================================================
// GitHub Repository Settings Types
// =============================================================================

/** Squash merge commit title format */
export type SquashMergeCommitTitle = "PR_TITLE" | "COMMIT_OR_PR_TITLE";

/** Squash merge commit message format */
export type SquashMergeCommitMessage = "PR_BODY" | "COMMIT_MESSAGES" | "BLANK";

/** Merge commit title format */
export type MergeCommitTitle = "PR_TITLE" | "MERGE_MESSAGE";

/** Merge commit message format */
export type MergeCommitMessage = "PR_BODY" | "PR_TITLE" | "BLANK";

/** Repository visibility */
export type RepoVisibility = "public" | "private" | "internal";

/**
 * GitHub repository settings configuration.
 * All properties are optional - only specified properties are applied.
 * @see https://docs.github.com/en/rest/repos/repos#update-a-repository
 */
export interface GitHubRepoSettings {
  // Features
  hasIssues?: boolean;
  hasProjects?: boolean;
  hasWiki?: boolean;
  hasDiscussions?: boolean;
  isTemplate?: boolean;
  allowForking?: boolean;
  visibility?: RepoVisibility;
  archived?: boolean;

  // Merge options
  allowSquashMerge?: boolean;
  allowMergeCommit?: boolean;
  allowRebaseMerge?: boolean;
  allowAutoMerge?: boolean;
  deleteBranchOnMerge?: boolean;
  allowUpdateBranch?: boolean;
  squashMergeCommitTitle?: SquashMergeCommitTitle;
  squashMergeCommitMessage?: SquashMergeCommitMessage;
  mergeCommitTitle?: MergeCommitTitle;
  mergeCommitMessage?: MergeCommitMessage;

  // Security
  vulnerabilityAlerts?: boolean;
  automatedSecurityFixes?: boolean;
  secretScanning?: boolean;
  secretScanningPushProtection?: boolean;
  privateVulnerabilityReporting?: boolean;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testNamePattern="GitHubRepoSettings type"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts test/unit/config.test.ts
git commit -m "feat(config): add GitHubRepoSettings type for repository settings"
```

---

## Task 2: Update RepoSettings Interface

**Files:**

- Modify: `src/config.ts:338-343` (RepoSettings interface)
- Modify: `src/config.ts:377-381` (RawRepoSettings interface)

**Step 1: Write the failing test**

Add to `test/unit/config.test.ts`:

```typescript
describe("RepoSettings with repo property", () => {
  it("should accept repo settings in RepoSettings", () => {
    const settings: RepoSettings = {
      rulesets: {},
      repo: {
        hasIssues: true,
        allowSquashMerge: true,
      },
    };
    expect(settings.repo?.hasIssues).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testNamePattern="RepoSettings with repo property"`
Expected: FAIL with "Property 'repo' does not exist"

**Step 3: Write minimal implementation**

Update `RepoSettings` interface in `src/config.ts`:

```typescript
export interface RepoSettings {
  /** GitHub rulesets keyed by name */
  rulesets?: Record<string, Ruleset>;
  /** GitHub repository settings */
  repo?: GitHubRepoSettings;
  deleteOrphaned?: boolean;
}
```

Update `RawRepoSettings` interface:

```typescript
export interface RawRepoSettings {
  rulesets?: Record<string, Ruleset | false> & { inherit?: boolean };
  repo?: GitHubRepoSettings;
  deleteOrphaned?: boolean;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testNamePattern="RepoSettings with repo property"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts test/unit/config.test.ts
git commit -m "feat(config): add repo property to RepoSettings interface"
```

---

## Task 3: Add Repo Settings Validation

**Files:**

- Modify: `src/config-validator.ts`
- Modify: `test/unit/config-validator.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/config-validator.test.ts`:

```typescript
describe("validateRepoSettings", () => {
  it("should reject invalid visibility value", () => {
    const settings = {
      repo: {
        visibility: "secret" as unknown,
      },
    };
    expect(() => validateSettings(settings, "Test")).toThrow(
      "visibility must be one of: public, private, internal"
    );
  });

  it("should reject invalid squashMergeCommitTitle value", () => {
    const settings = {
      repo: {
        squashMergeCommitTitle: "INVALID" as unknown,
      },
    };
    expect(() => validateSettings(settings, "Test")).toThrow(
      "squashMergeCommitTitle must be one of: PR_TITLE, COMMIT_OR_PR_TITLE"
    );
  });

  it("should accept valid repo settings", () => {
    const settings = {
      repo: {
        hasIssues: true,
        visibility: "private",
        allowSquashMerge: true,
        squashMergeCommitTitle: "PR_TITLE",
      },
    };
    expect(() => validateSettings(settings, "Test")).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testNamePattern="validateRepoSettings"`
Expected: FAIL (validation not implemented)

**Step 3: Write minimal implementation**

Add to `src/config-validator.ts` after the ruleset validation constants:

```typescript
// =============================================================================
// Repo Settings Validation
// =============================================================================

const VALID_VISIBILITY = ["public", "private", "internal"];
const VALID_SQUASH_MERGE_COMMIT_TITLE = ["PR_TITLE", "COMMIT_OR_PR_TITLE"];
const VALID_SQUASH_MERGE_COMMIT_MESSAGE = [
  "PR_BODY",
  "COMMIT_MESSAGES",
  "BLANK",
];
const VALID_MERGE_COMMIT_TITLE = ["PR_TITLE", "MERGE_MESSAGE"];
const VALID_MERGE_COMMIT_MESSAGE = ["PR_BODY", "PR_TITLE", "BLANK"];

/**
 * Validates GitHub repository settings.
 */
function validateRepoSettings(repo: unknown, context: string): void {
  if (typeof repo !== "object" || repo === null || Array.isArray(repo)) {
    throw new Error(`${context}: repo must be an object`);
  }

  const r = repo as Record<string, unknown>;

  // Validate boolean fields
  const booleanFields = [
    "hasIssues",
    "hasProjects",
    "hasWiki",
    "hasDiscussions",
    "isTemplate",
    "allowForking",
    "archived",
    "allowSquashMerge",
    "allowMergeCommit",
    "allowRebaseMerge",
    "allowAutoMerge",
    "deleteBranchOnMerge",
    "allowUpdateBranch",
    "vulnerabilityAlerts",
    "automatedSecurityFixes",
    "secretScanning",
    "secretScanningPushProtection",
    "privateVulnerabilityReporting",
  ];

  for (const field of booleanFields) {
    if (r[field] !== undefined && typeof r[field] !== "boolean") {
      throw new Error(`${context}: ${field} must be a boolean`);
    }
  }

  // Validate enum fields
  if (
    r.visibility !== undefined &&
    !VALID_VISIBILITY.includes(r.visibility as string)
  ) {
    throw new Error(
      `${context}: visibility must be one of: ${VALID_VISIBILITY.join(", ")}`
    );
  }

  if (
    r.squashMergeCommitTitle !== undefined &&
    !VALID_SQUASH_MERGE_COMMIT_TITLE.includes(
      r.squashMergeCommitTitle as string
    )
  ) {
    throw new Error(
      `${context}: squashMergeCommitTitle must be one of: ${VALID_SQUASH_MERGE_COMMIT_TITLE.join(", ")}`
    );
  }

  if (
    r.squashMergeCommitMessage !== undefined &&
    !VALID_SQUASH_MERGE_COMMIT_MESSAGE.includes(
      r.squashMergeCommitMessage as string
    )
  ) {
    throw new Error(
      `${context}: squashMergeCommitMessage must be one of: ${VALID_SQUASH_MERGE_COMMIT_MESSAGE.join(", ")}`
    );
  }

  if (
    r.mergeCommitTitle !== undefined &&
    !VALID_MERGE_COMMIT_TITLE.includes(r.mergeCommitTitle as string)
  ) {
    throw new Error(
      `${context}: mergeCommitTitle must be one of: ${VALID_MERGE_COMMIT_TITLE.join(", ")}`
    );
  }

  if (
    r.mergeCommitMessage !== undefined &&
    !VALID_MERGE_COMMIT_MESSAGE.includes(r.mergeCommitMessage as string)
  ) {
    throw new Error(
      `${context}: mergeCommitMessage must be one of: ${VALID_MERGE_COMMIT_MESSAGE.join(", ")}`
    );
  }
}
```

Then add to `validateSettings` function after the rulesets validation:

```typescript
// Validate repo settings
if (s.repo !== undefined) {
  validateRepoSettings(s.repo, context);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testNamePattern="validateRepoSettings"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-validator.ts test/unit/config-validator.test.ts
git commit -m "feat(validator): add GitHub repo settings validation"
```

---

## Task 4: Update hasActionableSettings

**Files:**

- Modify: `src/config-validator.ts:811-825` (hasActionableSettings function)
- Modify: `test/unit/config-validator.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/config-validator.test.ts`:

```typescript
describe("hasActionableSettings with repo", () => {
  it("should return true when repo settings exist", () => {
    const settings = {
      repo: {
        hasIssues: true,
      },
    };
    expect(hasActionableSettings(settings)).toBe(true);
  });

  it("should return true when both rulesets and repo exist", () => {
    const settings = {
      rulesets: { "main-protection": { enforcement: "active" } },
      repo: { hasIssues: true },
    };
    expect(hasActionableSettings(settings)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testNamePattern="hasActionableSettings with repo"`
Expected: FAIL (returns false for repo-only settings)

**Step 3: Write minimal implementation**

Update `hasActionableSettings` in `src/config-validator.ts`:

```typescript
export function hasActionableSettings(
  settings: RawRepoSettings | undefined
): boolean {
  if (!settings) return false;

  // Check for rulesets
  if (settings.rulesets && Object.keys(settings.rulesets).length > 0) {
    return true;
  }

  // Check for repo settings
  if (settings.repo && Object.keys(settings.repo).length > 0) {
    return true;
  }

  return false;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testNamePattern="hasActionableSettings with repo"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-validator.ts test/unit/config-validator.test.ts
git commit -m "feat(validator): include repo settings in hasActionableSettings"
```

---

## Task 5: Update Config Normalizer for Repo Settings Inheritance

**Files:**

- Modify: `src/config-normalizer.ts:82-138` (mergeSettings function)
- Modify: `test/unit/config-normalizer.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/config-normalizer.test.ts`:

```typescript
describe("mergeSettings with repo", () => {
  it("should merge root and per-repo repo settings", () => {
    const root = {
      repo: {
        hasIssues: true,
        hasWiki: true,
      },
    };
    const perRepo = {
      repo: {
        hasWiki: false,
        allowSquashMerge: true,
      },
    };
    const result = mergeSettings(root, perRepo);
    expect(result?.repo).toEqual({
      hasIssues: true,
      hasWiki: false,
      allowSquashMerge: true,
    });
  });

  it("should use only root repo settings when no per-repo override", () => {
    const root = {
      repo: {
        hasIssues: true,
      },
    };
    const result = mergeSettings(root, undefined);
    expect(result?.repo).toEqual({ hasIssues: true });
  });

  it("should use only per-repo repo settings when no root", () => {
    const perRepo = {
      repo: {
        hasIssues: false,
      },
    };
    const result = mergeSettings(undefined, perRepo);
    expect(result?.repo).toEqual({ hasIssues: false });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testNamePattern="mergeSettings with repo"`
Expected: FAIL (repo settings not merged)

**Step 3: Write minimal implementation**

Add to `mergeSettings` in `src/config-normalizer.ts` before the final return:

```typescript
// Merge repo settings: per-repo overrides root (shallow merge)
const rootRepo = root?.repo;
const perRepoRepo = perRepo?.repo;
if (rootRepo || perRepoRepo) {
  result.repo = { ...rootRepo, ...perRepoRepo };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testNamePattern="mergeSettings with repo"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-normalizer.ts test/unit/config-normalizer.test.ts
git commit -m "feat(normalizer): add repo settings inheritance/merge support"
```

---

## Task 6: Create IRepoSettingsStrategy Interface

**Files:**

- Create: `src/strategies/repo-settings-strategy.ts`

**Step 1: Write the failing test**

Create `test/unit/strategies/repo-settings-strategy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { IRepoSettingsStrategy } from "../../../src/strategies/repo-settings-strategy.js";

describe("IRepoSettingsStrategy interface", () => {
  it("should define required methods", () => {
    // Type-level test - if this compiles, the interface is correct
    const mockStrategy: IRepoSettingsStrategy = {
      getSettings: async () => ({}),
      updateSettings: async () => {},
      setVulnerabilityAlerts: async () => {},
      setAutomatedSecurityFixes: async () => {},
    };
    expect(mockStrategy.getSettings).toBeDefined();
    expect(mockStrategy.updateSettings).toBeDefined();
    expect(mockStrategy.setVulnerabilityAlerts).toBeDefined();
    expect(mockStrategy.setAutomatedSecurityFixes).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testNamePattern="IRepoSettingsStrategy interface"`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `src/strategies/repo-settings-strategy.ts`:

```typescript
import type { RepoInfo } from "../repo-detector.js";
import type { GitHubRepoSettings } from "../config.js";

export interface RepoSettingsStrategyOptions {
  token?: string;
  host?: string;
}

/**
 * Current repository settings from GitHub API (snake_case).
 */
export interface CurrentRepoSettings {
  has_issues?: boolean;
  has_projects?: boolean;
  has_wiki?: boolean;
  has_discussions?: boolean;
  is_template?: boolean;
  allow_forking?: boolean;
  visibility?: string;
  archived?: boolean;
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
  allow_auto_merge?: boolean;
  delete_branch_on_merge?: boolean;
  allow_update_branch?: boolean;
  squash_merge_commit_title?: string;
  squash_merge_commit_message?: string;
  merge_commit_title?: string;
  merge_commit_message?: string;
  security_and_analysis?: {
    secret_scanning?: { status: string };
    secret_scanning_push_protection?: { status: string };
    secret_scanning_validity_checks?: { status: string };
  };
}

export interface IRepoSettingsStrategy {
  /**
   * Gets current repository settings.
   */
  getSettings(
    repoInfo: RepoInfo,
    options?: RepoSettingsStrategyOptions
  ): Promise<CurrentRepoSettings>;

  /**
   * Updates repository settings.
   */
  updateSettings(
    repoInfo: RepoInfo,
    settings: GitHubRepoSettings,
    options?: RepoSettingsStrategyOptions
  ): Promise<void>;

  /**
   * Enables or disables vulnerability alerts.
   */
  setVulnerabilityAlerts(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void>;

  /**
   * Enables or disables automated security fixes.
   */
  setAutomatedSecurityFixes(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void>;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testNamePattern="IRepoSettingsStrategy interface"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/strategies/repo-settings-strategy.ts test/unit/strategies/repo-settings-strategy.test.ts
git commit -m "feat(strategy): add IRepoSettingsStrategy interface"
```

---

## Task 7: Create GitHubRepoSettingsStrategy Implementation

**Files:**

- Create: `src/strategies/github-repo-settings-strategy.ts`
- Create: `test/unit/strategies/github-repo-settings-strategy.test.ts`

**Step 1: Write the failing test**

Create `test/unit/strategies/github-repo-settings-strategy.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubRepoSettingsStrategy } from "../../../src/strategies/github-repo-settings-strategy.js";
import type { GitHubRepoInfo } from "../../../src/repo-detector.js";

describe("GitHubRepoSettingsStrategy", () => {
  const mockExecutor = {
    exec: vi.fn(),
  };

  const githubRepo: GitHubRepoInfo = {
    type: "github",
    git: "https://github.com/test-org/test-repo.git",
    host: "github.com",
    owner: "test-org",
    repo: "test-repo",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSettings", () => {
    it("should fetch repository settings", async () => {
      mockExecutor.exec.mockResolvedValue(
        JSON.stringify({
          has_issues: true,
          has_wiki: false,
          allow_squash_merge: true,
        })
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      const result = await strategy.getSettings(githubRepo);

      expect(mockExecutor.exec).toHaveBeenCalledWith(
        expect.stringContaining("gh api"),
        expect.any(String)
      );
      expect(mockExecutor.exec).toHaveBeenCalledWith(
        expect.stringContaining("/repos/test-org/test-repo"),
        expect.any(String)
      );
      expect(result.has_issues).toBe(true);
      expect(result.has_wiki).toBe(false);
    });
  });

  describe("updateSettings", () => {
    it("should update repository settings via PATCH", async () => {
      mockExecutor.exec.mockResolvedValue("{}");

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      await strategy.updateSettings(githubRepo, {
        hasIssues: false,
        allowSquashMerge: true,
      });

      expect(mockExecutor.exec).toHaveBeenCalledWith(
        expect.stringContaining("-X PATCH"),
        expect.any(String)
      );
      expect(mockExecutor.exec).toHaveBeenCalledWith(
        expect.stringContaining("has_issues"),
        expect.any(String)
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testNamePattern="GitHubRepoSettingsStrategy"`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `src/strategies/github-repo-settings-strategy.ts`:

```typescript
import { ICommandExecutor, defaultExecutor } from "../command-executor.js";
import { isGitHubRepo, GitHubRepoInfo, RepoInfo } from "../repo-detector.js";
import { escapeShellArg } from "../shell-utils.js";
import type { GitHubRepoSettings } from "../config.js";
import type {
  IRepoSettingsStrategy,
  RepoSettingsStrategyOptions,
  CurrentRepoSettings,
} from "./repo-settings-strategy.js";

/**
 * Converts camelCase to snake_case.
 */
function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
}

/**
 * Converts GitHubRepoSettings (camelCase) to GitHub API format (snake_case).
 */
function configToGitHubPayload(
  settings: GitHubRepoSettings
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  // Map config properties to API properties
  const directMappings: (keyof GitHubRepoSettings)[] = [
    "hasIssues",
    "hasProjects",
    "hasWiki",
    "hasDiscussions",
    "isTemplate",
    "allowForking",
    "visibility",
    "archived",
    "allowSquashMerge",
    "allowMergeCommit",
    "allowRebaseMerge",
    "allowAutoMerge",
    "deleteBranchOnMerge",
    "allowUpdateBranch",
    "squashMergeCommitTitle",
    "squashMergeCommitMessage",
    "mergeCommitTitle",
    "mergeCommitMessage",
  ];

  for (const key of directMappings) {
    if (settings[key] !== undefined) {
      payload[camelToSnake(key)] = settings[key];
    }
  }

  // Handle security_and_analysis for secret scanning
  if (
    settings.secretScanning !== undefined ||
    settings.secretScanningPushProtection !== undefined
  ) {
    payload.security_and_analysis = {
      ...(settings.secretScanning !== undefined && {
        secret_scanning: {
          status: settings.secretScanning ? "enabled" : "disabled",
        },
      }),
      ...(settings.secretScanningPushProtection !== undefined && {
        secret_scanning_push_protection: {
          status: settings.secretScanningPushProtection
            ? "enabled"
            : "disabled",
        },
      }),
    };
  }

  return payload;
}

/**
 * GitHub Repository Settings Strategy.
 * Manages repository settings via GitHub REST API using `gh api` CLI.
 */
export class GitHubRepoSettingsStrategy implements IRepoSettingsStrategy {
  private executor: ICommandExecutor;

  constructor(executor?: ICommandExecutor) {
    this.executor = executor ?? defaultExecutor;
  }

  async getSettings(
    repoInfo: RepoInfo,
    options?: RepoSettingsStrategyOptions
  ): Promise<CurrentRepoSettings> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}`;
    const result = await this.ghApi("GET", endpoint, undefined, options);

    return JSON.parse(result) as CurrentRepoSettings;
  }

  async updateSettings(
    repoInfo: RepoInfo,
    settings: GitHubRepoSettings,
    options?: RepoSettingsStrategyOptions
  ): Promise<void> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const payload = configToGitHubPayload(settings);

    // Skip if no settings to update
    if (Object.keys(payload).length === 0) {
      return;
    }

    const endpoint = `/repos/${github.owner}/${github.repo}`;
    await this.ghApi("PATCH", endpoint, payload, options);
  }

  async setVulnerabilityAlerts(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/vulnerability-alerts`;
    const method = enable ? "PUT" : "DELETE";
    await this.ghApi(method, endpoint, undefined, options);
  }

  async setAutomatedSecurityFixes(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/automated-security-fixes`;
    const method = enable ? "PUT" : "DELETE";
    await this.ghApi(method, endpoint, undefined, options);
  }

  private validateGitHub(repoInfo: RepoInfo): void {
    if (!isGitHubRepo(repoInfo)) {
      throw new Error(
        `GitHub Repo Settings strategy requires GitHub repositories. Got: ${repoInfo.type}`
      );
    }
  }

  private async ghApi(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    endpoint: string,
    payload?: unknown,
    options?: RepoSettingsStrategyOptions
  ): Promise<string> {
    const args: string[] = ["gh", "api"];

    if (method !== "GET") {
      args.push("-X", method);
    }

    if (options?.host && options.host !== "github.com") {
      args.push("--hostname", escapeShellArg(options.host));
    }

    args.push(escapeShellArg(endpoint));

    const baseCommand = args.join(" ");

    const tokenPrefix = options?.token
      ? `GH_TOKEN=${escapeShellArg(options.token)} `
      : "";

    if (
      payload &&
      (method === "POST" || method === "PUT" || method === "PATCH")
    ) {
      const payloadJson = JSON.stringify(payload);
      const command = `echo ${escapeShellArg(payloadJson)} | ${tokenPrefix}${baseCommand} --input -`;
      return await this.executor.exec(command, process.cwd());
    }

    const command = `${tokenPrefix}${baseCommand}`;
    return await this.executor.exec(command, process.cwd());
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testNamePattern="GitHubRepoSettingsStrategy"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/strategies/github-repo-settings-strategy.ts test/unit/strategies/github-repo-settings-strategy.test.ts
git commit -m "feat(strategy): add GitHubRepoSettingsStrategy implementation"
```

---

## Task 8: Create Repo Settings Diff Module

**Files:**

- Create: `src/repo-settings-diff.ts`
- Create: `test/unit/repo-settings-diff.test.ts`

**Step 1: Write the failing test**

Create `test/unit/repo-settings-diff.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { diffRepoSettings } from "../../src/repo-settings-diff.js";
import type { GitHubRepoSettings } from "../../src/config.js";
import type { CurrentRepoSettings } from "../../src/strategies/repo-settings-strategy.js";

describe("diffRepoSettings", () => {
  it("should detect changed boolean property", () => {
    const current: CurrentRepoSettings = { has_wiki: true };
    const desired: GitHubRepoSettings = { hasWiki: false };

    const changes = diffRepoSettings(current, desired);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      property: "hasWiki",
      action: "change",
      oldValue: true,
      newValue: false,
    });
  });

  it("should detect added property", () => {
    const current: CurrentRepoSettings = {};
    const desired: GitHubRepoSettings = { allowAutoMerge: true };

    const changes = diffRepoSettings(current, desired);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      property: "allowAutoMerge",
      action: "add",
      newValue: true,
    });
  });

  it("should return empty array for no changes", () => {
    const current: CurrentRepoSettings = { has_wiki: true };
    const desired: GitHubRepoSettings = { hasWiki: true };

    const changes = diffRepoSettings(current, desired);

    expect(changes).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testNamePattern="diffRepoSettings"`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `src/repo-settings-diff.ts`:

```typescript
import type { GitHubRepoSettings } from "./config.js";
import type { CurrentRepoSettings } from "./strategies/repo-settings-strategy.js";

export type RepoSettingsAction = "add" | "change" | "unchanged";

export interface RepoSettingsChange {
  property: keyof GitHubRepoSettings;
  action: RepoSettingsAction;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Maps config property names (camelCase) to GitHub API property names (snake_case).
 */
const PROPERTY_MAPPING: Record<keyof GitHubRepoSettings, string> = {
  hasIssues: "has_issues",
  hasProjects: "has_projects",
  hasWiki: "has_wiki",
  hasDiscussions: "has_discussions",
  isTemplate: "is_template",
  allowForking: "allow_forking",
  visibility: "visibility",
  archived: "archived",
  allowSquashMerge: "allow_squash_merge",
  allowMergeCommit: "allow_merge_commit",
  allowRebaseMerge: "allow_rebase_merge",
  allowAutoMerge: "allow_auto_merge",
  deleteBranchOnMerge: "delete_branch_on_merge",
  allowUpdateBranch: "allow_update_branch",
  squashMergeCommitTitle: "squash_merge_commit_title",
  squashMergeCommitMessage: "squash_merge_commit_message",
  mergeCommitTitle: "merge_commit_title",
  mergeCommitMessage: "merge_commit_message",
  vulnerabilityAlerts: "_vulnerability_alerts",
  automatedSecurityFixes: "_automated_security_fixes",
  secretScanning: "_secret_scanning",
  secretScanningPushProtection: "_secret_scanning_push_protection",
  privateVulnerabilityReporting: "_private_vulnerability_reporting",
};

/**
 * Gets the current value for a property from GitHub API response.
 */
function getCurrentValue(
  current: CurrentRepoSettings,
  property: keyof GitHubRepoSettings
): unknown {
  const apiKey = PROPERTY_MAPPING[property];

  // Handle security_and_analysis nested properties
  if (apiKey === "_secret_scanning") {
    return current.security_and_analysis?.secret_scanning?.status === "enabled";
  }
  if (apiKey === "_secret_scanning_push_protection") {
    return (
      current.security_and_analysis?.secret_scanning_push_protection?.status ===
      "enabled"
    );
  }

  // These require separate API calls to check, return undefined
  if (apiKey.startsWith("_")) {
    return undefined;
  }

  return (current as Record<string, unknown>)[apiKey];
}

/**
 * Compares current repository settings with desired settings.
 * Only compares properties that are explicitly set in desired.
 */
export function diffRepoSettings(
  current: CurrentRepoSettings,
  desired: GitHubRepoSettings
): RepoSettingsChange[] {
  const changes: RepoSettingsChange[] = [];

  for (const [key, desiredValue] of Object.entries(desired)) {
    if (desiredValue === undefined) continue;

    const property = key as keyof GitHubRepoSettings;
    const currentValue = getCurrentValue(current, property);

    if (currentValue === undefined) {
      // Property not currently set or unknown
      changes.push({
        property,
        action: "add",
        newValue: desiredValue,
      });
    } else if (currentValue !== desiredValue) {
      changes.push({
        property,
        action: "change",
        oldValue: currentValue,
        newValue: desiredValue,
      });
    }
    // unchanged properties are not included
  }

  return changes;
}

/**
 * Checks if there are any changes to apply.
 */
export function hasChanges(changes: RepoSettingsChange[]): boolean {
  return changes.some((c) => c.action !== "unchanged");
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testNamePattern="diffRepoSettings"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/repo-settings-diff.ts test/unit/repo-settings-diff.test.ts
git commit -m "feat(diff): add repo settings diff algorithm"
```

---

## Task 9: Create Repo Settings Plan Formatter

**Files:**

- Create: `src/repo-settings-plan-formatter.ts`
- Create: `test/unit/repo-settings-plan-formatter.test.ts`

**Step 1: Write the failing test**

Create `test/unit/repo-settings-plan-formatter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatRepoSettingsPlan } from "../../src/repo-settings-plan-formatter.js";
import type { RepoSettingsChange } from "../../src/repo-settings-diff.js";

describe("formatRepoSettingsPlan", () => {
  it("should format changed property", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "hasWiki",
        action: "change",
        oldValue: true,
        newValue: false,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    expect(result.lines.some((l) => l.includes("hasWiki"))).toBe(true);
    expect(
      result.lines.some((l) => l.includes("true") && l.includes("false"))
    ).toBe(true);
    expect(result.changes).toBe(1);
    expect(result.adds).toBe(0);
  });

  it("should format added property", () => {
    const changes: RepoSettingsChange[] = [
      { property: "allowAutoMerge", action: "add", newValue: true },
    ];

    const result = formatRepoSettingsPlan(changes);

    expect(result.lines.some((l) => l.includes("allowAutoMerge"))).toBe(true);
    expect(result.adds).toBe(1);
  });

  it("should return empty result for no changes", () => {
    const result = formatRepoSettingsPlan([]);

    expect(result.lines).toHaveLength(0);
    expect(result.changes).toBe(0);
    expect(result.adds).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testNamePattern="formatRepoSettingsPlan"`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `src/repo-settings-plan-formatter.ts`:

```typescript
import chalk from "chalk";
import type { RepoSettingsChange } from "./repo-settings-diff.js";

export interface RepoSettingsPlanResult {
  lines: string[];
  adds: number;
  changes: number;
  warnings: string[];
}

/**
 * Format a value for display.
 */
function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "boolean") return val ? "true" : "false";
  return String(val);
}

/**
 * Get warning message for a property change.
 */
function getWarning(change: RepoSettingsChange): string | undefined {
  if (change.property === "visibility") {
    return `visibility change (${change.oldValue} → ${change.newValue}) may expose or hide repository`;
  }
  if (change.property === "archived" && change.newValue === true) {
    return "archiving makes repository read-only";
  }
  if (
    (change.property === "hasIssues" ||
      change.property === "hasWiki" ||
      change.property === "hasProjects") &&
    change.newValue === false
  ) {
    return `disabling ${change.property} may hide existing content`;
  }
  return undefined;
}

/**
 * Formats repo settings changes as Terraform-style plan output.
 */
export function formatRepoSettingsPlan(
  changes: RepoSettingsChange[]
): RepoSettingsPlanResult {
  const lines: string[] = [];
  const warnings: string[] = [];
  let adds = 0;
  let changesCount = 0;

  if (changes.length === 0) {
    return { lines, adds, changes: 0, warnings };
  }

  for (const change of changes) {
    const warning = getWarning(change);
    if (warning) {
      warnings.push(warning);
    }

    if (change.action === "add") {
      lines.push(
        chalk.green(`    + ${change.property}: ${formatValue(change.newValue)}`)
      );
      adds++;
    } else if (change.action === "change") {
      lines.push(
        chalk.yellow(
          `    ~ ${change.property}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`
        )
      );
      changesCount++;
    }
  }

  return { lines, adds, changes: changesCount, warnings };
}

/**
 * Formats warnings for display.
 */
export function formatWarnings(warnings: string[]): string[] {
  return warnings.map((w) => chalk.yellow(`  ⚠️  Warning: ${w}`));
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testNamePattern="formatRepoSettingsPlan"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/repo-settings-plan-formatter.ts test/unit/repo-settings-plan-formatter.test.ts
git commit -m "feat(formatter): add repo settings plan formatter"
```

---

## Task 10: Create Repo Settings Processor

**Files:**

- Create: `src/repo-settings-processor.ts`
- Create: `test/unit/repo-settings-processor.test.ts`

**Step 1: Write the failing test**

Create `test/unit/repo-settings-processor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RepoSettingsProcessor } from "../../src/repo-settings-processor.js";
import type { GitHubRepoInfo } from "../../src/repo-detector.js";
import type { RepoConfig } from "../../src/config.js";

describe("RepoSettingsProcessor", () => {
  const mockStrategy = {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    setVulnerabilityAlerts: vi.fn(),
    setAutomatedSecurityFixes: vi.fn(),
  };

  const githubRepo: GitHubRepoInfo = {
    type: "github",
    git: "https://github.com/test-org/test-repo.git",
    host: "github.com",
    owner: "test-org",
    repo: "test-repo",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should skip non-GitHub repos", async () => {
    const processor = new RepoSettingsProcessor(mockStrategy);
    const adoRepo = {
      type: "azure-devops" as const,
      git: "https://dev.azure.com/org/project/_git/repo",
      host: "dev.azure.com",
      owner: "org",
      organization: "org",
      project: "project",
      repo: "repo",
    };

    const result = await processor.process(
      { git: adoRepo.git, files: [], settings: { repo: { hasWiki: true } } },
      adoRepo,
      { dryRun: false }
    );

    expect(result.skipped).toBe(true);
    expect(result.message).toContain("not a GitHub repository");
  });

  it("should detect and report changes in dry-run mode", async () => {
    mockStrategy.getSettings.mockResolvedValue({ has_wiki: true });

    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.git,
      files: [],
      settings: { repo: { hasWiki: false } },
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.changes?.changes).toBe(1);
    expect(mockStrategy.updateSettings).not.toHaveBeenCalled();
  });

  it("should apply changes when not in dry-run mode", async () => {
    mockStrategy.getSettings.mockResolvedValue({ has_wiki: true });

    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.git,
      files: [],
      settings: { repo: { hasWiki: false } },
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(mockStrategy.updateSettings).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testNamePattern="RepoSettingsProcessor"`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `src/repo-settings-processor.ts`:

```typescript
import type { RepoConfig, GitHubRepoSettings } from "./config.js";
import type { RepoInfo, GitHubRepoInfo } from "./repo-detector.js";
import { isGitHubRepo, getRepoDisplayName } from "./repo-detector.js";
import { GitHubRepoSettingsStrategy } from "./strategies/github-repo-settings-strategy.js";
import type { IRepoSettingsStrategy } from "./strategies/repo-settings-strategy.js";
import { diffRepoSettings, hasChanges } from "./repo-settings-diff.js";
import {
  formatRepoSettingsPlan,
  RepoSettingsPlanResult,
} from "./repo-settings-plan-formatter.js";

export interface IRepoSettingsProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: RepoSettingsProcessorOptions
  ): Promise<RepoSettingsProcessorResult>;
}

export interface RepoSettingsProcessorOptions {
  dryRun?: boolean;
  token?: string;
}

export interface RepoSettingsProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  skipped?: boolean;
  dryRun?: boolean;
  changes?: {
    adds: number;
    changes: number;
  };
  warnings?: string[];
  planOutput?: RepoSettingsPlanResult;
}

export class RepoSettingsProcessor implements IRepoSettingsProcessor {
  private readonly strategy: IRepoSettingsStrategy;

  constructor(strategy?: IRepoSettingsStrategy) {
    this.strategy = strategy ?? new GitHubRepoSettingsStrategy();
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: RepoSettingsProcessorOptions
  ): Promise<RepoSettingsProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { dryRun, token } = options;

    // Check if this is a GitHub repo
    if (!isGitHubRepo(repoInfo)) {
      return {
        success: true,
        repoName,
        message: `Skipped: ${repoName} is not a GitHub repository`,
        skipped: true,
      };
    }

    const githubRepo = repoInfo as GitHubRepoInfo;
    const desiredSettings = repoConfig.settings?.repo;

    // If no repo settings configured, skip
    if (!desiredSettings || Object.keys(desiredSettings).length === 0) {
      return {
        success: true,
        repoName,
        message: "No repo settings configured",
        skipped: true,
      };
    }

    try {
      const strategyOptions = { token, host: githubRepo.host };

      // Fetch current settings
      const currentSettings = await this.strategy.getSettings(
        githubRepo,
        strategyOptions
      );

      // Compute diff
      const changes = diffRepoSettings(currentSettings, desiredSettings);

      if (!hasChanges(changes)) {
        return {
          success: true,
          repoName,
          message: "No changes needed",
          changes: { adds: 0, changes: 0 },
        };
      }

      // Format plan output
      const planOutput = formatRepoSettingsPlan(changes);

      // Dry run mode - report planned changes without applying
      if (dryRun) {
        return {
          success: true,
          repoName,
          message: `[DRY RUN] ${planOutput.adds} to add, ${planOutput.changes} to change`,
          dryRun: true,
          changes: { adds: planOutput.adds, changes: planOutput.changes },
          warnings: planOutput.warnings,
          planOutput,
        };
      }

      // Apply changes
      await this.applyChanges(githubRepo, desiredSettings, strategyOptions);

      return {
        success: true,
        repoName,
        message: `Applied: ${planOutput.adds} added, ${planOutput.changes} changed`,
        changes: { adds: planOutput.adds, changes: planOutput.changes },
        warnings: planOutput.warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        repoName,
        message: `Failed: ${message}`,
      };
    }
  }

  private async applyChanges(
    repoInfo: GitHubRepoInfo,
    settings: GitHubRepoSettings,
    options: { token?: string; host?: string }
  ): Promise<void> {
    // Extract settings that need separate API calls
    const { vulnerabilityAlerts, automatedSecurityFixes, ...mainSettings } =
      settings;

    // Update main settings via PATCH /repos
    if (Object.keys(mainSettings).length > 0) {
      await this.strategy.updateSettings(repoInfo, mainSettings, options);
    }

    // Handle vulnerability alerts (separate endpoint)
    if (vulnerabilityAlerts !== undefined) {
      await this.strategy.setVulnerabilityAlerts(
        repoInfo,
        vulnerabilityAlerts,
        options
      );
    }

    // Handle automated security fixes (separate endpoint)
    if (automatedSecurityFixes !== undefined) {
      await this.strategy.setAutomatedSecurityFixes(
        repoInfo,
        automatedSecurityFixes,
        options
      );
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testNamePattern="RepoSettingsProcessor"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/repo-settings-processor.ts test/unit/repo-settings-processor.test.ts
git commit -m "feat(processor): add RepoSettingsProcessor"
```

---

## Task 11: Integrate Repo Settings into runSettings

**Files:**

- Modify: `src/index.ts`

**Step 1: Add imports and factory**

Add at top of file with other imports:

```typescript
import {
  RepoSettingsProcessor,
  IRepoSettingsProcessor,
  RepoSettingsProcessorResult,
} from "./repo-settings-processor.js";
```

Add factory type and default after existing factories:

```typescript
export type RepoSettingsProcessorFactory = () => IRepoSettingsProcessor;

export const defaultRepoSettingsProcessorFactory: RepoSettingsProcessorFactory =
  () => new RepoSettingsProcessor();
```

**Step 2: Update runSettings function signature**

Change the signature to accept the new factory:

```typescript
export async function runSettings(
  options: SettingsOptions,
  rulesetProcessorFactory: RulesetProcessorFactory = defaultRulesetProcessorFactory,
  repoProcessorFactory: ProcessorFactory = defaultProcessorFactory,
  repoSettingsProcessorFactory: RepoSettingsProcessorFactory = defaultRepoSettingsProcessorFactory
): Promise<void> {
```

**Step 3: Add repo settings processing after rulesets**

After the rulesets processing loop, add:

```typescript
// Process repo settings
const repoSettingsProcessor = repoSettingsProcessorFactory();
const reposWithRepoSettings = config.repos.filter(
  (r) => r.settings?.repo && Object.keys(r.settings.repo).length > 0
);

if (reposWithRepoSettings.length > 0) {
  console.log(
    `\nProcessing repo settings for ${reposWithRepoSettings.length} repositories\n`
  );

  for (let i = 0; i < reposWithRepoSettings.length; i++) {
    const repoConfig = reposWithRepoSettings[i];
    let repoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });
    } catch (error) {
      console.error(`Failed to parse ${repoConfig.git}: ${error}`);
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);

    try {
      const result = await repoSettingsProcessor.process(repoConfig, repoInfo, {
        dryRun: options.dryRun,
      });

      if (result.planOutput && result.planOutput.lines.length > 0) {
        console.log(`\n  ${chalk.bold(repoName)}:`);
        console.log("  Repo Settings:");
        for (const line of result.planOutput.lines) {
          console.log(line);
        }
        if (result.warnings && result.warnings.length > 0) {
          for (const warning of result.warnings) {
            console.log(chalk.yellow(`  ⚠️  Warning: ${warning}`));
          }
        }
      }

      if (result.skipped) {
        // Silent skip
      } else if (result.success) {
        console.log(chalk.green(`  ✓ ${repoName}: ${result.message}`));
      } else {
        console.log(chalk.red(`  ✗ ${repoName}: ${result.message}`));
      }
    } catch (error) {
      console.error(`  ✗ ${repoName}: ${error}`);
    }
  }
}
```

**Step 4: Run tests**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(cli): integrate repo settings processing into runSettings"
```

---

## Task 12: Update JSON Schema

**Files:**

- Modify: `config-schema.json`

**Step 1: Add repo settings schema**

Find the `settings` definition in the schema and add `repo` property alongside `rulesets`. The schema change is large - add all 23 properties with their types and enums.

**Step 2: Commit**

```bash
git add config-schema.json
git commit -m "chore(schema): add repo settings to JSON schema"
```

---

## Task 13: Create Documentation

**Files:**

- Create: `docs/configuration/repo-settings.md`

**Step 1: Create documentation**

Create comprehensive documentation covering all settings, inheritance, and warnings.

**Step 2: Commit**

```bash
git add docs/configuration/repo-settings.md
git commit -m "docs: add repository settings documentation"
```

---

## Task 14: Final Verification

**Step 1: Run all tests**

```bash
npm test
```

**Step 2: Run linting**

```bash
./lint.sh
```

**Step 3: Build**

```bash
npm run build
```

**Step 4: Manual test with dry-run**

```bash
node dist/index.js settings --config test-config.yaml --dry-run
```

---

## Summary

15 tasks implementing GitHub repo settings:

| Task | Component  | Description                                  |
| ---- | ---------- | -------------------------------------------- |
| 1-2  | Types      | GitHubRepoSettings type, update RepoSettings |
| 3-4  | Validation | validateRepoSettings, hasActionableSettings  |
| 5    | Normalizer | mergeSettings with repo property             |
| 6-7  | Strategy   | Interface and GitHub implementation          |
| 8    | Diff       | diffRepoSettings algorithm                   |
| 9    | Formatter  | Plan output with warnings                    |
| 10   | Processor  | RepoSettingsProcessor                        |
| 11   | CLI        | runSettings integration                      |
| 12   | Schema     | JSON schema update                           |
| 13   | Docs       | Documentation                                |
| 14   | Verify     | Final testing                                |

Each task follows TDD: failing test → implement → verify → commit.
