# Git Authentication Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create AuthenticatedGitOps wrapper that owns all git authentication, eliminating the spaghetti of global config + per-command overrides.

**Architecture:** AuthenticatedGitOps wraps GitOps, adding `-c url.insteadOf` to all network operations when a token is provided. GitOps stays simple. action.yml no longer manipulates git config.

**Tech Stack:** TypeScript, Node.js test runner, git CLI

---

## Task 1: Create AuthenticatedGitOps Wrapper (Core)

**Files:**

- Create: `src/authenticated-git-ops.ts`
- Test: `src/authenticated-git-ops.test.ts`

### Step 1: Write failing tests for AuthenticatedGitOps

Create `src/authenticated-git-ops.test.ts` with tests for:

- Without auth: clone/push/fetch delegate directly to GitOps
- With auth: clone/push/fetch use authenticated commands with `-c url.insteadOf`
- Local operations pass through unchanged (cleanWorkspace, commit, writeFile, etc.)

### Step 2: Run tests to verify they fail

Run: `npm test -- --test-name-pattern="AuthenticatedGitOps"`
Expected: FAIL - module not found

### Step 3: Implement AuthenticatedGitOps

Create `src/authenticated-git-ops.ts` with:

- `GitAuthOptions` interface (token, host, owner, repo)
- `AuthenticatedGitOps` class wrapping GitOps
- `buildAuthenticatedCommand()` method using escapeShellArg
- Network ops (clone, fetch, push, getDefaultBranch) use auth when token provided
- Local ops delegate unchanged to GitOps

### Step 4: Run tests to verify they pass

Run: `npm run build && npm test -- --test-name-pattern="AuthenticatedGitOps"`
Expected: PASS

### Step 5: Commit

```bash
git add src/authenticated-git-ops.ts src/authenticated-git-ops.test.ts
git commit -m "feat: add AuthenticatedGitOps wrapper for centralized git auth

Refs: #316"
```

---

## Task 2: Remove URL Reset Hack from GitOps

**Files:**

- Modify: `src/git-ops.ts:73-88`

### Step 1: Remove the URL reset from clone()

In `src/git-ops.ts`, simplify clone method to just:

```typescript
async clone(gitUrl: string): Promise<void> {
  await this.execWithRetry(
    `git clone ${escapeShellArg(gitUrl)} .`,
    this.workDir
  );
}
```

Remove the `git remote set-url` lines (79-87).

### Step 2: Run tests

Run: `npm run build && npm test`
Expected: PASS

### Step 3: Commit

```bash
git add src/git-ops.ts
git commit -m "refactor: remove URL reset hack from GitOps.clone()

No longer needed - AuthenticatedGitOps handles auth for all network ops.

Refs: #316"
```

---

## Task 3: Update Repository Processor to Use AuthenticatedGitOps

**Files:**

- Modify: `src/repository-processor.ts`
- Modify: `src/repository-processor.test.ts`

### Step 1: Update imports and factory type

Add import for AuthenticatedGitOps and GitAuthOptions.
Update `GitOpsFactory` type to accept optional auth parameter.

### Step 2: Update constructor default

Change default factory to create AuthenticatedGitOps instead of GitOps.

### Step 3: Update processRepository to pass auth

Build GitAuthOptions from token and repoInfo, pass to factory.

### Step 4: Update tests

Update mock factories in tests to match new signature.

### Step 5: Run tests

Run: `npm run build && npm test`
Expected: PASS

### Step 6: Commit

```bash
git add src/repository-processor.ts src/repository-processor.test.ts
git commit -m "refactor: use AuthenticatedGitOps in repository processor

Refs: #316"
```

---

## Task 4: Remove buildAuthenticatedGitCommand from GraphQLCommitStrategy

**Files:**

- Modify: `src/strategies/graphql-commit-strategy.ts`
- Modify: `src/strategies/graphql-commit-strategy.test.ts`

### Step 1: Analyze usages

The method is used for ls-remote, push --delete, push -u, fetch in ensureBranchExistsOnRemote.

### Step 2: Pass AuthenticatedGitOps to strategy

Update strategy to receive gitOps wrapper with auth already configured.

### Step 3: Replace calls with gitOps methods

Use gitOps.push() and gitOps.fetch(). May need to add ls-remote method.

### Step 4: Remove buildAuthenticatedGitCommand method

Delete the method entirely.

### Step 5: Update tests

Remove tests for deleted method, update mocks.

### Step 6: Run tests

Run: `npm run build && npm test`
Expected: PASS

### Step 7: Commit

```bash
git add src/strategies/graphql-commit-strategy.ts src/strategies/graphql-commit-strategy.test.ts
git commit -m "refactor: remove buildAuthenticatedGitCommand from GraphQLCommitStrategy

Refs: #316"
```

---

## Task 5: Simplify action.yml

**Files:**

- Modify: `action.yml`

### Step 1: Remove "Configure git" step URL rewrite logic

Delete the URL rewrite configuration (lines 98-103 and related).

### Step 2: Keep only git user config

Keep only the git user.name and user.email configuration.

### Step 3: Verify env vars still passed

Ensure Run xfg step has GH_TOKEN, XFG_GITHUB_APP_ID, etc.

### Step 4: Commit

```bash
git add action.yml
git commit -m "refactor: remove git URL rewrite from action.yml

BREAKING CHANGE: action.yml no longer configures global git credentials.

Refs: #316"
```

---

## Task 6: Simplify CI Workflow

**Files:**

- Modify: `.github/workflows/ci.yaml`

### Step 1: Remove PAT URL rewrite setup

Remove `git config --global url...insteadOf` lines.

### Step 2: Remove "Reconfigure git URL rewrite" step

Delete the step added for App tests.

### Step 3: Keep only git user config

Keep only git user.name and user.email.

### Step 4: Run local tests

Run: `npm run build && npm test`
Expected: PASS

### Step 5: Commit

```bash
git add .github/workflows/ci.yaml
git commit -m "refactor: remove git URL rewrite from CI workflow

Refs: #316"
```

---

## Task 7: Bump Version to 4.0.0

**Files:**

- Modify: `package.json`

### Step 1: Update version

Change version from 3.1.x to 4.0.0

### Step 2: Commit

```bash
git add package.json
git commit -m "chore: bump version to 4.0.0

BREAKING CHANGE: Git auth architecture changed.

Refs: #316"
```

---

## Task 8: Update Documentation

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/` (GitHub Pages)

### Step 1: Update CLAUDE.md

Add authenticated-git-ops.ts to Key Modules table.
Remove URL rewrite notes.

### Step 2: Update README.md

Simplify authentication section.

### Step 3: Update docs/ examples

Remove git config references, update examples.

### Step 4: Commit

```bash
git add CLAUDE.md README.md docs/
git commit -m "docs: update documentation for v4.0.0 auth changes

Refs: #316"
```

---

## Task 9: Final Verification

### Step 1: Run full test suite

Run: `npm run build && npm test`
Expected: All tests pass

### Step 2: Run linting

Run: `./lint.sh`
Expected: PASS

### Step 3: Create PR

Push branch and create PR for review.

---

## Summary

| Task | Description                         | Est. Complexity |
| ---- | ----------------------------------- | --------------- |
| 1    | Create AuthenticatedGitOps wrapper  | Medium          |
| 2    | Remove URL reset hack from GitOps   | Simple          |
| 3    | Update Repository Processor         | Medium          |
| 4    | Remove buildAuthenticatedGitCommand | Medium          |
| 5    | Simplify action.yml                 | Simple          |
| 6    | Simplify CI workflow                | Simple          |
| 7    | Bump version to 4.0.0               | Trivial         |
| 8    | Update documentation                | Simple          |
| 9    | Final verification                  | Simple          |
