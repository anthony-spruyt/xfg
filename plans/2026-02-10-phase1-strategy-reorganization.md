# Phase 1: Strategy Reorganization + Coverage Config

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize strategies into domain folders, rename `src/git/` to `src/vcs/`, and update coverage exclusion configs.

**Architecture:** Move strategy implementations to their natural domain homes (VCS operations → `src/vcs/`, settings strategies → `src/settings/`). Extract interfaces to `types.ts` files following existing codebase pattern. Update coverage configs to exclude type-only and re-export files.

**Tech Stack:** TypeScript, Node.js test runner, c8 coverage, codecov

---

## Task 1: Rename src/git/ to src/vcs/

**Files:**

- Rename: `src/git/` → `src/vcs/`

**Step 1: Rename the directory**

Run:

```bash
git mv src/git src/vcs
```

**Step 2: Run build to identify broken imports**

Run: `npm run build 2>&1 | head -50`
Expected: Errors about `../git/` imports

**Step 3: Commit the rename**

```bash
git add -A && git commit -m "refactor: rename src/git to src/vcs"
```

---

## Task 2: Fix imports after git → vcs rename

**Files:**

- Modify: All files importing from `../git/` or `./git/`

**Step 1: Find all files with git imports**

Run:

```bash
grep -r "from ['\"].*\/git\/" src/ --include="*.ts" -l
```

**Step 2: Update imports in each file**

Replace all occurrences of `/git/` with `/vcs/` in import paths:

- `../git/` → `../vcs/`
- `./git/` → `./vcs/`

**Step 3: Verify build passes**

Run: `npm run build`
Expected: Success

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: update imports for git → vcs rename"
```

---

## Task 3: Create src/vcs/types.ts with PR strategy interfaces

**Files:**

- Create: `src/vcs/types.ts`
- Modify: `src/strategies/pr-strategy.ts` (extract interfaces)

**Step 1: Read current pr-strategy.ts to identify interfaces**

Interfaces to extract:

- `PRMergeConfig`
- `MergeResult`
- `PRStrategyOptions`
- `MergeOptions`
- `CloseExistingPROptions`
- `IPRStrategy`

**Step 2: Create src/vcs/types.ts**

```typescript
import type { PRResult } from "./pr-creator.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { MergeMode, MergeStrategy } from "../config/index.js";

// =============================================================================
// PR Strategy Types
// =============================================================================

export interface PRMergeConfig {
  mode: MergeMode;
  strategy?: MergeStrategy;
  deleteBranch?: boolean;
  bypassReason?: string;
}

export interface MergeResult {
  success: boolean;
  message: string;
  merged?: boolean;
  autoMergeEnabled?: boolean;
}

export interface PRStrategyOptions {
  repoInfo: RepoInfo;
  title: string;
  body: string;
  branchName: string;
  baseBranch: string;
  workDir: string;
  retries?: number;
  token?: string;
}

export interface MergeOptions {
  prUrl: string;
  config: PRMergeConfig;
  workDir: string;
  retries?: number;
  token?: string;
}

export interface CloseExistingPROptions {
  repoInfo: RepoInfo;
  branchName: string;
  baseBranch: string;
  workDir: string;
  retries?: number;
  token?: string;
}

export interface IPRStrategy {
  checkExistingPR(options: PRStrategyOptions): Promise<string | null>;
  closeExistingPR(options: CloseExistingPROptions): Promise<boolean>;
  create(options: PRStrategyOptions): Promise<PRResult>;
  merge(options: MergeOptions): Promise<MergeResult>;
  execute(options: PRStrategyOptions): Promise<PRResult>;
}

// =============================================================================
// Commit Strategy Types
// =============================================================================

export interface FileChange {
  path: string;
  content: string | null;
}

export interface CommitOptions {
  repoInfo: RepoInfo;
  branchName: string;
  message: string;
  fileChanges: FileChange[];
  workDir: string;
  retries?: number;
  force?: boolean;
  token?: string;
  gitOps?: IAuthenticatedGitOps;
}

export interface CommitResult {
  sha: string;
  verified: boolean;
  pushed: boolean;
}

export interface ICommitStrategy {
  commit(options: CommitOptions): Promise<CommitResult>;
}

// Re-import for CommitOptions
import type { IAuthenticatedGitOps } from "./authenticated-git-ops.js";
```

**Step 3: Verify file created**

Run: `npm run build`
Expected: Success (types file compiles)

**Step 4: Commit**

```bash
git add src/vcs/types.ts && git commit -m "refactor: create src/vcs/types.ts with strategy interfaces"
```

---

## Task 4: Move PR strategies to src/vcs/

**Files:**

- Move: `src/strategies/pr-strategy.ts` → `src/vcs/pr-strategy.ts`
- Move: `src/strategies/github-pr-strategy.ts` → `src/vcs/github-pr-strategy.ts`
- Move: `src/strategies/azure-pr-strategy.ts` → `src/vcs/azure-pr-strategy.ts`
- Move: `src/strategies/gitlab-pr-strategy.ts` → `src/vcs/gitlab-pr-strategy.ts`

**Step 1: Move files**

```bash
git mv src/strategies/pr-strategy.ts src/vcs/
git mv src/strategies/github-pr-strategy.ts src/vcs/
git mv src/strategies/azure-pr-strategy.ts src/vcs/
git mv src/strategies/gitlab-pr-strategy.ts src/vcs/
```

**Step 2: Update pr-strategy.ts to import from types.ts**

Remove interface definitions, import from `./types.js`:

```typescript
import type {
  PRMergeConfig,
  MergeResult,
  PRStrategyOptions,
  MergeOptions,
  CloseExistingPROptions,
  IPRStrategy,
} from "./types.js";

// Re-export for backwards compatibility
export type {
  PRMergeConfig,
  MergeResult,
  PRStrategyOptions,
  MergeOptions,
  CloseExistingPROptions,
  IPRStrategy,
};
```

**Step 3: Update imports in moved PR strategy files**

Update relative paths:

- `../shared/` stays same
- `../git/` → `./` (now in same folder)
- `./pr-strategy.js` stays same

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: move PR strategies to src/vcs/"
```

---

## Task 5: Move commit strategies to src/vcs/

**Files:**

- Move: `src/strategies/commit-strategy.ts` → `src/vcs/commit-strategy.ts`
- Move: `src/strategies/git-commit-strategy.ts` → `src/vcs/git-commit-strategy.ts`
- Move: `src/strategies/graphql-commit-strategy.ts` → `src/vcs/graphql-commit-strategy.ts`
- Move: `src/strategies/commit-strategy-selector.ts` → `src/vcs/commit-strategy-selector.ts`

**Step 1: Move files**

```bash
git mv src/strategies/commit-strategy.ts src/vcs/
git mv src/strategies/git-commit-strategy.ts src/vcs/
git mv src/strategies/graphql-commit-strategy.ts src/vcs/
git mv src/strategies/commit-strategy-selector.ts src/vcs/
```

**Step 2: Update commit-strategy.ts to import from types.ts**

Remove interface definitions, import from `./types.js`

**Step 3: Update imports in moved commit strategy files**

Update relative paths as needed

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: move commit strategies to src/vcs/"
```

---

## Task 6: Update src/vcs/index.ts with all exports

**Files:**

- Modify: `src/vcs/index.ts`

**Step 1: Update index.ts to export everything**

```typescript
// Types
export type {
  PRMergeConfig,
  MergeResult,
  PRStrategyOptions,
  MergeOptions,
  CloseExistingPROptions,
  IPRStrategy,
  FileChange,
  CommitOptions,
  CommitResult,
  ICommitStrategy,
} from "./types.js";

// Git operations
export { GitOps, type IGitOps } from "./git-ops.js";
export {
  AuthenticatedGitOps,
  type IAuthenticatedGitOps,
  type AuthenticatedGitOpsOptions,
} from "./authenticated-git-ops.js";
export { GitHubAppTokenManager } from "./github-app-token-manager.js";
export { PRCreator, type PRResult } from "./pr-creator.js";

// PR strategies
export { BasePRStrategy, PRWorkflowExecutor } from "./pr-strategy.js";
export { GitHubPRStrategy } from "./github-pr-strategy.js";
export { AzurePRStrategy } from "./azure-pr-strategy.js";
export { GitLabPRStrategy } from "./gitlab-pr-strategy.js";

// Commit strategies
export { GitCommitStrategy } from "./git-commit-strategy.js";
export {
  GraphQLCommitStrategy,
  MAX_PAYLOAD_SIZE,
} from "./graphql-commit-strategy.js";
export {
  getCommitStrategy,
  hasGitHubAppCredentials,
} from "./commit-strategy-selector.js";

// PR strategy factory (moved from src/strategies/index.ts)
import {
  RepoInfo,
  isGitHubRepo,
  isAzureDevOpsRepo,
  isGitLabRepo,
} from "../shared/repo-detector.js";
import type { IPRStrategy } from "./types.js";
import { GitHubPRStrategy } from "./github-pr-strategy.js";
import { AzurePRStrategy } from "./azure-pr-strategy.js";
import { GitLabPRStrategy } from "./gitlab-pr-strategy.js";
import { ICommandExecutor } from "../shared/command-executor.js";

export function getPRStrategy(
  repoInfo: RepoInfo,
  executor?: ICommandExecutor
): IPRStrategy {
  if (isGitHubRepo(repoInfo)) {
    return new GitHubPRStrategy(executor);
  }
  if (isAzureDevOpsRepo(repoInfo)) {
    return new AzurePRStrategy(executor);
  }
  if (isGitLabRepo(repoInfo)) {
    return new GitLabPRStrategy(executor);
  }
  const _exhaustive: never = repoInfo;
  throw new Error(`Unknown repository type: ${JSON.stringify(_exhaustive)}`);
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Success

**Step 3: Commit**

```bash
git add src/vcs/index.ts && git commit -m "refactor: update src/vcs/index.ts with all exports"
```

---

## Task 7: Create src/settings/rulesets/types.ts

**Files:**

- Create: `src/settings/rulesets/types.ts`
- Modify: `src/strategies/ruleset-strategy.ts`

**Step 1: Create types.ts with IRulesetStrategy**

```typescript
import type { RepoInfo } from "../../shared/repo-detector.js";
import type { Ruleset } from "../../config/index.js";
import type {
  GitHubRuleset,
  RulesetStrategyOptions,
} from "./github-ruleset-strategy.js";

export interface IRulesetStrategy {
  list(
    repoInfo: RepoInfo,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset[]>;
  get(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset>;
  create(
    repoInfo: RepoInfo,
    name: string,
    ruleset: Ruleset,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset>;
  update(
    repoInfo: RepoInfo,
    rulesetId: number,
    name: string,
    ruleset: Ruleset,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset>;
  delete(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: RulesetStrategyOptions
  ): Promise<void>;
}
```

**Step 2: Commit**

```bash
git add src/settings/rulesets/types.ts && git commit -m "refactor: create src/settings/rulesets/types.ts"
```

---

## Task 8: Move ruleset strategies to src/settings/rulesets/

**Files:**

- Move: `src/strategies/ruleset-strategy.ts` → `src/settings/rulesets/ruleset-strategy.ts`
- Move: `src/strategies/github-ruleset-strategy.ts` → `src/settings/rulesets/github-ruleset-strategy.ts`

**Step 1: Move files**

```bash
git mv src/strategies/ruleset-strategy.ts src/settings/rulesets/
git mv src/strategies/github-ruleset-strategy.ts src/settings/rulesets/
```

**Step 2: Update imports in moved files**

Update relative paths:

- `../shared/` → `../../shared/`
- `../config/` → `../../config/`

**Step 3: Update ruleset-strategy.ts to import from types.ts**

**Step 4: Update src/settings/rulesets/index.ts**

Add exports for strategy files

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: move ruleset strategies to src/settings/rulesets/"
```

---

## Task 9: Create src/settings/repo-settings/types.ts

**Files:**

- Create: `src/settings/repo-settings/types.ts`

**Step 1: Create types.ts with repo settings interfaces**

```typescript
import type { RepoInfo } from "../../shared/repo-detector.js";
import type { GitHubRepoSettings } from "../../config/index.js";

export interface RepoSettingsStrategyOptions {
  token?: string;
  host?: string;
}

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
  web_commit_signoff_required?: boolean;
  default_branch?: string;
  security_and_analysis?: {
    secret_scanning?: { status: string };
    secret_scanning_push_protection?: { status: string };
    secret_scanning_validity_checks?: { status: string };
  };
  vulnerability_alerts?: boolean;
  automated_security_fixes?: boolean;
  private_vulnerability_reporting?: boolean;
}

export interface IRepoSettingsStrategy {
  getSettings(
    repoInfo: RepoInfo,
    options?: RepoSettingsStrategyOptions
  ): Promise<CurrentRepoSettings>;
  updateSettings(
    repoInfo: RepoInfo,
    settings: GitHubRepoSettings,
    options?: RepoSettingsStrategyOptions
  ): Promise<void>;
  setVulnerabilityAlerts(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void>;
  setAutomatedSecurityFixes(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void>;
  setPrivateVulnerabilityReporting(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void>;
}

export function isRepoSettingsStrategy(
  obj: unknown
): obj is IRepoSettingsStrategy {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const strategy = obj as Record<string, unknown>;
  return (
    typeof strategy.getSettings === "function" &&
    typeof strategy.updateSettings === "function" &&
    typeof strategy.setVulnerabilityAlerts === "function" &&
    typeof strategy.setAutomatedSecurityFixes === "function" &&
    typeof strategy.setPrivateVulnerabilityReporting === "function"
  );
}
```

**Step 2: Commit**

```bash
git add src/settings/repo-settings/types.ts && git commit -m "refactor: create src/settings/repo-settings/types.ts"
```

---

## Task 10: Move repo-settings strategies

**Files:**

- Move: `src/strategies/repo-settings-strategy.ts` → `src/settings/repo-settings/repo-settings-strategy.ts`
- Move: `src/strategies/github-repo-settings-strategy.ts` → `src/settings/repo-settings/github-repo-settings-strategy.ts`

**Step 1: Move files**

```bash
git mv src/strategies/repo-settings-strategy.ts src/settings/repo-settings/
git mv src/strategies/github-repo-settings-strategy.ts src/settings/repo-settings/
```

**Step 2: Update imports**

Update relative paths in moved files

**Step 3: Update repo-settings-strategy.ts to import from types.ts**

**Step 4: Update src/settings/repo-settings/index.ts**

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: move repo-settings strategies to src/settings/repo-settings/"
```

---

## Task 11: Delete src/strategies/ folder

**Files:**

- Delete: `src/strategies/index.ts`
- Delete: `src/strategies/` folder

**Step 1: Verify strategies folder is empty except index.ts**

Run: `ls src/strategies/`
Expected: Only `index.ts` remains

**Step 2: Delete folder**

```bash
rm -rf src/strategies/
```

**Step 3: Update all imports from src/strategies/**

Find and update:

- `../strategies/` → `../vcs/` or `../settings/rulesets/` or `../settings/repo-settings/`

**Step 4: Verify build**

Run: `npm run build`
Expected: Success

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: delete src/strategies/ folder"
```

---

## Task 12: Move test files to match new structure

**Files:**

- Move: `test/unit/strategies/*-pr-*.test.ts` → `test/unit/vcs/`
- Move: `test/unit/strategies/*-commit-*.test.ts` → `test/unit/vcs/`
- Move: `test/unit/strategies/*-ruleset-*.test.ts` → `test/unit/settings/rulesets/`
- Move: `test/unit/strategies/*-repo-settings-*.test.ts` → `test/unit/settings/repo-settings/`

**Step 1: Create test directories**

```bash
mkdir -p test/unit/vcs
mkdir -p test/unit/settings/repo-settings
```

**Step 2: Move VCS test files**

```bash
git mv test/unit/strategies/pr-strategy.test.ts test/unit/vcs/
git mv test/unit/strategies/github-pr-strategy.test.ts test/unit/vcs/
git mv test/unit/strategies/azure-pr-strategy.test.ts test/unit/vcs/
git mv test/unit/strategies/gitlab-pr-strategy.test.ts test/unit/vcs/
git mv test/unit/strategies/git-commit-strategy.test.ts test/unit/vcs/
git mv test/unit/strategies/graphql-commit-strategy.test.ts test/unit/vcs/
git mv test/unit/strategies/commit-strategy-selector.test.ts test/unit/vcs/
```

**Step 3: Move settings test files**

```bash
git mv test/unit/strategies/github-ruleset-strategy.test.ts test/unit/settings/rulesets/
git mv test/unit/strategies/repo-settings-strategy.test.ts test/unit/settings/repo-settings/
git mv test/unit/strategies/github-repo-settings-strategy.test.ts test/unit/settings/repo-settings/
```

**Step 4: Update imports in moved test files**

**Step 5: Delete empty test/unit/strategies/**

```bash
rmdir test/unit/strategies
```

**Step 6: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add -A && git commit -m "refactor: move test files to match new structure"
```

---

## Task 13: Update codecov.yml

**Files:**

- Modify: `codecov.yml`

**Step 1: Update ignore patterns**

```yaml
coverage:
  status:
    project:
      default:
        target: 95%
        threshold: 1%
        base: auto
    patch:
      default:
        target: 95%
        threshold: 1%

ignore:
  # Type-only files (no executable code)
  - "src/cli/types.ts"
  - "src/config/types.ts"
  - "src/sync/types.ts"
  - "src/vcs/types.ts"
  - "src/settings/rulesets/types.ts"
  - "src/settings/repo-settings/types.ts"

  # Re-export index files (no logic, just exports)
  - "src/cli/index.ts"
  - "src/config/index.ts"
  - "src/sync/index.ts"
  - "src/vcs/index.ts"
  - "src/shared/index.ts"
  - "src/output/index.ts"
  - "src/settings/index.ts"
  - "src/settings/rulesets/index.ts"
  - "src/settings/repo-settings/index.ts"

  # Test utilities
  - "test/mocks/**"

comment:
  layout: "reach,diff,flags,files"
  behavior: default
  require_changes: true
```

**Step 2: Commit**

```bash
git add codecov.yml && git commit -m "chore: update codecov.yml ignore patterns"
```

---

## Task 14: Update package.json test:coverage

**Files:**

- Modify: `package.json`

**Step 1: Update test:coverage script**

Update `--exclude` patterns:

```json
"test:coverage": "c8 --check-coverage --lines 95 --reporter=text --reporter=lcov --all --src=src --exclude='test/**/*.test.ts' --exclude='scripts/**' --exclude='src/vcs/types.ts' --exclude='src/settings/rulesets/types.ts' --exclude='src/settings/repo-settings/types.ts' --exclude='src/**/index.ts' --exclude='test/mocks/**' npm test"
```

**Step 2: Commit**

```bash
git add package.json && git commit -m "chore: update package.json coverage exclusions"
```

---

## Task 15: Final validation

**Step 1: Run full test suite**

Run: `npm test`
Expected: All 1697+ tests pass

**Step 2: Run linting**

Run: `./lint.sh`
Expected: Clean

**Step 3: Run build**

Run: `npm run build`
Expected: Success

**Step 4: Run coverage**

Run: `npm run test:coverage`
Expected: Passes 95% threshold

**Step 5: Verify no old references remain**

```bash
grep -r "src/git/" src/ test/ --include="*.ts" | grep -v node_modules || echo "Clean"
grep -r "src/strategies/" src/ test/ --include="*.ts" | grep -v node_modules || echo "Clean"
```

Expected: "Clean" for both

**Step 6: Create final commit if any changes**

```bash
git status
# If changes exist:
git add -A && git commit -m "refactor: final cleanup"
```

---

## Validation Checklist

- [ ] `npm test` passes
- [ ] `./lint.sh` passes
- [ ] `npm run build` succeeds
- [ ] `npm run test:coverage` passes 95% threshold
- [ ] No references to `src/git/` remain
- [ ] No references to `src/strategies/` remain
- [ ] All test files moved to match source structure
