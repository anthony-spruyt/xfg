# Git Authentication Refactor Design

**Issue:** #316
**Date:** 2026-02-02
**Version:** v4.0.0 (major version bump)

## Problem

GitHub App authentication has become a spaghetti mess:

1. action.yml sets global URL rewrite for PAT auth
2. action.yml conditionally skips URL rewrite when App auth configured
3. GraphQLCommitStrategy uses per-command `-c url.insteadOf` for push
4. Clone bakes global config into remote URL, requiring reset hack

Auth is split between action.yml (global git config) and xfg (per-command overrides). They don't compose well.

## Solution

**xfg owns all git authentication.** Single source of truth.

```
┌─────────────────────────────────────────────────────────┐
│ action.yml                                              │
│ - Just passes tokens to xfg via env vars                │
│ - NO git config manipulation                            │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ xfg (AuthenticatedGitOps)                               │
│ - Has token (PAT or App)                                │
│ - ALL git network ops use -c url.insteadOf with token   │
│ - Clone, fetch, push all authenticated the same way     │
└─────────────────────────────────────────────────────────┘
```

## Design

### 1. AuthenticatedGitOps Wrapper

**New file: `src/authenticated-git-ops.ts`**

```typescript
interface GitAuthOptions {
  token?: string;
  host?: string; // e.g., "github.com"
  owner?: string; // e.g., "anthony-spruyt"
  repo?: string; // e.g., "xfg"
}

class AuthenticatedGitOps {
  constructor(
    private gitOps: GitOps,
    private auth?: GitAuthOptions
  ) {}

  // Network ops - add -c url.insteadOf when auth provided
  async clone(gitUrl: string): Promise<void>;
  async fetch(options?: { prune?: boolean }): Promise<void>;
  async push(branchName: string, options?: { force?: boolean }): Promise<void>;
  async getDefaultBranch(): Promise<{ branch: string; method: string }>;

  // Local ops - pass through unchanged
  cleanWorkspace(): void;
  writeFile(fileName: string, content: string): void;
  async commit(message: string): Promise<boolean>;
  // ... all other GitOps methods
}
```

**Key behaviors:**

- If no `auth.token` provided, delegates directly to GitOps (backwards compatible)
- If token provided, wraps network commands with `-c url.insteadOf`
- Uses repo-specific URL pattern for longer prefix match
- GitOps stays simple, auth logic is isolated in wrapper

### 2. Integration Changes

**repository-processor.ts:**

- Create `AuthenticatedGitOps` instead of plain `GitOps`
- Pass token (from App or PAT) at construction time
- Remove workaround code

**graphql-commit-strategy.ts:**

- Remove `buildAuthenticatedGitCommand()` - logic moves to wrapper
- Use the authenticated wrapper passed to it
- Simplify to just GraphQL commit logic

**action.yml:**

- Remove "Configure git" step entirely (lines 83-115)
- Just pass tokens via env vars to xfg
- xfg is fully self-contained

**CI workflow (.github/workflows/ci.yaml):**

- Remove PAT URL rewrite setup for tests
- Tests use same auth flow as production

### 3. Documentation & Versioning

**package.json:**

- Bump version to `4.0.0`

**CLAUDE.md:**

- Update "Key Modules" table to include `authenticated-git-ops.ts`
- Remove notes about URL rewrite behavior

**README.md:**

- Update version badge
- Simplify authentication section

**docs/ (GitHub Pages):**

- Update authentication documentation
- Update examples to reflect simpler auth model
- Remove references to global git config manipulation

### 4. Testing & Cleanup

**Unit tests:**

- Add `authenticated-git-ops.test.ts` - test auth wrapping logic
- Update `git-ops.test.ts` - remove remote URL reset test
- Update `graphql-commit-strategy.test.ts` - remove `buildAuthenticatedGitCommand` tests
- Update `repository-processor.test.ts` - mock AuthenticatedGitOps

**Integration tests:**

- Simplify CI setup (no global URL rewrite)
- Keep commit author verification tests
- Tests reflect production behavior exactly

**Cleanup (remove workarounds):**

- Remove remote URL reset from `GitOps.clone()` (PR #315 hack)
- Remove conditional URL rewrite logic from `action.yml` (PR #314 hack)
- Remove `buildAuthenticatedGitCommand()` from GraphQLCommitStrategy

## Benefits

- Single source of truth for git auth (xfg)
- No global config pollution
- PAT and App auth work the same way
- No edge cases from config composition
- Simpler action.yml
- Easier to test and reason about
