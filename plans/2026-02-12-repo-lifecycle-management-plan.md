# Repo Lifecycle Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add declarative repo lifecycle management (create/fork/migrate) to xfg, enabling automatic creation of missing repos before sync/settings operations.

**Architecture:** Strategy pattern with `IRepoLifecycleProvider` for platform-specific operations (create/fork/receive) and `IMigrationSource` for source-side migration. `RepoLifecycleManager` orchestrates lifecycle checks before delegating to existing sync/settings workflows.

**Tech Stack:** TypeScript, Node.js, gh CLI (GitHub), az CLI (ADO), existing xfg patterns (ICommandExecutor, retry utils, repo detector)

**Design Document:** See `plans/2026-02-12-repo-lifecycle-management-design.md`

---

## Task 1: Add Config Schema Types

**Files:**

- Modify: `src/config/types.ts` (find `RawRepoConfig` and `RepoConfig` interfaces)
- Test: `test/unit/config-validator.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/config-validator.test.ts`:

```typescript
describe("validateRawConfig - lifecycle fields", () => {
  test("accepts upstream field on repo", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/forked-tool.git",
          upstream: "git@github.com:opensource/cool-tool.git",
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts source field on repo", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/migrated-app.git",
          source: "https://dev.azure.com/org/project/_git/legacy-app",
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("rejects upstream and source together", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          upstream: "git@github.com:other/repo.git",
          source: "https://dev.azure.com/org/project/_git/repo",
        },
      ],
    };
    assert.throws(
      () => validateRawConfig(config),
      /upstream.*source.*mutually exclusive/i
    );
  });

  test("rejects invalid upstream URL", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          upstream: "not-a-valid-url",
        },
      ],
    };
    assert.throws(() => validateRawConfig(config), /upstream.*valid git URL/i);
  });

  test("rejects invalid source URL", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          source: "not-a-valid-url",
        },
      ],
    };
    assert.throws(() => validateRawConfig(config), /source.*valid git URL/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="lifecycle fields"`
Expected: FAIL - `upstream` property not recognized in type

**Step 3: Add types to config/types.ts**

In `src/config/types.ts`, find `RawRepoConfig` interface and add fields:

```typescript
// Repo configuration
// files can map to false to exclude, or an object to override
// inherit: false skips all root files
export interface RawRepoConfig {
  git: string | string[];
  files?: Record<string, RawRepoFileOverride | false> & { inherit?: boolean };
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings;
  /** Fork upstream repo if target doesn't exist */
  upstream?: string;
  /** Migrate from source repo if target doesn't exist */
  source?: string;
}
```

Also find normalized `RepoConfig` and add the same fields:

```typescript
// Normalized repo config with all files to sync
export interface RepoConfig {
  git: string;
  files: FileContent[];
  prOptions?: PRMergeOptions;
  settings?: RepoSettings;
  /** Fork upstream repo if target doesn't exist */
  upstream?: string;
  /** Migrate from source repo if target doesn't exist */
  source?: string;
}
```

**Step 4: Run test to verify types compile**

Run: `npm test -- --test-name-pattern="lifecycle fields"`
Expected: FAIL - validation not implemented yet (types pass, validation fails)

**Step 5: Commit**

```bash
git add src/config/types.ts test/unit/config-validator.test.ts
git commit -m "feat(config): add upstream and source fields to repo config types

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Add Config Validation for Lifecycle Fields

**Files:**

- Modify: `src/config/validator.ts` (find repo validation loop)
- Test: `test/unit/config-validator.test.ts`

**Step 1: Write helper function for URL validation**

Add to `src/config/validator.ts` (near top, after imports):

```typescript
/**
 * Check if a string looks like a valid git URL.
 * Supports SSH (git@host:path) and HTTPS (https://host/path) formats.
 */
function isValidGitUrl(url: string): boolean {
  // SSH format: git@hostname:path
  if (/^git@[^:]+:.+$/.test(url)) {
    return true;
  }
  // HTTPS format: https://hostname/path
  if (/^https?:\/\/[^/]+\/.+$/.test(url)) {
    return true;
  }
  return false;
}
```

**Step 2: Add validation in repo loop**

In `src/config/validator.ts`, find the repo validation loop (search for `for` loop iterating repos), and add after existing repo validation:

```typescript
// Validate lifecycle fields
if (repo.upstream !== undefined && repo.source !== undefined) {
  throw new Error(
    `Repo ${getGitDisplayName(repo.git)}: 'upstream' and 'source' are mutually exclusive. ` +
      `Use 'upstream' to fork, or 'source' to migrate, not both.`
  );
}

if (repo.upstream !== undefined) {
  if (typeof repo.upstream !== "string") {
    throw new Error(
      `Repo ${getGitDisplayName(repo.git)}: 'upstream' must be a string`
    );
  }
  if (!isValidGitUrl(repo.upstream)) {
    throw new Error(
      `Repo ${getGitDisplayName(repo.git)}: 'upstream' must be a valid git URL ` +
        `(SSH: git@host:path or HTTPS: https://host/path)`
    );
  }
}

if (repo.source !== undefined) {
  if (typeof repo.source !== "string") {
    throw new Error(
      `Repo ${getGitDisplayName(repo.git)}: 'source' must be a string`
    );
  }
  if (!isValidGitUrl(repo.source)) {
    throw new Error(
      `Repo ${getGitDisplayName(repo.git)}: 'source' must be a valid git URL ` +
        `(SSH: git@host:path or HTTPS: https://host/path)`
    );
  }
}
```

**Step 3: Run tests to verify validation works**

Run: `npm test -- --test-name-pattern="lifecycle fields"`
Expected: PASS

**Step 4: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/validator.ts
git commit -m "feat(config): add validation for upstream and source fields

- upstream and source are mutually exclusive
- Both must be valid git URLs (SSH or HTTPS format)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Add Config Normalizer Support

**Files:**

- Modify: `src/config/normalizer.ts`
- Test: `test/unit/config-normalizer.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/config-normalizer.test.ts`:

```typescript
describe("normalizeConfig - lifecycle fields", () => {
  test("preserves upstream field", () => {
    const rawConfig: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/forked-tool.git",
          upstream: "git@github.com:opensource/cool-tool.git",
        },
      ],
    };

    const config = normalizeConfig(rawConfig);

    assert.equal(
      config.repos[0].upstream,
      "git@github.com:opensource/cool-tool.git"
    );
  });

  test("preserves source field", () => {
    const rawConfig: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/migrated-app.git",
          source: "https://dev.azure.com/org/project/_git/legacy-app",
        },
      ],
    };

    const config = normalizeConfig(rawConfig);

    assert.equal(
      config.repos[0].source,
      "https://dev.azure.com/org/project/_git/legacy-app"
    );
  });

  test("expands git array with upstream on each", () => {
    const rawConfig: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: [
            "git@github.com:my-org/fork1.git",
            "git@github.com:my-org/fork2.git",
          ],
          upstream: "git@github.com:opensource/tool.git",
        },
      ],
    };

    const config = normalizeConfig(rawConfig);

    assert.equal(config.repos.length, 2);
    assert.equal(
      config.repos[0].upstream,
      "git@github.com:opensource/tool.git"
    );
    assert.equal(
      config.repos[1].upstream,
      "git@github.com:opensource/tool.git"
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="normalizeConfig - lifecycle"`
Expected: FAIL - upstream/source not preserved

**Step 3: Update normalizer**

In `src/config/normalizer.ts`, find the function that creates normalized RepoConfig objects (search for where `RepoConfig` objects are constructed). Add these fields to the object:

```typescript
// In the repo normalization logic, add these fields:
upstream: rawRepo.upstream,
source: rawRepo.source,
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="normalizeConfig - lifecycle"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/normalizer.ts test/unit/config-normalizer.test.ts
git commit -m "feat(config): preserve upstream and source in normalizer

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Create Lifecycle Types

**Files:**

- Create: `src/lifecycle/types.ts`
- Create: `src/lifecycle/index.ts`

**Step 1: Create the types file**

Create `src/lifecycle/types.ts`:

```typescript
import type { RepoInfo } from "../shared/repo-detector.js";
import type { RepoConfig } from "../config/types.js";

/**
 * Supported platforms for lifecycle operations.
 */
export type LifecyclePlatform = "github" | "azure-devops" | "gitlab";

/**
 * Result of a lifecycle operation.
 */
export interface LifecycleResult {
  /** The repo info (may be updated) */
  repoInfo: RepoInfo;
  /** What action was taken */
  action: "existed" | "created" | "forked" | "migrated";
  /** True if skipped due to dry-run */
  skipped?: boolean;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Options for lifecycle operations.
 */
export interface LifecycleOptions {
  /** Dry-run mode - don't make changes */
  dryRun: boolean;
  /** Working directory for git operations */
  workDir: string;
  /** Number of retries for network operations */
  retries?: number;
}

/**
 * Repo settings to apply when creating a new repo.
 * Subset of GitHubRepoSettings that makes sense for creation.
 */
export interface CreateRepoSettings {
  visibility?: "public" | "private" | "internal";
  description?: string;
  deleteBranchOnMerge?: boolean;
  hasIssues?: boolean;
  hasProjects?: boolean;
  hasWiki?: boolean;
}

/**
 * Provider for platform-specific lifecycle operations.
 * Implementations handle create/fork/receive for a specific platform.
 */
export interface IRepoLifecycleProvider {
  /** Platform this provider handles */
  readonly platform: LifecyclePlatform;

  /**
   * Check if a repository exists on this platform.
   * @throws Error on network/auth failures (NOT for "repo not found")
   */
  exists(repoInfo: RepoInfo): Promise<boolean>;

  /**
   * Create an empty repository.
   */
  create(repoInfo: RepoInfo, settings?: CreateRepoSettings): Promise<void>;

  /**
   * Fork from an upstream repository.
   * Optional - not all platforms support forking.
   */
  fork?(
    upstream: RepoInfo,
    target: RepoInfo,
    settings?: CreateRepoSettings
  ): Promise<void>;

  /**
   * Receive migrated content (repo already created, push content).
   */
  receiveMigration(
    repoInfo: RepoInfo,
    sourceDir: string,
    settings?: CreateRepoSettings
  ): Promise<void>;
}

/**
 * Source for migration operations.
 * Implementations handle cloning from a source platform.
 */
export interface IMigrationSource {
  /** Platform this source handles */
  readonly platform: LifecyclePlatform;

  /**
   * Clone repository with all refs for migration.
   * Uses --mirror to get all branches/tags.
   */
  cloneForMigration(repoInfo: RepoInfo, workDir: string): Promise<void>;
}

/**
 * Factory for getting providers by platform.
 */
export interface IRepoLifecycleFactory {
  /**
   * Get lifecycle provider for a platform.
   * @throws Error if platform not supported as target
   */
  getProvider(platform: LifecyclePlatform): IRepoLifecycleProvider;

  /**
   * Get migration source for a platform.
   * @throws Error if platform not supported as source
   */
  getMigrationSource(platform: LifecyclePlatform): IMigrationSource;
}

/**
 * Manager that orchestrates lifecycle operations before sync.
 */
export interface IRepoLifecycleManager {
  /**
   * Ensure repository exists, creating/forking/migrating if needed.
   * Call this before sync/settings operations.
   */
  ensureRepo(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: LifecycleOptions,
    settings?: CreateRepoSettings
  ): Promise<LifecycleResult>;
}
```

**Step 2: Create index file**

Create `src/lifecycle/index.ts`:

```typescript
export type {
  LifecyclePlatform,
  LifecycleResult,
  LifecycleOptions,
  CreateRepoSettings,
  IRepoLifecycleProvider,
  IMigrationSource,
  IRepoLifecycleFactory,
  IRepoLifecycleManager,
} from "./types.js";
```

**Step 3: Run lint to verify no errors**

Run: `./lint.sh`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lifecycle/types.ts src/lifecycle/index.ts
git commit -m "feat(lifecycle): add type definitions for repo lifecycle management

Defines interfaces for:
- IRepoLifecycleProvider (platform-specific create/fork/receive)
- IMigrationSource (platform-specific clone for migration)
- IRepoLifecycleFactory (provider factory)
- IRepoLifecycleManager (orchestration)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Implement GitHubLifecycleProvider - exists()

**Files:**

- Create: `src/lifecycle/github-lifecycle-provider.ts`
- Create: `test/unit/lifecycle/github-lifecycle-provider.test.ts`

**Step 1: Create test directory and write the failing test**

Create `test/unit/lifecycle/github-lifecycle-provider.test.ts`:

```typescript
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubLifecycleProvider } from "../../../src/lifecycle/github-lifecycle-provider.js";
import { createMockExecutor } from "../../mocks/index.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";

describe("GitHubLifecycleProvider", () => {
  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test-org/test-repo.git",
    owner: "test-org",
    repo: "test-repo",
    host: "github.com",
  };

  describe("exists()", () => {
    test("returns true when repo exists", async () => {
      const { mock: executor } = createMockExecutor({
        defaultOutput: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider(executor);
      const result = await provider.exists(mockRepoInfo);

      assert.equal(result, true);
    });

    test("returns false when repo does not exist (404)", async () => {
      const notFoundError = new Error("Could not resolve to a Repository");
      (notFoundError as Error & { stderr?: string }).stderr =
        "gh: Could not resolve to a Repository";
      const { mock: executor } = createMockExecutor({
        defaultError: notFoundError,
      });

      const provider = new GitHubLifecycleProvider(executor);
      const result = await provider.exists(mockRepoInfo);

      assert.equal(result, false);
    });

    test("throws on network/auth error (not repo-not-found)", async () => {
      const networkError = new Error("Network timeout");
      (networkError as Error & { stderr?: string }).stderr = "Network timeout";
      const { mock: executor } = createMockExecutor({
        defaultError: networkError,
      });

      const provider = new GitHubLifecycleProvider(executor);

      await assert.rejects(() => provider.exists(mockRepoInfo), /Network/);
    });

    test("uses correct gh api command", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultOutput: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider(executor);
      await provider.exists(mockRepoInfo);

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.includes("gh api"));
      assert.ok(calls[0].command.includes("repos/test-org/test-repo"));
    });

    test("handles GHE hostname", async () => {
      const gheRepoInfo: GitHubRepoInfo = {
        type: "github",
        gitUrl: "git@github.mycompany.com:test-org/test-repo.git",
        owner: "test-org",
        repo: "test-repo",
        host: "github.mycompany.com",
      };

      const { mock: executor, calls } = createMockExecutor({
        defaultOutput: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider(executor);
      await provider.exists(gheRepoInfo);

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.includes("--hostname"));
      assert.ok(calls[0].command.includes("github.mycompany.com"));
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="GitHubLifecycleProvider"`
Expected: FAIL - module not found

**Step 3: Create provider implementation**

Create `src/lifecycle/github-lifecycle-provider.ts`:

```typescript
import { escapeShellArg } from "../shared/shell-utils.js";
import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import { withRetry } from "../shared/retry-utils.js";
import {
  isGitHubRepo,
  type RepoInfo,
  type GitHubRepoInfo,
} from "../shared/repo-detector.js";
import type {
  IRepoLifecycleProvider,
  LifecyclePlatform,
  CreateRepoSettings,
} from "./types.js";

/**
 * Error messages that indicate "repo not found" vs actual errors.
 */
const REPO_NOT_FOUND_PATTERNS = [
  "Could not resolve to a Repository",
  "Not Found",
  "404",
];

/**
 * Check if an error indicates repo not found (vs network/auth error).
 */
function isRepoNotFoundError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message + ((error as Error & { stderr?: string }).stderr ?? "")
      : String(error);
  return REPO_NOT_FOUND_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Get the hostname flag for gh commands.
 * Returns "--hostname HOST" for GHE, empty string for github.com.
 */
function getHostnameFlag(repoInfo: GitHubRepoInfo): string {
  if (repoInfo.host && repoInfo.host !== "github.com") {
    return `--hostname ${escapeShellArg(repoInfo.host)}`;
  }
  return "";
}

/**
 * GitHub implementation of IRepoLifecycleProvider.
 * Uses gh CLI for all operations.
 */
export class GitHubLifecycleProvider implements IRepoLifecycleProvider {
  readonly platform: LifecyclePlatform = "github";

  constructor(
    private readonly executor: ICommandExecutor = defaultExecutor,
    private readonly retries: number = 3
  ) {}

  private assertGitHub(repoInfo: RepoInfo): asserts repoInfo is GitHubRepoInfo {
    if (!isGitHubRepo(repoInfo)) {
      throw new Error(
        `GitHubLifecycleProvider requires GitHub repo, got: ${repoInfo.type}`
      );
    }
  }

  async exists(repoInfo: RepoInfo): Promise<boolean> {
    this.assertGitHub(repoInfo);

    const hostnameFlag = getHostnameFlag(repoInfo);
    const hostnamePart = hostnameFlag ? `${hostnameFlag} ` : "";
    const command = `gh api ${hostnamePart}repos/${escapeShellArg(repoInfo.owner)}/${escapeShellArg(repoInfo.repo)}`;

    try {
      // Use cwd of current directory (doesn't matter for gh api)
      await withRetry(() => this.executor.exec(command, process.cwd()), {
        retries: this.retries,
      });
      return true;
    } catch (error) {
      // Distinguish "repo not found" from actual errors
      if (isRepoNotFoundError(error)) {
        return false;
      }
      // Re-throw network/auth errors
      throw error;
    }
  }

  async create(
    _repoInfo: RepoInfo,
    _settings?: CreateRepoSettings
  ): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async fork(
    _upstream: RepoInfo,
    _target: RepoInfo,
    _settings?: CreateRepoSettings
  ): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async receiveMigration(
    _repoInfo: RepoInfo,
    _sourceDir: string,
    _settings?: CreateRepoSettings
  ): Promise<void> {
    throw new Error("Not implemented yet");
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="GitHubLifecycleProvider"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lifecycle/github-lifecycle-provider.ts test/unit/lifecycle/github-lifecycle-provider.test.ts
git commit -m "feat(lifecycle): implement GitHubLifecycleProvider.exists()

Uses gh api to check if repo exists, supports GHE.
Distinguishes 'not found' from network/auth errors.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Implement GitHubLifecycleProvider - create()

**Files:**

- Modify: `src/lifecycle/github-lifecycle-provider.ts`
- Test: `test/unit/lifecycle/github-lifecycle-provider.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/lifecycle/github-lifecycle-provider.test.ts`:

```typescript
describe("create()", () => {
  test("creates repo with gh repo create", async () => {
    const { mock: executor, calls } = createMockExecutor({
      defaultOutput: "",
    });

    const provider = new GitHubLifecycleProvider(executor);
    await provider.create(mockRepoInfo);

    assert.equal(calls.length, 1);
    assert.ok(calls[0].command.includes("gh repo create"));
    assert.ok(calls[0].command.includes("test-org/test-repo"));
  });

  test("applies visibility setting - private", async () => {
    const { mock: executor, calls } = createMockExecutor({
      defaultOutput: "",
    });

    const provider = new GitHubLifecycleProvider(executor);
    await provider.create(mockRepoInfo, { visibility: "private" });

    assert.ok(calls[0].command.includes("--private"));
  });

  test("applies visibility setting - internal", async () => {
    const { mock: executor, calls } = createMockExecutor({
      defaultOutput: "",
    });

    const provider = new GitHubLifecycleProvider(executor);
    await provider.create(mockRepoInfo, { visibility: "internal" });

    assert.ok(calls[0].command.includes("--internal"));
  });

  test("defaults to public visibility", async () => {
    const { mock: executor, calls } = createMockExecutor({
      defaultOutput: "",
    });

    const provider = new GitHubLifecycleProvider(executor);
    await provider.create(mockRepoInfo);

    assert.ok(calls[0].command.includes("--public"));
  });

  test("applies description setting", async () => {
    const { mock: executor, calls } = createMockExecutor({
      defaultOutput: "",
    });

    const provider = new GitHubLifecycleProvider(executor);
    await provider.create(mockRepoInfo, { description: "Test repo" });

    assert.ok(calls[0].command.includes("--description"));
    assert.ok(calls[0].command.includes("Test repo"));
  });

  test("throws on failure", async () => {
    const { mock: executor } = createMockExecutor({
      defaultError: new Error("Permission denied"),
    });

    const provider = new GitHubLifecycleProvider(executor);

    await assert.rejects(
      () => provider.create(mockRepoInfo),
      /Permission denied/
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="create\\(\\)"`
Expected: FAIL - "Not implemented yet"

**Step 3: Implement create()**

Update `src/lifecycle/github-lifecycle-provider.ts`, replace the create stub:

```typescript
async create(
  repoInfo: RepoInfo,
  settings?: CreateRepoSettings
): Promise<void> {
  this.assertGitHub(repoInfo);

  const parts: string[] = [
    "gh repo create",
    escapeShellArg(`${repoInfo.owner}/${repoInfo.repo}`),
  ];

  // Visibility flag
  if (settings?.visibility === "private") {
    parts.push("--private");
  } else if (settings?.visibility === "internal") {
    parts.push("--internal");
  } else {
    parts.push("--public");
  }

  // Description
  if (settings?.description) {
    parts.push("--description", escapeShellArg(settings.description));
  }

  // Disable features if specified
  if (settings?.hasIssues === false) {
    parts.push("--disable-issues");
  }
  if (settings?.hasWiki === false) {
    parts.push("--disable-wiki");
  }

  const command = parts.join(" ");

  await withRetry(() => this.executor.exec(command, process.cwd()), {
    retries: this.retries,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="create\\(\\)"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lifecycle/github-lifecycle-provider.ts test/unit/lifecycle/github-lifecycle-provider.test.ts
git commit -m "feat(lifecycle): implement GitHubLifecycleProvider.create()

Creates repo via gh repo create with visibility and description.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Implement GitHubLifecycleProvider - fork()

**Files:**

- Modify: `src/lifecycle/github-lifecycle-provider.ts`
- Test: `test/unit/lifecycle/github-lifecycle-provider.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/lifecycle/github-lifecycle-provider.test.ts`:

```typescript
describe("fork()", () => {
  const upstreamRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:opensource/cool-tool.git",
    owner: "opensource",
    repo: "cool-tool",
    host: "github.com",
  };

  test("forks repo with gh repo fork", async () => {
    const { mock: executor, calls } = createMockExecutor({
      defaultOutput: "",
    });

    const provider = new GitHubLifecycleProvider(executor);
    await provider.fork!(upstreamRepoInfo, mockRepoInfo);

    assert.equal(calls.length, 1);
    assert.ok(calls[0].command.includes("gh repo fork"));
    assert.ok(calls[0].command.includes("opensource/cool-tool"));
    assert.ok(calls[0].command.includes("--org"));
    assert.ok(calls[0].command.includes("test-org"));
    assert.ok(calls[0].command.includes("--fork-name"));
    assert.ok(calls[0].command.includes("test-repo"));
  });

  test("includes --clone=false flag", async () => {
    const { mock: executor, calls } = createMockExecutor({
      defaultOutput: "",
    });

    const provider = new GitHubLifecycleProvider(executor);
    await provider.fork!(upstreamRepoInfo, mockRepoInfo);

    assert.ok(calls[0].command.includes("--clone=false"));
  });

  test("throws on failure", async () => {
    const { mock: executor } = createMockExecutor({
      defaultError: new Error("Cannot fork private repo"),
    });

    const provider = new GitHubLifecycleProvider(executor);

    await assert.rejects(
      () => provider.fork!(upstreamRepoInfo, mockRepoInfo),
      /Cannot fork private repo/
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="fork\\(\\)"`
Expected: FAIL - "Not implemented yet"

**Step 3: Implement fork()**

Update `src/lifecycle/github-lifecycle-provider.ts`, replace the fork stub:

```typescript
async fork(
  upstream: RepoInfo,
  target: RepoInfo,
  _settings?: CreateRepoSettings
): Promise<void> {
  this.assertGitHub(upstream);
  this.assertGitHub(target);

  // gh repo fork <upstream> --org <target-org> --fork-name <name> --clone=false
  const command = [
    "gh repo fork",
    escapeShellArg(`${upstream.owner}/${upstream.repo}`),
    "--org",
    escapeShellArg(target.owner),
    "--fork-name",
    escapeShellArg(target.repo),
    "--clone=false",
  ].join(" ");

  await withRetry(() => this.executor.exec(command, process.cwd()), {
    retries: this.retries,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="fork\\(\\)"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lifecycle/github-lifecycle-provider.ts test/unit/lifecycle/github-lifecycle-provider.test.ts
git commit -m "feat(lifecycle): implement GitHubLifecycleProvider.fork()

Forks repo via gh repo fork with --org and --fork-name.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Implement GitHubLifecycleProvider - receiveMigration()

**Files:**

- Modify: `src/lifecycle/github-lifecycle-provider.ts`
- Test: `test/unit/lifecycle/github-lifecycle-provider.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/lifecycle/github-lifecycle-provider.test.ts`:

```typescript
describe("receiveMigration()", () => {
  test("creates repo then pushes mirror", async () => {
    const { mock: executor, calls } = createMockExecutor({
      defaultOutput: "",
    });

    const provider = new GitHubLifecycleProvider(executor);
    await provider.receiveMigration(mockRepoInfo, "/tmp/source-mirror");

    // Should create repo first, then push mirror
    assert.ok(calls.length >= 2);
    assert.ok(calls[0].command.includes("gh repo create"));
    assert.ok(calls[1].command.includes("git push --mirror"));
  });

  test("pushes to correct git URL", async () => {
    const { mock: executor, calls } = createMockExecutor({
      defaultOutput: "",
    });

    const provider = new GitHubLifecycleProvider(executor);
    await provider.receiveMigration(mockRepoInfo, "/tmp/source-mirror");

    const pushCall = calls.find((c) => c.command.includes("git push"));
    assert.ok(pushCall);
    assert.ok(pushCall.command.includes(mockRepoInfo.gitUrl));
  });

  test("uses sourceDir as cwd for push", async () => {
    const { mock: executor, calls } = createMockExecutor({
      defaultOutput: "",
    });

    const provider = new GitHubLifecycleProvider(executor);
    await provider.receiveMigration(mockRepoInfo, "/tmp/source-mirror");

    const pushCall = calls.find((c) => c.command.includes("git push"));
    assert.ok(pushCall);
    assert.equal(pushCall.cwd, "/tmp/source-mirror");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="receiveMigration"`
Expected: FAIL - "Not implemented yet"

**Step 3: Implement receiveMigration()**

Update `src/lifecycle/github-lifecycle-provider.ts`, replace the receiveMigration stub:

```typescript
async receiveMigration(
  repoInfo: RepoInfo,
  sourceDir: string,
  settings?: CreateRepoSettings
): Promise<void> {
  this.assertGitHub(repoInfo);

  // Step 1: Create the target repo
  await this.create(repoInfo, settings);

  // Step 2: Push mirror from source directory
  const pushCommand = `git push --mirror ${escapeShellArg(repoInfo.gitUrl)}`;

  await withRetry(() => this.executor.exec(pushCommand, sourceDir), {
    retries: this.retries,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="receiveMigration"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lifecycle/github-lifecycle-provider.ts test/unit/lifecycle/github-lifecycle-provider.test.ts
git commit -m "feat(lifecycle): implement GitHubLifecycleProvider.receiveMigration()

Creates repo then pushes mirror content from source directory.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Implement AdoMigrationSource

**Files:**

- Create: `src/lifecycle/ado-migration-source.ts`
- Create: `test/unit/lifecycle/ado-migration-source.test.ts`

**Step 1: Write the failing test**

Create `test/unit/lifecycle/ado-migration-source.test.ts`:

```typescript
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { AdoMigrationSource } from "../../../src/lifecycle/ado-migration-source.js";
import { createMockExecutor } from "../../mocks/index.js";
import type { AzureDevOpsRepoInfo } from "../../../src/shared/repo-detector.js";

describe("AdoMigrationSource", () => {
  const mockRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "https://dev.azure.com/myorg/myproject/_git/myrepo",
    owner: "myorg",
    repo: "myrepo",
    organization: "myorg",
    project: "myproject",
  };

  describe("cloneForMigration()", () => {
    test("clones with --mirror flag", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultOutput: "",
      });

      const source = new AdoMigrationSource(executor);
      await source.cloneForMigration(mockRepoInfo, "/tmp/migration");

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.includes("git clone --mirror"));
    });

    test("clones to specified directory", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultOutput: "",
      });

      const source = new AdoMigrationSource(executor);
      await source.cloneForMigration(mockRepoInfo, "/tmp/migration");

      assert.ok(calls[0].command.includes("/tmp/migration"));
    });

    test("uses repo gitUrl", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultOutput: "",
      });

      const source = new AdoMigrationSource(executor);
      await source.cloneForMigration(mockRepoInfo, "/tmp/migration");

      assert.ok(calls[0].command.includes(mockRepoInfo.gitUrl));
    });

    test("throws on clone failure", async () => {
      const { mock: executor } = createMockExecutor({
        defaultError: new Error("Authentication failed"),
      });

      const source = new AdoMigrationSource(executor);

      await assert.rejects(
        () => source.cloneForMigration(mockRepoInfo, "/tmp/migration"),
        /Authentication failed/
      );
    });

    test("rejects non-ADO repo", async () => {
      const { mock: executor } = createMockExecutor({
        defaultOutput: "",
      });

      const githubRepo = {
        type: "github" as const,
        gitUrl: "git@github.com:test/repo.git",
        owner: "test",
        repo: "repo",
        host: "github.com",
      };

      const source = new AdoMigrationSource(executor);

      await assert.rejects(
        () => source.cloneForMigration(githubRepo, "/tmp/migration"),
        /requires Azure DevOps repo/
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="AdoMigrationSource"`
Expected: FAIL - module not found

**Step 3: Create implementation**

Create `src/lifecycle/ado-migration-source.ts`:

```typescript
import { escapeShellArg } from "../shared/shell-utils.js";
import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import { withRetry } from "../shared/retry-utils.js";
import {
  isAzureDevOpsRepo,
  type RepoInfo,
  type AzureDevOpsRepoInfo,
} from "../shared/repo-detector.js";
import type { IMigrationSource, LifecyclePlatform } from "./types.js";

/**
 * Azure DevOps implementation of IMigrationSource.
 * Uses git clone --mirror to get all refs for migration.
 */
export class AdoMigrationSource implements IMigrationSource {
  readonly platform: LifecyclePlatform = "azure-devops";

  constructor(
    private readonly executor: ICommandExecutor = defaultExecutor,
    private readonly retries: number = 3
  ) {}

  private assertAdo(
    repoInfo: RepoInfo
  ): asserts repoInfo is AzureDevOpsRepoInfo {
    if (!isAzureDevOpsRepo(repoInfo)) {
      throw new Error(
        `AdoMigrationSource requires Azure DevOps repo, got: ${repoInfo.type}`
      );
    }
  }

  async cloneForMigration(repoInfo: RepoInfo, workDir: string): Promise<void> {
    this.assertAdo(repoInfo);

    // Clone with --mirror to get all branches, tags, and refs
    const command = `git clone --mirror ${escapeShellArg(repoInfo.gitUrl)} ${escapeShellArg(workDir)}`;

    await withRetry(() => this.executor.exec(command, process.cwd()), {
      retries: this.retries,
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="AdoMigrationSource"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lifecycle/ado-migration-source.ts test/unit/lifecycle/ado-migration-source.test.ts
git commit -m "feat(lifecycle): implement AdoMigrationSource

Clones ADO repos with --mirror for full migration.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Implement RepoLifecycleFactory

**Files:**

- Create: `src/lifecycle/repo-lifecycle-factory.ts`
- Create: `test/unit/lifecycle/repo-lifecycle-factory.test.ts`

**Step 1: Write the failing test**

Create `test/unit/lifecycle/repo-lifecycle-factory.test.ts`:

```typescript
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { RepoLifecycleFactory } from "../../../src/lifecycle/repo-lifecycle-factory.js";
import { GitHubLifecycleProvider } from "../../../src/lifecycle/github-lifecycle-provider.js";
import { AdoMigrationSource } from "../../../src/lifecycle/ado-migration-source.js";

describe("RepoLifecycleFactory", () => {
  describe("getProvider()", () => {
    test("returns GitHubLifecycleProvider for github", () => {
      const factory = new RepoLifecycleFactory();
      const provider = factory.getProvider("github");

      assert.ok(provider instanceof GitHubLifecycleProvider);
      assert.equal(provider.platform, "github");
    });

    test("throws for unsupported platform", () => {
      const factory = new RepoLifecycleFactory();

      assert.throws(
        () => factory.getProvider("azure-devops"),
        /not supported as target/
      );
    });

    test("caches provider instances", () => {
      const factory = new RepoLifecycleFactory();
      const provider1 = factory.getProvider("github");
      const provider2 = factory.getProvider("github");

      assert.strictEqual(provider1, provider2);
    });
  });

  describe("getMigrationSource()", () => {
    test("returns AdoMigrationSource for azure-devops", () => {
      const factory = new RepoLifecycleFactory();
      const source = factory.getMigrationSource("azure-devops");

      assert.ok(source instanceof AdoMigrationSource);
      assert.equal(source.platform, "azure-devops");
    });

    test("throws for unsupported platform", () => {
      const factory = new RepoLifecycleFactory();

      assert.throws(
        () => factory.getMigrationSource("github"),
        /not supported as migration source/
      );
    });

    test("caches source instances", () => {
      const factory = new RepoLifecycleFactory();
      const source1 = factory.getMigrationSource("azure-devops");
      const source2 = factory.getMigrationSource("azure-devops");

      assert.strictEqual(source1, source2);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="RepoLifecycleFactory"`
Expected: FAIL - module not found

**Step 3: Create implementation**

Create `src/lifecycle/repo-lifecycle-factory.ts`:

```typescript
import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import type {
  IRepoLifecycleFactory,
  IRepoLifecycleProvider,
  IMigrationSource,
  LifecyclePlatform,
} from "./types.js";
import { GitHubLifecycleProvider } from "./github-lifecycle-provider.js";
import { AdoMigrationSource } from "./ado-migration-source.js";

/**
 * Factory for creating lifecycle providers and migration sources.
 */
export class RepoLifecycleFactory implements IRepoLifecycleFactory {
  private readonly providers: Map<LifecyclePlatform, IRepoLifecycleProvider> =
    new Map();
  private readonly sources: Map<LifecyclePlatform, IMigrationSource> =
    new Map();

  constructor(
    private readonly executor: ICommandExecutor = defaultExecutor,
    private readonly retries: number = 3
  ) {}

  getProvider(platform: LifecyclePlatform): IRepoLifecycleProvider {
    // Check cache first
    const cached = this.providers.get(platform);
    if (cached) {
      return cached;
    }

    // Create provider
    let provider: IRepoLifecycleProvider;
    switch (platform) {
      case "github":
        provider = new GitHubLifecycleProvider(this.executor, this.retries);
        break;
      default:
        throw new Error(
          `Platform '${platform}' not supported as target for lifecycle operations. ` +
            `Currently supported: github`
        );
    }

    this.providers.set(platform, provider);
    return provider;
  }

  getMigrationSource(platform: LifecyclePlatform): IMigrationSource {
    // Check cache first
    const cached = this.sources.get(platform);
    if (cached) {
      return cached;
    }

    // Create source
    let source: IMigrationSource;
    switch (platform) {
      case "azure-devops":
        source = new AdoMigrationSource(this.executor, this.retries);
        break;
      default:
        throw new Error(
          `Platform '${platform}' not supported as migration source. ` +
            `Currently supported: azure-devops`
        );
    }

    this.sources.set(platform, source);
    return source;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="RepoLifecycleFactory"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lifecycle/repo-lifecycle-factory.ts test/unit/lifecycle/repo-lifecycle-factory.test.ts
git commit -m "feat(lifecycle): implement RepoLifecycleFactory

Factory for providers (github) and migration sources (azure-devops).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Implement RepoLifecycleManager

**Files:**

- Create: `src/lifecycle/repo-lifecycle-manager.ts`
- Create: `test/unit/lifecycle/repo-lifecycle-manager.test.ts`

**Step 1: Write the failing test**

Create `test/unit/lifecycle/repo-lifecycle-manager.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoLifecycleManager } from "../../../src/lifecycle/repo-lifecycle-manager.js";
import type {
  IRepoLifecycleFactory,
  IRepoLifecycleProvider,
  IMigrationSource,
} from "../../../src/lifecycle/types.js";
import type { RepoConfig } from "../../../src/config/types.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";

describe("RepoLifecycleManager", () => {
  const testDir = join(tmpdir(), `lifecycle-manager-test-${Date.now()}`);
  let workDir: string;

  const mockGitHubRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test-org/test-repo.git",
    owner: "test-org",
    repo: "test-repo",
    host: "github.com",
  };

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createMockFactory(options: {
    exists?: boolean;
    createCalled?: () => void;
    forkCalled?: () => void;
    migrateCalled?: () => void;
    cloneCalled?: () => void;
  }): IRepoLifecycleFactory {
    const provider: IRepoLifecycleProvider = {
      platform: "github",
      async exists() {
        return options.exists ?? false;
      },
      async create() {
        options.createCalled?.();
      },
      async fork() {
        options.forkCalled?.();
      },
      async receiveMigration() {
        options.migrateCalled?.();
      },
    };

    const source: IMigrationSource = {
      platform: "azure-devops",
      async cloneForMigration(_repoInfo, cloneDir) {
        // Create the directory to simulate clone
        mkdirSync(cloneDir, { recursive: true });
        options.cloneCalled?.();
      },
    };

    return {
      getProvider: () => provider,
      getMigrationSource: () => source,
    };
  }

  describe("ensureRepo()", () => {
    test("returns existed when repo exists", async () => {
      const factory = createMockFactory({ exists: true });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      assert.equal(result.action, "existed");
    });

    test("creates repo when missing and no upstream/source", async () => {
      let createCalled = false;
      const factory = createMockFactory({
        exists: false,
        createCalled: () => {
          createCalled = true;
        },
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      assert.equal(result.action, "created");
      assert.equal(createCalled, true);
    });

    test("forks when upstream present and missing", async () => {
      let forkCalled = false;
      const factory = createMockFactory({
        exists: false,
        forkCalled: () => {
          forkCalled = true;
        },
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        upstream: "git@github.com:opensource/tool.git",
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      assert.equal(result.action, "forked");
      assert.equal(forkCalled, true);
    });

    test("migrates when source present and missing", async () => {
      let migrateCalled = false;
      let cloneCalled = false;
      const factory = createMockFactory({
        exists: false,
        migrateCalled: () => {
          migrateCalled = true;
        },
        cloneCalled: () => {
          cloneCalled = true;
        },
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        source: "https://dev.azure.com/myorg/myproject/_git/myrepo",
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      assert.equal(result.action, "migrated");
      assert.equal(cloneCalled, true);
      assert.equal(migrateCalled, true);
    });

    test("cleans up migration source directory after success", async () => {
      const factory = createMockFactory({
        exists: false,
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        source: "https://dev.azure.com/myorg/myproject/_git/myrepo",
      };

      await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      // Migration source dir should be cleaned up
      const sourceDir = join(workDir, "migration-source");
      assert.equal(existsSync(sourceDir), false);
    });

    test("skips action in dry-run mode", async () => {
      let createCalled = false;
      const factory = createMockFactory({
        exists: false,
        createCalled: () => {
          createCalled = true;
        },
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: true,
        workDir,
      });

      assert.equal(result.action, "created");
      assert.equal(result.skipped, true);
      assert.equal(createCalled, false);
    });

    test("ignores upstream when repo exists", async () => {
      let forkCalled = false;
      const factory = createMockFactory({
        exists: true,
        forkCalled: () => {
          forkCalled = true;
        },
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        upstream: "git@github.com:opensource/tool.git",
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      assert.equal(result.action, "existed");
      assert.equal(forkCalled, false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="RepoLifecycleManager"`
Expected: FAIL - module not found

**Step 3: Create implementation**

Create `src/lifecycle/repo-lifecycle-manager.ts`:

```typescript
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { parseGitUrl, type RepoInfo } from "../shared/repo-detector.js";
import type { RepoConfig } from "../config/types.js";
import type {
  IRepoLifecycleManager,
  IRepoLifecycleFactory,
  LifecycleResult,
  LifecycleOptions,
  CreateRepoSettings,
} from "./types.js";
import { RepoLifecycleFactory } from "./repo-lifecycle-factory.js";

/**
 * Orchestrates repo lifecycle operations before sync.
 */
export class RepoLifecycleManager implements IRepoLifecycleManager {
  constructor(
    private readonly factory: IRepoLifecycleFactory = new RepoLifecycleFactory()
  ) {}

  async ensureRepo(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: LifecycleOptions,
    settings?: CreateRepoSettings
  ): Promise<LifecycleResult> {
    const provider = this.factory.getProvider(repoInfo.type);

    // Check if repo exists
    const exists = await provider.exists(repoInfo);

    if (exists) {
      // Repo exists - nothing to do (ignore upstream/source)
      return {
        repoInfo,
        action: "existed",
      };
    }

    // Repo doesn't exist - determine what action to take
    if (repoConfig.source) {
      // Migration mode
      return this.migrate(repoConfig, repoInfo, options, settings);
    }

    if (repoConfig.upstream) {
      // Fork mode
      return this.fork(repoConfig, repoInfo, options, settings);
    }

    // Create mode (no upstream or source)
    return this.create(repoInfo, options, settings);
  }

  private async create(
    repoInfo: RepoInfo,
    options: LifecycleOptions,
    settings?: CreateRepoSettings
  ): Promise<LifecycleResult> {
    if (options.dryRun) {
      return {
        repoInfo,
        action: "created",
        skipped: true,
      };
    }

    const provider = this.factory.getProvider(repoInfo.type);
    await provider.create(repoInfo, settings);

    return {
      repoInfo,
      action: "created",
    };
  }

  private async fork(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: LifecycleOptions,
    settings?: CreateRepoSettings
  ): Promise<LifecycleResult> {
    if (options.dryRun) {
      return {
        repoInfo,
        action: "forked",
        skipped: true,
      };
    }

    const provider = this.factory.getProvider(repoInfo.type);

    if (!provider.fork) {
      throw new Error(`Platform '${repoInfo.type}' does not support forking`);
    }

    // Parse upstream URL to get repo info
    const upstreamInfo = parseGitUrl(repoConfig.upstream!);
    await provider.fork(upstreamInfo, repoInfo, settings);

    return {
      repoInfo,
      action: "forked",
    };
  }

  private async migrate(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: LifecycleOptions,
    settings?: CreateRepoSettings
  ): Promise<LifecycleResult> {
    if (options.dryRun) {
      return {
        repoInfo,
        action: "migrated",
        skipped: true,
      };
    }

    // Parse source URL to get platform and repo info
    const sourceInfo = parseGitUrl(repoConfig.source!);
    const source = this.factory.getMigrationSource(sourceInfo.type);

    // Clone source repo to temp directory
    const sourceDir = join(options.workDir, "migration-source");

    try {
      await source.cloneForMigration(sourceInfo, sourceDir);

      // Create target and push content
      const provider = this.factory.getProvider(repoInfo.type);
      await provider.receiveMigration(repoInfo, sourceDir, settings);

      return {
        repoInfo,
        action: "migrated",
      };
    } finally {
      // Clean up migration source directory
      try {
        await rm(sourceDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="RepoLifecycleManager"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lifecycle/repo-lifecycle-manager.ts test/unit/lifecycle/repo-lifecycle-manager.test.ts
git commit -m "feat(lifecycle): implement RepoLifecycleManager

Orchestrates lifecycle operations:
- exists: skip lifecycle, proceed to sync
- create: create empty repo when no upstream/source
- fork: fork from upstream when present
- migrate: clone from source, push to target, cleanup

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Update Lifecycle Index Exports

**Files:**

- Modify: `src/lifecycle/index.ts`

**Step 1: Update index.ts**

Update `src/lifecycle/index.ts`:

```typescript
export type {
  LifecyclePlatform,
  LifecycleResult,
  LifecycleOptions,
  CreateRepoSettings,
  IRepoLifecycleProvider,
  IMigrationSource,
  IRepoLifecycleFactory,
  IRepoLifecycleManager,
} from "./types.js";

export { GitHubLifecycleProvider } from "./github-lifecycle-provider.js";
export { AdoMigrationSource } from "./ado-migration-source.js";
export { RepoLifecycleFactory } from "./repo-lifecycle-factory.js";
export { RepoLifecycleManager } from "./repo-lifecycle-manager.js";
```

**Step 2: Run lint**

Run: `./lint.sh`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lifecycle/index.ts
git commit -m "chore(lifecycle): export all lifecycle components

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 13: Integrate Lifecycle into Sync Command

**Files:**

- Modify: `src/cli/sync-command.ts`

**Step 1: Add imports**

In `src/cli/sync-command.ts`, add import near other imports:

```typescript
import {
  RepoLifecycleManager,
  type CreateRepoSettings,
} from "../lifecycle/index.js";
```

**Step 2: Create lifecycle manager instance**

Find the `runSync` function. Before the repo processing loop (the `for` loop), add:

```typescript
const lifecycleManager = new RepoLifecycleManager();
```

**Step 3: Add lifecycle check before processor.process()**

Inside the repo processing loop, find where `repoInfo` and `workDir` are defined (around lines 169-188). After `workDir` is created and BEFORE the `processor.process()` call (around line 193), add:

```typescript
// Check if repo exists, create/fork/migrate if needed
try {
  // Extract creation settings from config
  const createSettings: CreateRepoSettings | undefined = config.settings?.repo
    ? {
        visibility: config.settings.repo.visibility,
        description: config.settings.repo.description,
        hasIssues: config.settings.repo.hasIssues,
        hasWiki: config.settings.repo.hasWiki,
        hasProjects: config.settings.repo.hasProjects,
      }
    : undefined;

  const lifecycleResult = await lifecycleManager.ensureRepo(
    repoConfig,
    repoInfo,
    {
      dryRun: options.dryRun ?? false,
      workDir,
      retries: options.retries,
    },
    createSettings
  );

  if (lifecycleResult.action !== "existed") {
    const actionVerb = lifecycleResult.skipped ? "Would" : "Successfully";
    const actionMap = {
      created: "created",
      forked: "forked",
      migrated: "migrated",
    };
    logger.info(
      `${actionVerb} ${actionMap[lifecycleResult.action]} repository: ${repoName}`
    );
  }
} catch (error) {
  logger.error(
    current,
    repoName,
    `Lifecycle error: ${error instanceof Error ? error.message : String(error)}`
  );
  reportResults.push({
    repoName,
    success: false,
    fileChanges: [],
    error: error instanceof Error ? error.message : String(error),
  });
  continue;
}
```

**Step 4: Run lint and tests**

Run: `./lint.sh && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/sync-command.ts
git commit -m "feat(sync): integrate lifecycle manager into sync command

Checks repo existence before sync, creates/forks/migrates if needed.
Uses settings.repo for creation settings (visibility, description).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 14: Integrate Lifecycle into Settings Command

**Files:**

- Modify: `src/cli/settings-command.ts`

**Step 1: Add imports**

In `src/cli/settings-command.ts`, add import:

```typescript
import {
  RepoLifecycleManager,
  type CreateRepoSettings,
} from "../lifecycle/index.js";
```

**Step 2: Add lifecycle check in processRulesets**

Find the `processRulesets` function. The function has a repo loop starting around line 86.

After `repoInfo` and `repoName` are defined (around lines 89-101), and BEFORE the `isGitHubRepo` check, add:

```typescript
// Create workDir for lifecycle operations (needed earlier now)
const workDir = resolve(
  join(options.workDir ?? "./tmp", generateWorkspaceName(i))
);

// Check if repo exists, create/fork/migrate if needed
const lifecycleManager = new RepoLifecycleManager();
try {
  const createSettings: CreateRepoSettings | undefined = config.settings?.repo
    ? {
        visibility: config.settings.repo.visibility,
        description: config.settings.repo.description,
        hasIssues: config.settings.repo.hasIssues,
        hasWiki: config.settings.repo.hasWiki,
        hasProjects: config.settings.repo.hasProjects,
      }
    : undefined;

  const lifecycleResult = await lifecycleManager.ensureRepo(
    repoConfig,
    repoInfo,
    {
      dryRun: options.dryRun ?? false,
      workDir,
      retries: options.retries,
    },
    createSettings
  );

  if (lifecycleResult.action !== "existed") {
    const actionVerb = lifecycleResult.skipped ? "Would" : "Successfully";
    const actionMap = {
      created: "created",
      forked: "forked",
      migrated: "migrated",
    };
    logger.info(
      `${actionVerb} ${actionMap[lifecycleResult.action]} repository: ${repoName}`
    );
  }
} catch (error) {
  logger.error(
    i + 1,
    repoName,
    `Lifecycle error: ${error instanceof Error ? error.message : String(error)}`
  );
  results.push(buildErrorResult(repoName, error));
  collector.appendError(repoName, error);
  continue;
}
```

**Note:** Remove the duplicate `workDir` creation later in the function (around line 141) since we now create it earlier.

**Step 3: Add similar lifecycle check in processRepoSettings**

Find the `processRepoSettings` function (around line 200). Add similar lifecycle check after `repoInfo` is defined and before `processor.process()`.

**Step 4: Run lint and tests**

Run: `./lint.sh && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/settings-command.ts
git commit -m "feat(settings): integrate lifecycle manager into settings command

Checks repo existence before settings, creates/forks/migrates if needed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 15: Add Dry-Run Output Formatting

**Files:**

- Create: `src/lifecycle/lifecycle-formatter.ts`
- Create: `test/unit/lifecycle/lifecycle-formatter.test.ts`
- Modify: `src/lifecycle/index.ts`

**Step 1: Write the failing test**

Create `test/unit/lifecycle/lifecycle-formatter.test.ts`:

```typescript
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatLifecycleAction } from "../../../src/lifecycle/lifecycle-formatter.js";
import type { LifecycleResult } from "../../../src/lifecycle/types.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";

describe("formatLifecycleAction", () => {
  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:my-org/my-repo.git",
    owner: "my-org",
    repo: "my-repo",
    host: "github.com",
  };

  test("formats create action", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "created",
    };

    const lines = formatLifecycleAction(result);

    assert.ok(lines.some((l) => l.includes("CREATE")));
    assert.ok(lines.some((l) => l.includes("my-org/my-repo")));
  });

  test("formats fork action with upstream", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "forked",
    };

    const lines = formatLifecycleAction(result, {
      upstream: "github.com/opensource/tool",
    });

    assert.ok(lines.some((l) => l.includes("FORK")));
    assert.ok(lines.some((l) => l.includes("opensource/tool")));
    assert.ok(lines.some((l) => l.includes("my-org/my-repo")));
  });

  test("formats migrate action with source", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "migrated",
    };

    const lines = formatLifecycleAction(result, {
      source: "dev.azure.com/org/project/repo",
    });

    assert.ok(lines.some((l) => l.includes("MIGRATE")));
    assert.ok(lines.some((l) => l.includes("dev.azure.com")));
    assert.ok(lines.some((l) => l.includes("my-org/my-repo")));
  });

  test("includes settings details when provided", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "created",
    };

    const lines = formatLifecycleAction(result, {
      settings: {
        visibility: "private",
        description: "Test repo",
      },
    });

    assert.ok(lines.some((l) => l.includes("visibility: private")));
    assert.ok(lines.some((l) => l.includes('description: "Test repo"')));
  });

  test("returns empty for existed action", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "existed",
    };

    const lines = formatLifecycleAction(result);

    assert.equal(lines.length, 0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="formatLifecycleAction"`
Expected: FAIL - module not found

**Step 3: Create formatter**

Create `src/lifecycle/lifecycle-formatter.ts`:

```typescript
import chalk from "chalk";
import type { LifecycleResult } from "./types.js";
import { getRepoDisplayName } from "../shared/repo-detector.js";

export interface FormatOptions {
  upstream?: string;
  source?: string;
  settings?: {
    visibility?: string;
    description?: string;
  };
}

/**
 * Format lifecycle action for dry-run output.
 * Returns empty array if action is "existed" (no output needed).
 */
export function formatLifecycleAction(
  result: LifecycleResult,
  options?: FormatOptions
): string[] {
  if (result.action === "existed") {
    return [];
  }

  const lines: string[] = [];
  const repoDisplay = getRepoDisplayName(result.repoInfo);

  switch (result.action) {
    case "created":
      lines.push(chalk.green(`+ CREATE ${repoDisplay}`));
      break;

    case "forked":
      lines.push(
        chalk.green(
          `+ FORK ${options?.upstream ?? "upstream"} -> ${repoDisplay}`
        )
      );
      break;

    case "migrated":
      lines.push(
        chalk.green(
          `+ MIGRATE ${options?.source ?? "source"} -> ${repoDisplay}`
        )
      );
      break;
  }

  // Add settings details if provided
  if (options?.settings) {
    if (options.settings.visibility) {
      lines.push(`    visibility: ${options.settings.visibility}`);
    }
    if (options.settings.description) {
      lines.push(`    description: "${options.settings.description}"`);
    }
  }

  return lines;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="formatLifecycleAction"`
Expected: PASS

**Step 5: Update index exports**

Add to `src/lifecycle/index.ts`:

```typescript
export {
  formatLifecycleAction,
  type FormatOptions,
} from "./lifecycle-formatter.js";
```

**Step 6: Commit**

```bash
git add src/lifecycle/lifecycle-formatter.ts test/unit/lifecycle/lifecycle-formatter.test.ts src/lifecycle/index.ts
git commit -m "feat(lifecycle): add dry-run output formatting

Formats CREATE/FORK/MIGRATE actions with settings for CLI output.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 16: Final Integration and Testing

**Files:**

- All lifecycle files
- Manual testing with dry-run

**Step 1: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 2: Run lint**

Run: `./lint.sh`
Expected: PASS

**Step 3: Build project**

Run: `npm run build`
Expected: PASS (no TypeScript errors)

**Step 4: Manual dry-run test**

Create a test config file `/tmp/lifecycle-test.yaml`:

```yaml
id: lifecycle-test

settings:
  repo:
    visibility: private
    description: "Managed by xfg"

files:
  README.md:
    content: "# Test Repo"

repos:
  # Test create (will skip if exists, or show "Would create" in dry-run)
  - git: git@github.com:your-org/test-create.git

  # Test fork (will skip if exists)
  - git: git@github.com:your-org/test-fork.git
    upstream: git@github.com:octocat/Hello-World.git
```

Run: `npm run dev -- sync --config /tmp/lifecycle-test.yaml --dry-run`
Expected: Shows lifecycle operations in output with + CREATE or + FORK prefix

**Step 5: Verify acceptance criteria**

- [ ] All existing tests pass
- [ ] Config accepts `upstream` and `source` fields
- [ ] `upstream` and `source` are mutually exclusive (validation error if both)
- [ ] Both commands (sync, settings) trigger lifecycle operations
- [ ] Dry-run shows planned create/fork/migrate
- [ ] GitHub repos can be created, forked, receive migrations
- [ ] ADO repos can be used as migration source
- [ ] Migration source directory is cleaned up after use

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat(lifecycle): complete repo lifecycle management implementation

Summary:
- Add upstream/source fields to repo config
- Implement GitHubLifecycleProvider (create/fork/receive)
- Implement AdoMigrationSource (clone for migration)
- Implement RepoLifecycleManager orchestration
- Integrate into sync and settings commands
- Add dry-run output formatting

Closes #469

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary

This plan implements the full repo lifecycle management feature in 16 tasks:

| Task  | Component               | Purpose                                   |
| ----- | ----------------------- | ----------------------------------------- |
| 1-3   | Config                  | Add types, validation, normalizer support |
| 4     | Types                   | Define interfaces                         |
| 5-8   | GitHubLifecycleProvider | exists/create/fork/receiveMigration       |
| 9     | AdoMigrationSource      | Clone from ADO                            |
| 10    | RepoLifecycleFactory    | Factory for providers                     |
| 11    | RepoLifecycleManager    | Orchestration with cleanup                |
| 12    | Index                   | Export everything                         |
| 13-14 | Commands                | Integrate into sync/settings              |
| 15-16 | Polish                  | Formatting and final testing              |

Each task follows TDD: write failing test, implement, verify, commit.

**Key improvements in this plan:**

- Distinguishes "repo not found" from network/auth errors in exists()
- Cleans up migration source directory after use
- Specific integration points with line number references
- Explicit settings extraction from config.settings.repo
- Caches provider/source instances in factory
