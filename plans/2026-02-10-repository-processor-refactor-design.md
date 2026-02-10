# Repository Processor Refactoring Design

## Overview & Goals

### Problem Statement

`RepositoryProcessor` at 753 lines violates Single Responsibility Principle by handling:

- Authentication/token management
- Repository workspace lifecycle (clone, cleanup)
- File synchronization orchestration
- Commit and push operations
- PR creation and merge handling

Additionally, ~200 lines are duplicated between `process()` and `updateManifestOnly()`.

### Goals

1. **Reduce RepositoryProcessor to thin orchestrator** (~150-200 lines)
2. **Extract domain services** with single responsibilities
3. **Eliminate duplication** between the two public methods
4. **Improve testability** by enabling isolated unit tests for each service
5. **Maintain backwards compatibility** - no changes to public interface

### Non-Goals

- Changing the `IRepositoryProcessor` interface
- Modifying how callers interact with the processor
- Refactoring other parts of the codebase
- Adding new features

### Success Criteria

| Metric                          | Before     | Target |
| ------------------------------- | ---------- | ------ |
| `repository-processor.ts` lines | 753        | <200   |
| Duplicated code                 | ~200 lines | 0      |
| New files                       | 0          | 3-4    |
| Tests passing                   | 1,709      | 1,709+ |
| Max file size                   | 753        | <150   |

---

## Architecture

### Current State

```
RepositoryProcessor (753 lines)
├── Token acquisition (embedded)
├── Auth options building (embedded)
├── Workspace management (embedded)
├── File writing → delegates to FileWriter
├── Manifest handling → delegates to ManifestManager
├── Branch setup → delegates to BranchManager
├── Commit/push (embedded)
└── PR/merge (embedded)
```

### Target State

```
RepositoryProcessor (~150 lines) - Thin Orchestrator
├── AuthOptionsBuilder (~60 lines) - Authentication domain
├── RepositorySession (~80 lines) - Workspace lifecycle
├── CommitPushManager (~100 lines) - Commit/push workflow
├── FileWriter (existing) - File operations
├── ManifestManager (existing) - Manifest operations
└── BranchManager (existing) - Branch operations
```

### Domain Boundaries

| Domain            | Service               | Responsibility                               |
| ----------------- | --------------------- | -------------------------------------------- |
| **Auth**          | `AuthOptionsBuilder`  | Token acquisition, auth options construction |
| **Workspace**     | `RepositorySession`   | Clone, cleanup, gitOps lifecycle             |
| **VCS**           | `CommitPushManager`   | Stage, commit, push, error handling          |
| **Sync**          | `FileWriter`          | File writing (exists)                        |
| **Sync**          | `ManifestManager`     | Orphan detection (exists)                    |
| **Sync**          | `BranchManager`       | Branch setup (exists)                        |
| **Orchestration** | `RepositoryProcessor` | Coordinate workflow                          |

---

## Component Design

### 1. AuthOptionsBuilder

**Purpose**: Encapsulate authentication logic for GitHub App tokens and PAT fallback.

**File**: `src/sync/auth-options-builder.ts`

```typescript
export interface AuthResult {
  /** Installation token or PAT */
  token?: string;
  /** Auth options for git operations */
  authOptions?: GitAuthOptions;
  /** If set, caller should return this result (e.g., no installation found) */
  skipResult?: ProcessorResult;
}

export interface IAuthOptionsBuilder {
  /**
   * Resolve authentication for a repository.
   * Returns token and auth options, or a skip result if repo should be skipped.
   */
  resolve(repoInfo: RepoInfo, repoName: string): Promise<AuthResult>;
}

export class AuthOptionsBuilder implements IAuthOptionsBuilder {
  constructor(
    private readonly tokenManager: GitHubAppTokenManager | null,
    private readonly log: ILogger
  ) {}

  async resolve(repoInfo: RepoInfo, repoName: string): Promise<AuthResult> {
    // 1. Get installation token if GitHub App configured
    const installationToken = await this.getInstallationToken(repoInfo);

    // 2. Handle "no installation found" case
    if (installationToken === null) {
      return {
        skipResult: {
          success: true,
          repoName,
          message: `No GitHub App installation found for ${repoInfo.owner}`,
          skipped: true,
        },
      };
    }

    // 3. Build effective token (installation token or PAT fallback)
    const token =
      installationToken ??
      (isGitHubRepo(repoInfo) ? process.env.GH_TOKEN : undefined);

    // 4. Build auth options if we have a token
    const authOptions = token
      ? this.buildAuthOptions(repoInfo, token)
      : undefined;

    return { token, authOptions };
  }

  private async getInstallationToken(
    repoInfo: RepoInfo
  ): Promise<string | null | undefined> {
    if (!this.tokenManager || !isGitHubRepo(repoInfo)) {
      return undefined;
    }

    try {
      return await this.tokenManager.getTokenForRepo(
        repoInfo as GitHubRepoInfo
      );
    } catch (error) {
      this.log.info(
        `Warning: Failed to get GitHub App token: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }

  private buildAuthOptions(repoInfo: RepoInfo, token: string): GitAuthOptions {
    return {
      token,
      host: isGitHubRepo(repoInfo)
        ? (repoInfo as GitHubRepoInfo).host
        : "github.com",
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    };
  }
}
```

**Test Strategy**:

- Mock `GitHubAppTokenManager`
- Test token acquisition success/failure paths
- Test PAT fallback
- Test skip result generation

---

### 2. RepositorySession

**Purpose**: Manage repository workspace lifecycle (clone, cleanup, gitOps instance).

**File**: `src/sync/repository-session.ts`

```typescript
export interface SessionOptions {
  workDir: string;
  dryRun: boolean;
  retries: number;
  authOptions?: GitAuthOptions;
}

export interface SessionContext {
  /** Authenticated git operations */
  gitOps: IAuthenticatedGitOps;
  /** Default branch name */
  baseBranch: string;
  /** Cleanup function - call in finally block */
  cleanup: () => void;
}

export interface IRepositorySession {
  /**
   * Setup repository workspace: clean, clone, detect default branch.
   * Returns context with gitOps and cleanup function.
   */
  setup(repoInfo: RepoInfo, options: SessionOptions): Promise<SessionContext>;
}

export class RepositorySession implements IRepositorySession {
  constructor(
    private readonly gitOpsFactory: GitOpsFactory,
    private readonly log: ILogger
  ) {}

  async setup(
    repoInfo: RepoInfo,
    options: SessionOptions
  ): Promise<SessionContext> {
    const { workDir, dryRun, retries, authOptions } = options;

    // Create gitOps instance
    const gitOps = this.gitOpsFactory(
      { workDir, dryRun, retries },
      authOptions
    );

    // Clean workspace
    this.log.info("Cleaning workspace...");
    gitOps.cleanWorkspace();

    // Clone repository
    this.log.info("Cloning repository...");
    await gitOps.clone(repoInfo.gitUrl);

    // Detect default branch
    const { branch: baseBranch, method: detectionMethod } =
      await gitOps.getDefaultBranch();
    this.log.info(
      `Default branch: ${baseBranch} (detected via ${detectionMethod})`
    );

    // Return context with cleanup function
    return {
      gitOps,
      baseBranch,
      cleanup: () => {
        try {
          gitOps.cleanWorkspace();
        } catch {
          // Ignore cleanup errors - best effort
        }
      },
    };
  }
}
```

**Test Strategy**:

- Mock `GitOpsFactory`
- Test workspace setup sequence
- Test cleanup function
- Test error handling during clone

---

### 3. CommitPushManager

**Purpose**: Handle staging, committing, and pushing changes with error handling.

**File**: `src/sync/commit-push-manager.ts`

```typescript
export interface CommitPushOptions {
  repoInfo: RepoInfo;
  gitOps: IAuthenticatedGitOps;
  workDir: string;
  fileChanges: Map<string, FileWriteResult>;
  commitMessage: string;
  pushBranch: string;
  isDirectMode: boolean;
  dryRun: boolean;
  retries: number;
  token?: string;
  executor: ICommandExecutor;
}

export interface CommitPushResult {
  /** Whether commit/push succeeded */
  success: boolean;
  /** If failed, contains error result to return */
  errorResult?: ProcessorResult;
  /** If success but no changes, indicates skip */
  skipped?: boolean;
}

export interface ICommitPushManager {
  /**
   * Stage, commit, and push changes.
   * Handles dry-run mode and branch protection errors.
   */
  commitAndPush(
    options: CommitPushOptions,
    repoName: string
  ): Promise<CommitPushResult>;
}

export class CommitPushManager implements ICommitPushManager {
  constructor(private readonly log: ILogger) {}

  async commitAndPush(
    options: CommitPushOptions,
    repoName: string
  ): Promise<CommitPushResult> {
    const {
      repoInfo,
      gitOps,
      workDir,
      fileChanges,
      commitMessage,
      pushBranch,
      isDirectMode,
      dryRun,
      retries,
      token,
      executor,
    } = options;

    // Dry-run mode: just log
    if (dryRun) {
      this.log.info("Staging changes...");
      this.log.info(`Would commit: ${commitMessage}`);
      this.log.info(`Would push to ${pushBranch}...`);
      return { success: true };
    }

    // Build file changes for commit strategy
    const changes: FileChange[] = Array.from(fileChanges.entries())
      .filter(([, info]) => info.action !== "skip")
      .map(([path, info]) => ({ path, content: info.content }));

    // Stage changes
    this.log.info("Staging changes...");
    await executor.exec("git add -A", workDir);

    // Check for staged changes
    if (!(await gitOps.hasStagedChanges())) {
      this.log.info("No staged changes after git add -A, skipping commit");
      return { success: true, skipped: true };
    }

    // Commit and push
    const commitStrategy = getCommitStrategy(repoInfo, executor);
    this.log.info("Committing and pushing changes...");

    try {
      const result = await commitStrategy.commit({
        repoInfo,
        branchName: pushBranch,
        message: commitMessage,
        fileChanges: changes,
        workDir,
        retries,
        force: !isDirectMode,
        token,
        gitOps,
      });
      this.log.info(`Committed: ${result.sha} (verified: ${result.verified})`);
      return { success: true };
    } catch (error) {
      return this.handleCommitError(error, isDirectMode, pushBranch, repoName);
    }
  }

  private handleCommitError(
    error: unknown,
    isDirectMode: boolean,
    baseBranch: string,
    repoName: string
  ): CommitPushResult {
    if (!isDirectMode) {
      throw error; // Re-throw for non-direct mode
    }

    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("rejected") ||
      message.includes("protected") ||
      message.includes("denied")
    ) {
      return {
        success: false,
        errorResult: {
          success: false,
          repoName,
          message:
            `Push to '${baseBranch}' was rejected (likely branch protection). ` +
            `To use 'direct' mode, the target branch must allow direct pushes. ` +
            `Use 'merge: force' to create a PR and merge with admin privileges.`,
        },
      };
    }

    throw error;
  }
}
```

**Test Strategy**:

- Mock `ICommandExecutor` and `IAuthenticatedGitOps`
- Test dry-run path
- Test no-staged-changes path
- Test branch protection error handling
- Test successful commit/push

---

### 4. Updated RepositoryProcessor (Thin Orchestrator)

**Purpose**: Coordinate domain services to execute sync workflow.

**File**: `src/sync/repository-processor.ts` (refactored)

The refactored processor:

- Accepts all components via constructor (dependency injection)
- `process()` becomes ~80 lines of orchestration
- `updateManifestOnly()` becomes ~60 lines of orchestration
- Helper methods handle file processing and PR creation (~40 lines each)
- `formatCommitMessage()` extracted as pure function

**Key changes**:

1. Constructor accepts `IAuthOptionsBuilder`, `IRepositorySession`, `ICommitPushManager`
2. Both public methods follow same pattern: auth → session → branch → changes → commit → PR
3. No duplicated auth/session/commit logic
4. Components are injected, enabling easy testing

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     RepositoryProcessor.process()                │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ AuthOptions   │    │ Repository       │    │ BranchManager    │
│ Builder       │    │ Session          │    │ (existing)       │
│               │    │                  │    │                  │
│ • Get token   │    │ • Clean          │    │ • Close PR       │
│ • Build auth  │    │ • Clone          │    │ • Create branch  │
│ • Skip check  │    │ • Detect branch  │    │                  │
└───────────────┘    └──────────────────┘    └──────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ FileWriter    │    │ Manifest         │    │ CommitPush       │
│ (existing)    │    │ Manager          │    │ Manager          │
│               │    │ (existing)       │    │                  │
│ • Write files │    │ • Find orphans   │    │ • Stage          │
│ • Template    │    │ • Delete orphans │    │ • Commit         │
│ • Permissions │    │ • Save manifest  │    │ • Push           │
└───────────────┘    └──────────────────┘    └──────────────────┘
                                │
                                ▼
                    ┌──────────────────┐
                    │ createPR /       │
                    │ mergePR          │
                    │ (existing funcs) │
                    └──────────────────┘
```

---

## Error Handling

| Component             | Error Type          | Handling                                             |
| --------------------- | ------------------- | ---------------------------------------------------- |
| `AuthOptionsBuilder`  | Token fetch failure | Log warning, return undefined (graceful degradation) |
| `AuthOptionsBuilder`  | No installation     | Return skip result                                   |
| `RepositorySession`   | Clone failure       | Throw (fatal error)                                  |
| `CommitPushManager`   | Branch protection   | Return error result with helpful message             |
| `CommitPushManager`   | Other commit errors | Re-throw                                             |
| `RepositoryProcessor` | Any error           | Ensure cleanup via finally block                     |

---

## Testing Strategy

### Unit Tests Per Component

| Component            | Test Cases                                                       |
| -------------------- | ---------------------------------------------------------------- |
| `AuthOptionsBuilder` | Token success, token failure, PAT fallback, no installation skip |
| `RepositorySession`  | Setup sequence, cleanup called, clone error                      |
| `CommitPushManager`  | Dry-run, no staged changes, protection error, success            |

### Integration via RepositoryProcessor

Existing `repository-processor.test.ts` tests continue to work by:

1. Injecting mock components via constructor
2. Verifying orchestration calls components correctly
3. Testing end-to-end flows with mocked dependencies

---

## File Structure

### New Files

```
src/sync/
├── auth-options-builder.ts      # NEW (~60 lines)
├── repository-session.ts        # NEW (~80 lines)
├── commit-push-manager.ts       # NEW (~100 lines)
├── repository-processor.ts      # MODIFIED (~150 lines, was 753)
├── types.ts                     # MODIFIED (add interfaces)
└── index.ts                     # MODIFIED (export new components)

test/unit/sync/
├── auth-options-builder.test.ts  # NEW
├── repository-session.test.ts    # NEW
├── commit-push-manager.test.ts   # NEW
└── repository-processor.test.ts  # MODIFIED
```

---

## Implementation Plan

| Phase | Description                    | Files       | Estimated Lines          |
| ----- | ------------------------------ | ----------- | ------------------------ |
| 1     | Extract `AuthOptionsBuilder`   | 2 new files | +140 (60 src, 80 test)   |
| 2     | Extract `RepositorySession`    | 2 new files | +180 (80 src, 100 test)  |
| 3     | Extract `CommitPushManager`    | 2 new files | +220 (100 src, 120 test) |
| 4     | Refactor `RepositoryProcessor` | 1 modified  | -550 net                 |
| 5     | Cleanup and verify             | -           | -                        |

**Each phase**:

1. Create source file with interface and implementation
2. Create test file with unit tests
3. Add to `types.ts` and `index.ts`
4. Run `npm test` to verify
5. Run `./lint.sh` to verify

---

## Risks and Mitigations

| Risk                    | Mitigation                                      |
| ----------------------- | ----------------------------------------------- |
| Breaking existing tests | Run tests after each phase                      |
| Subtle behavior changes | Keep logic identical; move, don't rewrite       |
| Over-engineering        | Stop at 3 components; resist further extraction |
| Constructor complexity  | Optional params with production defaults        |

---

## Acceptance Criteria

- [ ] All 1,709+ tests pass
- [ ] `repository-processor.ts` <200 lines
- [ ] No file exceeds 150 lines (except types)
- [ ] No duplicated code between `process()` and `updateManifestOnly()`
- [ ] Each new component has unit tests
- [ ] Linting passes (`./lint.sh`)
- [ ] Public interface `IRepositoryProcessor` unchanged
