# Future Improvements

This document outlines architectural improvements identified during code review. Each section provides detailed implementation instructions.

---

## 1. Strategy Pattern for PR Creators (OCP Compliance)

**Priority:** Medium
**Effort:** ~2-3 hours
**Files affected:** `src/pr-creator.ts`, `src/index.ts`

### Problem

The current `createPR()` function uses if/else branching to route between platforms:

```typescript
// src/pr-creator.ts:82-99
if (repoInfo.type === "github") {
  return await createGitHubPR({ ... });
} else {
  return await createAzureDevOpsPR({ ... });
}
```

Adding support for GitLab, Bitbucket, or other platforms requires modifying this core function, violating the Open/Closed Principle.

### Solution

Implement the Strategy Pattern with a registry of platform-specific creators.

### Implementation Steps

1. **Create the strategy interface** in `src/pr-creator.ts`:

```typescript
export interface PRCreatorStrategy {
  /**
   * Check if a PR already exists for the given branch
   * @returns PR URL if exists, null otherwise
   */
  checkExistingPR(options: {
    branchName: string;
    baseBranch: string;
    workDir: string;
    repoInfo: RepoInfo;
  }): Promise<string | null>;

  /**
   * Create a new PR
   * @returns Result with URL and status
   */
  create(options: {
    title: string;
    body: string;
    branchName: string;
    baseBranch: string;
    workDir: string;
    repoInfo: RepoInfo;
  }): Promise<PRResult>;
}
```

2. **Create separate strategy files**:
   - `src/strategies/github-pr-creator.ts`
   - `src/strategies/azure-pr-creator.ts`

3. **Extract existing logic** from `createGitHubPR()` and `createAzureDevOpsPR()` into these new classes. Each class implements the `PRCreatorStrategy` interface.

4. **Create a registry** in `src/pr-creator.ts`:

```typescript
import { GitHubPRCreator } from "./strategies/github-pr-creator.js";
import { AzureDevOpsPRCreator } from "./strategies/azure-pr-creator.js";

const strategies: Record<RepoType, PRCreatorStrategy> = {
  github: new GitHubPRCreator(),
  "azure-devops": new AzureDevOpsPRCreator(),
};

export async function createPR(options: PROptions): Promise<PRResult> {
  const strategy = strategies[options.repoInfo.type];
  if (!strategy) {
    return {
      success: false,
      message: `Unsupported platform: ${options.repoInfo.type}`,
    };
  }

  if (options.dryRun) {
    return {
      success: true,
      message: `[DRY RUN] Would create PR: "chore: sync ${options.fileName}"`,
    };
  }

  // Check for existing PR first
  const existingUrl = await strategy.checkExistingPR({ ... });
  if (existingUrl) {
    return { url: existingUrl, success: true, message: `PR already exists` };
  }

  // Create new PR
  return strategy.create({ ... });
}
```

5. **Add tests** for each strategy in isolation:
   - `src/strategies/github-pr-creator.test.ts`
   - `src/strategies/azure-pr-creator.test.ts`

6. **Update exports** in `src/pr-creator.ts` to export the interface for extensibility.

### Verification

- All existing tests pass: `npm test`
- Integration test passes: `npm run test:integration`
- Manual test with both GitHub and Azure repos

---

## 2. Discriminated Union for RepoInfo Types (Type Safety)

**Priority:** Medium
**Effort:** ~1-2 hours
**Files affected:** `src/repo-detector.ts`, `src/pr-creator.ts`, `src/index.ts`

### Problem

The current `RepoInfo` interface has optional fields that are contextually required:

```typescript
// src/repo-detector.ts:3-11
export interface RepoInfo {
  type: RepoType;
  gitUrl: string;
  owner: string;
  repo: string;
  organization?: string; // Required for Azure, unused for GitHub
  project?: string; // Required for Azure, unused for GitHub
}
```

This causes:

- No compile-time safety for platform-specific fields
- Runtime `?? ""` fallbacks scattered through code
- Potential bugs when accessing wrong fields

### Solution

Use TypeScript discriminated unions to enforce correct field access per platform.

### Implementation Steps

1. **Define platform-specific interfaces** in `src/repo-detector.ts`:

```typescript
export type RepoType = "github" | "azure-devops";

interface BaseRepoInfo {
  gitUrl: string;
  repo: string;
}

export interface GitHubRepoInfo extends BaseRepoInfo {
  type: "github";
  owner: string;
}

export interface AzureDevOpsRepoInfo extends BaseRepoInfo {
  type: "azure-devops";
  organization: string;
  project: string;
}

export type RepoInfo = GitHubRepoInfo | AzureDevOpsRepoInfo;
```

2. **Update `parseGitUrl()`** to return the correct discriminated type:

```typescript
export function parseGitUrl(gitUrl: string): RepoInfo {
  const type = detectRepoType(gitUrl);

  if (type === "azure-devops") {
    // Parse Azure URL...
    return {
      type: "azure-devops",
      gitUrl,
      organization: org,
      project: proj,
      repo: repoName,
    } satisfies AzureDevOpsRepoInfo;
  }

  // Parse GitHub URL...
  return {
    type: "github",
    gitUrl,
    owner,
    repo: repoName,
  } satisfies GitHubRepoInfo;
}
```

3. **Update `getRepoDisplayName()`** with type narrowing:

```typescript
export function getRepoDisplayName(repoInfo: RepoInfo): string {
  if (repoInfo.type === "azure-devops") {
    // TypeScript knows organization and project exist here
    return `${repoInfo.organization}/${repoInfo.project}/${repoInfo.repo}`;
  }
  // TypeScript knows owner exists here
  return `${repoInfo.owner}/${repoInfo.repo}`;
}
```

4. **Update `src/pr-creator.ts`** - Remove `?? ""` fallbacks:

The type system now guarantees `organization` and `project` exist when `type === "azure-devops"`, so the fallbacks are unnecessary.

5. **Add type guards** (optional, for convenience):

```typescript
export function isGitHubRepo(info: RepoInfo): info is GitHubRepoInfo {
  return info.type === "github";
}

export function isAzureRepo(info: RepoInfo): info is AzureDevOpsRepoInfo {
  return info.type === "azure-devops";
}
```

6. **Fix all TypeScript errors** that arise from the stricter types.

### Verification

- Build succeeds: `npm run build`
- All tests pass: `npm test`
- No `?? ""` patterns remain for `organization` or `project` fields
- Search codebase: `grep -r "organization ??" src/` should return nothing

---

## 3. Improve Error Differentiation in PR Checks

**Priority:** Low
**Effort:** ~30 minutes
**Files affected:** `src/pr-creator.ts`

### Problem

Silent catch blocks mask different error types:

```typescript
// src/pr-creator.ts:134-136
} catch {
  // No existing PR, continue to create
}
```

This treats all exceptions identically:

- Authentication failures → silent, may create duplicate PR
- Network timeouts → silent, inconsistent state
- "No PR found" → correct behavior (should be silent)

### Solution

Add logging for unexpected errors while preserving the continue-on-error behavior.

### Implementation Steps

1. **Create error classification helper** in `src/pr-creator.ts`:

```typescript
function isExpectedPRCheckError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  // Expected: no PR exists, empty result, normal exit codes
  return (
    msg.includes("no pull requests") ||
    msg.includes("not found") ||
    msg.includes("exit code 1") // gh/az return 1 when no results
  );
}
```

2. **Update GitHub PR check** (around line 134) with conditional logging:

```typescript
} catch (error) {
  if (!isExpectedPRCheckError(error)) {
    console.warn(
      `Warning: PR existence check failed: ${error instanceof Error ? error.message : error}`
    );
  }
  // Continue to create PR regardless
}
```

3. **Update Azure DevOps PR check** (around line 195) similarly.

4. **Optional enhancement**: Use the existing logger instead of console.warn for consistent formatting.

### Verification

- Tests pass: `npm test`
- Manual test: temporarily invalidate `gh` auth, verify warning appears in output
- Manual test: normal flow still works without spurious warnings

---

## Implementation Order

Recommended sequence for a future session:

1. **Error Differentiation** (30 min) - Quick win, improves debugging immediately
2. **Discriminated Unions** (1-2 hrs) - Improves type safety, catches bugs at compile time
3. **Strategy Pattern** (2-3 hrs) - Largest refactor, enables future platform support

Each improvement is independent and can be done in separate PRs.

---

## Files Reference

```
src/
├── pr-creator.ts       # Main target for improvements 1 & 3
├── repo-detector.ts    # Main target for improvement 2
├── index.ts            # May need minor updates for type changes
├── strategies/         # New directory for improvement 1
│   ├── github-pr-creator.ts
│   └── azure-pr-creator.ts
└── *.test.ts           # Update/add tests for each change
```

---

## Testing Checklist

After each improvement:

- [ ] `npm run build` succeeds with no errors
- [ ] `npm test` - all unit tests pass
- [ ] `npm run test:integration` - integration test passes
- [ ] Manual dry-run test: `npm run dev -- --dry-run`
