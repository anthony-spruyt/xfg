# GitHub App Authentication with Verified Commits

**Date:** 2026-01-29
**Status:** Approved

## Overview

Add optional GitHub App support for GitHub repositories, enabling enterprise users to avoid PATs while getting GitHub-verified commits.

## Goals

- Support GitHub App authentication as an alternative to PATs (GitHub platform only)
- Enable verified commits via GitHub's GraphQL `createCommitOnBranch` mutation
- Maintain backward compatibility with existing PAT-based workflows
- Target enterprise users who prefer Apps/workload identities over PATs

## Non-Goals

- Replacing PAT authentication entirely
- Supporting GitHub Apps for ADO/GitLab (they continue using PATs)
- Custom commit author with verified status (not possible without GPG)

## Authentication Flow

```
┌─────────────────────────────────────────────────────────┐
│ GitHub Actions Workflow                                 │
├─────────────────────────────────────────────────────────┤
│ 1. actions/create-github-app-token@v2                   │
│    ├── Input: App ID + Private Key (from secrets)       │
│    └── Output: Installation token                       │
│                                                         │
│ 2. xfg action                                           │
│    └── Input: GH_INSTALLATION_TOKEN=${{ token }}        │
└─────────────────────────────────────────────────────────┘
```

### Environment Variable Contract

| Variable                | Auth Type  | Commit Flow                         |
| ----------------------- | ---------- | ----------------------------------- |
| `GH_TOKEN`              | PAT        | `git commit` + `git push` (current) |
| `GH_INSTALLATION_TOKEN` | GitHub App | GraphQL `createCommitOnBranch` API  |

If both are set, `GH_INSTALLATION_TOKEN` takes precedence for GitHub repos.

## Architecture

### Commit Strategy Abstraction

Create a strategy interface that abstracts how commits are made, similar to the existing `PRStrategy` pattern.

```typescript
interface CommitStrategy {
  /**
   * Create a commit with the given file changes
   * Returns the new commit SHA
   */
  commit(options: CommitOptions): Promise<CommitResult>;
}

interface CommitOptions {
  repoInfo: RepoInfo;
  branchName: string;
  message: string;
  fileChanges: FileChange[]; // additions, modifications, deletions
  workDir: string;
}

interface CommitResult {
  sha: string;
  verified: boolean;
}
```

### Two Implementations

| Strategy                | Used When                | How It Works                                        |
| ----------------------- | ------------------------ | --------------------------------------------------- |
| `GitCommitStrategy`     | `GH_TOKEN` or ADO/GitLab | Current flow: `git add` → `git commit` → `git push` |
| `GraphQLCommitStrategy` | `GH_INSTALLATION_TOKEN`  | Build mutation → call `createCommitOnBranch` API    |

### Strategy Selection

```typescript
function selectCommitStrategy(repoInfo: RepoInfo): CommitStrategy {
  if (isGitHubRepo(repoInfo) && process.env.GH_INSTALLATION_TOKEN) {
    return new GraphQLCommitStrategy();
  }
  return new GitCommitStrategy();
}
```

## GraphQL Implementation

### The `createCommitOnBranch` Mutation

```graphql
mutation CreateCommit($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit {
      oid
      url
    }
  }
}
```

### Input Structure

```typescript
{
  branch: {
    repositoryNameWithOwner: "owner/repo",
    branchName: "chore/sync-config"
  },
  expectedHeadOid: "abc123...",  // Current HEAD SHA (optimistic locking)
  message: {
    headline: "chore: sync configuration files"
  },
  fileChanges: {
    additions: [
      { path: ".eslintrc.json", contents: "<base64>" }
    ],
    deletions: [
      { path: ".old-config.yaml" }
    ]
  }
}
```

### Key Implementation Details

1. **Get HEAD SHA** - Use `git rev-parse HEAD` or API call before committing
2. **Base64 encode** - File contents must be base64 encoded
3. **Optimistic locking** - `expectedHeadOid` prevents race conditions
4. **No separate push** - The API updates the branch reference atomically

## Error Handling

| Error                      | Cause                                          | Handling                                                                                                            |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `expectedHeadOid` mismatch | Branch updated during operation                | Retry: fetch new HEAD, rebuild mutation, retry once                                                                 |
| Payload too large          | Files exceed API limits (~100MB)               | Fail with clear error: "File X exceeds GitHub API size limit. Use GH_TOKEN instead."                                |
| Token lacks permissions    | App not installed or missing `contents: write` | Fail with error: "GitHub App lacks required permissions (contents: write)"                                          |
| Rate limit                 | API quota exceeded                             | Respect `Retry-After` header, retry with backoff                                                                    |
| GHE not supported          | Older GHE version without GraphQL mutation     | Detect and fail with: "GitHub Enterprise Server version X does not support verified commits. Use GH_TOKEN instead." |

### No Automatic Fallback

No automatic fallback to `git` flow - fail explicitly so users know to switch auth methods if needed.

## Limitations

To be documented:

1. **Commit author** - Commits appear as the GitHub App, not a custom user
2. **File size** - Large files (>50MB recommended limit) should use PAT flow
3. **Binary files** - Supported but base64 encoding increases payload size by ~33%
4. **GHE compatibility** - Requires GHE 3.6+ for `createCommitOnBranch` support
5. **Atomic commits only** - All file changes in a single commit (no incremental staging)

## PR Creation

PRs continue using `gh` CLI with the installation token passed as `GH_TOKEN`. No changes to PR creation flow.

## `merge: direct` Support

The GraphQL `createCommitOnBranch` mutation can target any branch (including `main`), so `merge: direct` works naturally - commits directly to the target branch via API.

## Documentation

### New Page: `docs/platforms/github-app.md`

- Benefits (no user-tied credentials, verified commits, audit trails)
- Setup instructions (create app, store credentials)
- GitHub Actions workflow example using `actions/create-github-app-token@v2`
- Limitations section

### Updates to Existing Docs

- `docs/platforms/github.md` - Add "Authentication Options" section
- `docs/ci-cd/github-actions.md` - Add GitHub App example alongside PAT example

## Testing

### Unit Tests

| Component                  | Tests                                                   |
| -------------------------- | ------------------------------------------------------- |
| `GraphQLCommitStrategy`    | Mutation building, base64 encoding, response parsing    |
| `CommitStrategy` selection | Correct strategy chosen based on env vars and repo type |
| Error handling             | Payload size detection, permission errors, retry logic  |

**Note:** Codecov requires 95%+ coverage - unit tests must be thorough.

### Integration Tests

New file: `test/integration/github-app.test.ts`

- Requires a real GitHub App for CI (test app on `xfg-test` repo)
- Tests: commit creation, verified status, PR creation, `merge: direct`
- Skip if `GH_INSTALLATION_TOKEN` not set

**Manual step required:** Create test GitHub App and add to `xfg-test` repo before integration tests can run in CI.

### Manual Testing Checklist

1. Create commit → verify "Verified" badge appears
2. Create PR → verify App is author
3. `merge: direct` → verify commit on target branch
4. Large file → verify clear error message
5. Invalid token → verify permission error message

## Implementation Plan

### Files to Create/Modify

| File                                        | Change                                       |
| ------------------------------------------- | -------------------------------------------- |
| `src/strategies/commit-strategy.ts`         | New - interface + `GitCommitStrategy`        |
| `src/strategies/graphql-commit-strategy.ts` | New - `GraphQLCommitStrategy` implementation |
| `src/repository-processor.ts`               | Modify - use `CommitStrategy` abstraction    |
| `src/git-ops.ts`                            | Modify - extract file change detection logic |
| `test/integration/github-app.test.ts`       | New - integration tests                      |
| `docs/platforms/github-app.md`              | New - documentation                          |
| `docs/platforms/github.md`                  | Modify - link to App auth                    |
| `docs/ci-cd/github-actions.md`              | Modify - add App example                     |

### Implementation Order

1. Create `CommitStrategy` interface and `GitCommitStrategy` (refactor existing code)
2. Add strategy selection logic
3. Implement `GraphQLCommitStrategy`
4. Add error handling and size checks
5. Unit tests (must hit 95%+ coverage)
6. Documentation
7. **Prompt user**: Create test GitHub App, add to `xfg-test` repo
8. Integration tests
