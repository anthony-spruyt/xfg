# RepoSettingsProcessor GitHub App Token Support

**Issue:** #418
**Date:** 2026-02-08

## Problem

`RepoSettingsProcessor` lacks GitHub App token management that `RulesetProcessor` has. When running `xfg settings` with GitHub App authentication, all repo settings appear as "additions" because the processor can't fetch current settings from the API.

## Solution

Add the same token management pattern from `RulesetProcessor` to `RepoSettingsProcessor`.

## Code Changes

### `src/repo-settings-processor.ts`

1. Add imports:

   ```typescript
   import { hasGitHubAppCredentials } from "./strategies/index.js";
   import { GitHubAppTokenManager } from "./github-app-token-manager.js";
   ```

2. Add `tokenManager` field and constructor initialization:

   ```typescript
   private readonly tokenManager: GitHubAppTokenManager | null;

   constructor(strategy?: IRepoSettingsStrategy) {
     this.strategy = strategy ?? new GitHubRepoSettingsStrategy();
     if (hasGitHubAppCredentials()) {
       this.tokenManager = new GitHubAppTokenManager(
         process.env.XFG_GITHUB_APP_ID!,
         process.env.XFG_GITHUB_APP_PRIVATE_KEY!
       );
     } else {
       this.tokenManager = null;
     }
   }
   ```

3. In `process()`, resolve effective token before using:

   ```typescript
   const effectiveToken =
     token ?? (await this.getInstallationToken(githubRepo));
   const strategyOptions = { token: effectiveToken, host: githubRepo.host };
   ```

4. Add private helper method:
   ```typescript
   private async getInstallationToken(
     repoInfo: GitHubRepoInfo
   ): Promise<string | undefined> {
     if (!this.tokenManager) {
       return undefined;
     }
     try {
       const token = await this.tokenManager.getTokenForRepo(repoInfo);
       return token ?? undefined;
     } catch {
       return undefined;
     }
   }
   ```

### `test/unit/repo-settings-processor.test.ts`

Add `describe("GitHub App token resolution")` block with:

1. Test: "passes resolved App token to strategy when App credentials are set"
2. Test: "falls back gracefully when token manager returns null"

Both follow the same pattern as `ruleset-processor.test.ts`.

## Verification

1. `npm test` - all tests pass
2. `./lint.sh` - no linting issues
3. Check `git status` for unexpected docs changes before committing

## Previous Attempt

PR #416 attempted this fix but pre-commit hooks broke docs formatting (admonition indentation). Reverted in #417. This attempt will run lint explicitly before committing.
