# Phase 6: Organize Files by Domain - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all remaining files from `src/` root into domain folders, leaving only entry points in root.

**Architecture:** Batch-based migration organized by dependency order. Move foundational utilities first, then domain-specific code. Each batch includes moving files, updating imports, adding barrel exports, and running tests.

**Tech Stack:** TypeScript, ES modules, git mv for history preservation

---

## Current State Analysis

**Files remaining in `src/` root after Phases 1-5:** 35 files

**Existing domain folders:**

- `cli/` - commands and CLI types (complete)
- `config/` - types, loader, validators (partial)
- `settings/rulesets/` - diff-algorithm (partial)
- `sync/` - branch-manager, file-writer, manifest-manager (partial)
- `git/` - empty (.gitkeep)
- `shared/` - empty (.gitkeep)
- `strategies/` - all strategy files (complete)

**Target:** Only `index.ts` and `cli.ts` remain in `src/` root.

---

## Migration Batches

| Batch | Domain    | Files | Dependencies              |
| ----- | --------- | ----- | ------------------------- |
| 1     | shared/   | 8     | None                      |
| 2     | git/      | 4     | shared                    |
| 3     | config/   | 4     | shared                    |
| 4     | output/   | 4     | config, sync (types only) |
| 5     | sync/     | 4     | shared, config, git       |
| 6     | settings/ | 7     | shared, config, output    |
| 7     | Cleanup   | 2     | All batches complete      |

---

## Task 1: Move shared utilities to shared/

**Files:**

- Move: `src/logger.ts` → `src/shared/logger.ts`
- Move: `src/retry-utils.ts` → `src/shared/retry-utils.ts`
- Move: `src/command-executor.ts` → `src/shared/command-executor.ts`
- Move: `src/shell-utils.ts` → `src/shared/shell-utils.ts`
- Move: `src/sanitize-utils.ts` → `src/shared/sanitize-utils.ts`
- Move: `src/env.ts` → `src/shared/env.ts`
- Move: `src/workspace-utils.ts` → `src/shared/workspace-utils.ts`
- Move: `src/repo-detector.ts` → `src/shared/repo-detector.ts`
- Create: `src/shared/index.ts`

**Step 1: Move files using git mv**

```bash
git mv src/logger.ts src/shared/logger.ts
git mv src/retry-utils.ts src/shared/retry-utils.ts
git mv src/command-executor.ts src/shared/command-executor.ts
git mv src/shell-utils.ts src/shared/shell-utils.ts
git mv src/sanitize-utils.ts src/shared/sanitize-utils.ts
git mv src/env.ts src/shared/env.ts
git mv src/workspace-utils.ts src/shared/workspace-utils.ts
git mv src/repo-detector.ts src/shared/repo-detector.ts
rm src/shared/.gitkeep
```

**Step 2: Create barrel export**

Create `src/shared/index.ts`:

```typescript
// Logging
export { logger, LogLevel, setLogLevel, type Logger } from "./logger.js";

// Retry utilities
export {
  withRetry,
  type RetryOptions,
  type RetryableOperation,
} from "./retry-utils.js";

// Command execution
export {
  executeCommand,
  type CommandResult,
  type ExecuteCommandOptions,
} from "./command-executor.js";

// Shell utilities
export { escapeShellArg } from "./shell-utils.js";

// Sanitization
export { sanitizeForLogging } from "./sanitize-utils.js";

// Environment
export {
  getEnv,
  requireEnv,
  interpolateEnvVars,
  escapeEnvInterpolation,
} from "./env.js";

// Workspace utilities
export { getWorkspaceRoot } from "./workspace-utils.js";

// Repository detection
export {
  detectRepoType,
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
  isAzureDevOpsRepo,
  isGitLabRepo,
  type RepoType,
  type RepoInfo,
  type GitHubRepoInfo,
  type AzureDevOpsRepoInfo,
  type GitLabRepoInfo,
  type RepoDetectorContext,
} from "./repo-detector.js";
```

**Step 3: Update imports in moved files**

The shared files have minimal internal dependencies. Check and update:

- `command-executor.ts` imports from `sanitize-utils.js` → `./sanitize-utils.js` (already relative, no change needed)
- `retry-utils.ts` imports from `logger.js` → `./logger.js` (already relative, no change needed)

**Step 4: Update imports in consuming files**

Search and replace imports. Files that import from shared utilities:

```bash
# Find files importing these modules
grep -r "from \"\.\/logger" src/ --include="*.ts" | grep -v "src/shared/"
grep -r "from \"\.\/retry-utils" src/ --include="*.ts" | grep -v "src/shared/"
grep -r "from \"\.\/command-executor" src/ --include="*.ts" | grep -v "src/shared/"
grep -r "from \"\.\/shell-utils" src/ --include="*.ts" | grep -v "src/shared/"
grep -r "from \"\.\/sanitize-utils" src/ --include="*.ts" | grep -v "src/shared/"
grep -r "from \"\.\/env" src/ --include="*.ts" | grep -v "src/shared/"
grep -r "from \"\.\/workspace-utils" src/ --include="*.ts" | grep -v "src/shared/"
grep -r "from \"\.\/repo-detector" src/ --include="*.ts" | grep -v "src/shared/"
```

Update pattern for each file in `src/`:

- `from "./logger.js"` → `from "./shared/logger.js"`
- `from "./retry-utils.js"` → `from "./shared/retry-utils.js"`
- etc.

Update pattern for files in `src/cli/`, `src/config/`, `src/sync/`, `src/settings/`:

- `from "../logger.js"` → `from "../shared/logger.js"`
- etc.

**Step 5: Update test imports**

```bash
grep -r "from \"\.\.\/src\/logger" test/ --include="*.ts"
grep -r "from \"\.\.\/src\/retry-utils" test/ --include="*.ts"
# ... etc for each file
```

Update pattern:

- `from "../src/logger.js"` → `from "../src/shared/logger.js"`

**Step 6: Run tests**

```bash
npm run build && npm test
```

Expected: All 1,654+ tests pass.

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(shared): move utility files to shared/ domain

Move foundational utilities to src/shared/:
- logger.ts - logging infrastructure
- retry-utils.ts - retry logic for network operations
- command-executor.ts - shell command execution
- shell-utils.ts - shell argument escaping
- sanitize-utils.ts - log sanitization
- env.ts - environment variable handling
- workspace-utils.ts - workspace path resolution
- repo-detector.ts - git URL parsing and repo type detection

Add barrel export for clean imports.

Part of #441 (Phase 6: Organize files by domain)"
```

---

## Task 2: Move git operations to git/

**Files:**

- Move: `src/git-ops.ts` → `src/git/git-ops.ts`
- Move: `src/authenticated-git-ops.ts` → `src/git/authenticated-git-ops.ts`
- Move: `src/pr-creator.ts` → `src/git/pr-creator.ts`
- Move: `src/github-app-token-manager.ts` → `src/git/github-app-token-manager.ts`
- Create: `src/git/index.ts`

**Step 1: Move files using git mv**

```bash
git mv src/git-ops.ts src/git/git-ops.ts
git mv src/authenticated-git-ops.ts src/git/authenticated-git-ops.ts
git mv src/pr-creator.ts src/git/pr-creator.ts
git mv src/github-app-token-manager.ts src/git/github-app-token-manager.ts
rm src/git/.gitkeep
```

**Step 2: Update imports within moved files**

In `src/git/git-ops.ts`:

- `from "./logger.js"` → `from "../shared/logger.js"`
- `from "./command-executor.js"` → `from "../shared/command-executor.js"`
- `from "./shell-utils.js"` → `from "../shared/shell-utils.js"`

In `src/git/authenticated-git-ops.ts`:

- `from "./git-ops.js"` → `from "./git-ops.js"` (same directory, no change)
- `from "./logger.js"` → `from "../shared/logger.js"`

In `src/git/pr-creator.ts`:

- `from "./command-executor.js"` → `from "../shared/command-executor.js"`
- `from "./logger.js"` → `from "../shared/logger.js"`
- `from "./repo-detector.js"` → `from "../shared/repo-detector.js"`

In `src/git/github-app-token-manager.ts`:

- `from "./logger.js"` → `from "../shared/logger.js"`

**Step 3: Create barrel export**

Create `src/git/index.ts`:

```typescript
// Core git operations
export {
  GitOps,
  type IGitOps,
  type CloneOptions,
  type CommitOptions,
  type PushOptions,
} from "./git-ops.js";

// Authenticated git operations (with per-command auth)
export {
  AuthenticatedGitOps,
  type IAuthenticatedGitOps,
  type AuthenticatedCloneOptions,
} from "./authenticated-git-ops.js";

// PR creation
export {
  createPR,
  enableAutoMerge,
  mergePR,
  type PROptions,
  type PRResult,
  type MergeResult,
} from "./pr-creator.js";

// GitHub App token management
export {
  GitHubAppTokenManager,
  type TokenInfo,
} from "./github-app-token-manager.js";
```

**Step 4: Update imports in consuming files**

Files that import git modules (search and update):

- `src/sync/branch-manager.ts`
- `src/repository-processor.ts`
- `src/cli/sync-command.ts`
- `src/cli/settings-command.ts`
- Various strategy files

Update patterns:

- In `src/*.ts`: `from "./git-ops.js"` → `from "./git/git-ops.js"`
- In `src/cli/*.ts`: `from "../git-ops.js"` → `from "../git/git-ops.js"`
- In `src/sync/*.ts`: `from "../git-ops.js"` → `from "../git/git-ops.js"`
- In `src/strategies/*.ts`: `from "../git-ops.js"` → `from "../git/git-ops.js"`

**Step 5: Update test imports**

Update all test files importing git modules.

**Step 6: Run tests**

```bash
npm run build && npm test
```

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(git): move git operations to git/ domain

Move git-related files to src/git/:
- git-ops.ts - core git operations (clone, commit, push)
- authenticated-git-ops.ts - per-command auth wrapper
- pr-creator.ts - PR creation and merge operations
- github-app-token-manager.ts - GitHub App authentication

Add barrel export for clean imports.

Part of #441 (Phase 6: Organize files by domain)"
```

---

## Task 3: Move config files to config/

**Files:**

- Move: `src/config-normalizer.ts` → `src/config/normalizer.ts`
- Move: `src/config-formatter.ts` → `src/config/formatter.ts`
- Move: `src/file-reference-resolver.ts` → `src/config/file-reference-resolver.ts`
- Move: `src/merge.ts` → `src/config/merge.ts`
- Update: `src/config/index.ts` (add new exports)
- Delete: `src/config.ts` (backwards compat re-export)
- Delete: `src/config-validator.ts` (if it's just a re-export)

**Step 1: Check config-validator.ts status**

Read `src/config-validator.ts` to see if it's a re-export or has code.

**Step 2: Move files using git mv**

```bash
git mv src/config-normalizer.ts src/config/normalizer.ts
git mv src/config-formatter.ts src/config/formatter.ts
git mv src/file-reference-resolver.ts src/config/file-reference-resolver.ts
git mv src/merge.ts src/config/merge.ts
```

**Step 3: Update imports within moved files**

In `src/config/normalizer.ts`:

- `from "./config.js"` → `from "./index.js"` or `from "./types.js"`
- `from "./env.js"` → `from "../shared/env.js"`
- `from "./file-reference-resolver.js"` → `from "./file-reference-resolver.js"`
- `from "./merge.js"` → `from "./merge.js"`

In `src/config/formatter.ts`:

- `from "./config.js"` → `from "./types.js"`

In `src/config/file-reference-resolver.ts`:

- `from "./config.js"` → `from "./types.js"`

In `src/config/merge.ts`:

- No config imports typically

**Step 4: Update barrel export**

Update `src/config/index.ts` to add new exports:

```typescript
// ... existing exports ...

// Config normalization
export { normalizeConfig } from "./normalizer.js";

// Config formatting
export { convertContentToString } from "./formatter.js";

// File reference resolution
export {
  isFileReference,
  resolveFileReference,
  type FileReferenceOptions,
} from "./file-reference-resolver.js";

// Deep merge utilities
export {
  arrayMergeStrategies,
  deepMerge,
  type ArrayMergeStrategy,
  type ArrayMergeHandler,
  type MergeContext,
} from "./merge.js";
```

**Step 5: Update imports in consuming files**

Search for imports of moved files and update paths.

**Step 6: Delete backwards compat files**

```bash
git rm src/config.ts
```

If `src/config-validator.ts` is just a re-export:

```bash
git rm src/config-validator.ts
```

**Step 7: Run tests**

```bash
npm run build && npm test
```

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor(config): consolidate config files in config/ domain

Move config-related files to src/config/:
- config-normalizer.ts → normalizer.ts
- config-formatter.ts → formatter.ts
- file-reference-resolver.ts
- merge.ts

Remove backwards-compat re-export files.
Update barrel export with all config functionality.

Part of #441 (Phase 6: Organize files by domain)"
```

---

## Task 4: Create output/ domain for plan formatting

**Files:**

- Create: `src/output/` directory
- Move: `src/plan-formatter.ts` → `src/output/plan-formatter.ts`
- Move: `src/plan-summary.ts` → `src/output/plan-summary.ts`
- Move: `src/github-summary.ts` → `src/output/github-summary.ts`
- Move: `src/summary-utils.ts` → `src/output/summary-utils.ts`
- Create: `src/output/index.ts`

**Step 1: Create directory and move files**

```bash
mkdir -p src/output
git mv src/plan-formatter.ts src/output/plan-formatter.ts
git mv src/plan-summary.ts src/output/plan-summary.ts
git mv src/github-summary.ts src/output/github-summary.ts
git mv src/summary-utils.ts src/output/summary-utils.ts
```

**Step 2: Update imports within moved files**

In `src/output/plan-summary.ts`:

- `from "./plan-formatter.js"` → `from "./plan-formatter.js"` (same dir)

In `src/output/summary-utils.ts`:

- `from "./repository-processor.js"` → `from "../sync/repository-processor.js"` (after sync move) or keep as `../repository-processor.js` for now
- `from "./config.js"` → `from "../config/index.js"`
- `from "./github-summary.js"` → `from "./github-summary.js"`
- `from "./diff-utils.js"` → `from "../sync/diff-utils.js"` (after sync move) or keep for now

In `src/output/github-summary.ts`:

- No internal imports typically

**Step 3: Create barrel export**

Create `src/output/index.ts`:

```typescript
// Plan formatting (console output with chalk)
export {
  formatResourceId,
  formatResourceLine,
  formatPlanSummary,
  formatPlan,
  printPlan,
  type ResourceType,
  type ResourceAction,
  type Resource,
  type ResourceDetails,
  type PropertyChange,
  type PlanCounts,
  type Plan,
  type RepoError,
} from "./plan-formatter.js";

// Plan summary (markdown output for GitHub)
export { formatPlanMarkdown, writePlanToSummary } from "./plan-summary.js";

// GitHub Actions summary
export {
  writeSummary,
  type MergeOutcome,
  type FileChanges,
  type RulesetPlanDetail,
  type RepoSettingsPlanDetail,
  type RepoResult,
  type SummaryData,
} from "./github-summary.js";

// Summary utilities
export {
  getMergeOutcome,
  toFileChanges,
  buildRepoResult,
  buildErrorResult,
} from "./summary-utils.js";
```

**Step 4: Update imports in consuming files**

Update all files that import plan-formatter, plan-summary, github-summary, summary-utils.

**Step 5: Run tests**

```bash
npm run build && npm test
```

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(output): create output/ domain for plan formatting

Create src/output/ for plan and summary formatting:
- plan-formatter.ts - console output with chalk colors
- plan-summary.ts - markdown output for GitHub
- github-summary.ts - GitHub Actions step summary
- summary-utils.ts - result building utilities

Add barrel export for clean imports.

Part of #441 (Phase 6: Organize files by domain)"
```

---

## Task 5: Complete sync/ domain

**Files:**

- Move: `src/repository-processor.ts` → `src/sync/repository-processor.ts`
- Move: `src/manifest.ts` → `src/sync/manifest.ts`
- Move: `src/diff-utils.ts` → `src/sync/diff-utils.ts`
- Move: `src/xfg-template.ts` → `src/sync/xfg-template.ts`
- Update: `src/sync/index.ts`

**Step 1: Move files**

```bash
git mv src/repository-processor.ts src/sync/repository-processor.ts
git mv src/manifest.ts src/sync/manifest.ts
git mv src/diff-utils.ts src/sync/diff-utils.ts
git mv src/xfg-template.ts src/sync/xfg-template.ts
```

**Step 2: Update imports within moved files**

In `src/sync/repository-processor.ts`:

- `from "./config.js"` → `from "../config/index.js"`
- `from "./git-ops.js"` → `from "../git/git-ops.js"`
- `from "./authenticated-git-ops.js"` → `from "../git/authenticated-git-ops.js"`
- `from "./pr-creator.js"` → `from "../git/pr-creator.js"`
- `from "./logger.js"` → `from "../shared/logger.js"`
- `from "./manifest.js"` → `from "./manifest.js"`
- `from "./diff-utils.js"` → `from "./diff-utils.js"`
- `from "./xfg-template.js"` → `from "./xfg-template.js"`
- `from "./sync/file-writer.js"` → `from "./file-writer.js"`
- `from "./sync/branch-manager.js"` → `from "./branch-manager.js"`
- `from "./sync/manifest-manager.js"` → `from "./manifest-manager.js"`

In `src/sync/manifest.ts`:

- Update any imports as needed

In `src/sync/diff-utils.ts`:

- Update any imports as needed

In `src/sync/xfg-template.ts`:

- `from "./config.js"` → `from "../config/index.js"`
- `from "./repo-detector.js"` → `from "../shared/repo-detector.js"`

**Step 3: Update barrel export**

Update `src/sync/index.ts`:

```typescript
// ... existing exports ...

// Repository processor
export {
  RepositoryProcessor,
  type ProcessorResult,
  type ProcessorOptions,
} from "./repository-processor.js";

// Manifest handling
export {
  parseManifest,
  serializeManifest,
  type ManifestFile,
  type Manifest,
} from "./manifest.js";

// Diff utilities
export {
  computeDiff,
  computeDiffStats,
  formatDiffLine,
  type DiffResult,
  type DiffStats,
} from "./diff-utils.js";

// XFG templating
export { processXfgTemplate, type XfgTemplateContext } from "./xfg-template.js";
```

**Step 4: Update imports in consuming files**

Update all files importing these modules.

**Step 5: Run tests**

```bash
npm run build && npm test
```

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(sync): complete sync/ domain with remaining files

Move sync-related files to src/sync/:
- repository-processor.ts - main sync orchestration
- manifest.ts - managed files tracking
- diff-utils.ts - file diff computation
- xfg-template.ts - repository-specific templating

Update barrel export with all sync functionality.

Part of #441 (Phase 6: Organize files by domain)"
```

---

## Task 6: Complete settings/ domain

**Files:**

- Create: `src/settings/repo-settings/` directory
- Move: `src/ruleset-processor.ts` → `src/settings/rulesets/processor.ts`
- Move: `src/ruleset-diff.ts` → `src/settings/rulesets/diff.ts`
- Move: `src/ruleset-plan-formatter.ts` → `src/settings/rulesets/formatter.ts`
- Move: `src/repo-settings-processor.ts` → `src/settings/repo-settings/processor.ts`
- Move: `src/repo-settings-diff.ts` → `src/settings/repo-settings/diff.ts`
- Move: `src/repo-settings-plan-formatter.ts` → `src/settings/repo-settings/formatter.ts`
- Move: `src/resource-converters.ts` → `src/settings/resource-converters.ts`
- Create: `src/settings/index.ts`
- Create: `src/settings/repo-settings/index.ts`
- Update: `src/settings/rulesets/index.ts`

**Step 1: Create directories and move files**

```bash
mkdir -p src/settings/repo-settings

# Rulesets
git mv src/ruleset-processor.ts src/settings/rulesets/processor.ts
git mv src/ruleset-diff.ts src/settings/rulesets/diff.ts
git mv src/ruleset-plan-formatter.ts src/settings/rulesets/formatter.ts

# Repo settings
git mv src/repo-settings-processor.ts src/settings/repo-settings/processor.ts
git mv src/repo-settings-diff.ts src/settings/repo-settings/diff.ts
git mv src/repo-settings-plan-formatter.ts src/settings/repo-settings/formatter.ts

# Shared
git mv src/resource-converters.ts src/settings/resource-converters.ts
```

**Step 2: Update imports within moved files**

Update all imports in moved files to reflect new paths.

**Step 3: Create/update barrel exports**

Update `src/settings/rulesets/index.ts`:

```typescript
// Diff algorithm
export {
  computePropertyDiffs,
  diffObjectArrays,
  deepEqual,
  isObject,
  isArrayOfObjects,
  type DiffAction,
  type PropertyDiff,
} from "./diff-algorithm.js";

// Ruleset processor
export {
  RulesetProcessor,
  type RulesetProcessorResult,
  type RulesetPlanEntry,
} from "./processor.js";

// Ruleset diff
export { computeRulesetDiff, type RulesetDiffResult } from "./diff.js";

// Ruleset formatter
export { formatRulesetPlan, type RulesetPlanOutput } from "./formatter.js";
```

Create `src/settings/repo-settings/index.ts`:

```typescript
// Repo settings processor
export {
  RepoSettingsProcessor,
  type RepoSettingsProcessorResult,
} from "./processor.js";

// Repo settings diff
export {
  computeRepoSettingsDiff,
  type RepoSettingsDiffResult,
} from "./diff.js";

// Repo settings formatter
export { formatRepoSettingsPlan } from "./formatter.js";
```

Create `src/settings/index.ts`:

```typescript
// Rulesets
export * from "./rulesets/index.js";

// Repo settings
export * from "./repo-settings/index.js";

// Resource converters
export {
  rulesetResultToResources,
  repoSettingsResultToResources,
  processorResultToResources,
} from "./resource-converters.js";
```

**Step 4: Update imports in consuming files**

Update all files importing these modules.

**Step 5: Run tests**

```bash
npm run build && npm test
```

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(settings): complete settings/ domain organization

Move settings-related files:
- Rulesets: processor, diff, formatter → settings/rulesets/
- Repo settings: processor, diff, formatter → settings/repo-settings/
- resource-converters.ts → settings/

Create barrel exports for clean imports.

Part of #441 (Phase 6: Organize files by domain)"
```

---

## Task 7: Final cleanup and verification

**Files:**

- Verify: Only `index.ts` and `cli.ts` remain in `src/` root
- Update: `src/index.ts` imports if needed
- Clean: Remove any remaining `.gitkeep` files
- Run: Full test suite and lint

**Step 1: Verify src/ root contents**

```bash
ls src/*.ts
```

Expected output:

```
src/cli.ts
src/index.ts
```

**Step 2: Update src/index.ts imports**

Ensure all imports in `src/index.ts` use the new paths:

- `from "./config.js"` → `from "./config/index.js"`
- etc.

**Step 3: Run full test suite**

```bash
npm run build && npm test
```

Expected: All tests pass.

**Step 4: Run linting**

```bash
./lint.sh
```

Expected: No errors.

**Step 5: Final commit**

```bash
git add -A
git commit -m "refactor: complete Phase 6 - organize files by domain

Final cleanup:
- Verify only entry points remain in src/ root
- Update all imports to use domain folders
- All 1,654+ tests passing

Closes #441

Directory structure:
src/
├── cli/          # CLI commands
├── config/       # Configuration handling
├── git/          # Git operations
├── output/       # Plan formatting and summaries
├── settings/     # Rulesets and repo settings
├── shared/       # Cross-cutting utilities
├── strategies/   # Platform strategies
├── sync/         # Sync operations
├── cli.ts        # CLI entry point
└── index.ts      # Main entry point"
```

---

## Verification Checklist

- [ ] All files moved to appropriate domain folders
- [ ] Barrel exports created for each domain
- [ ] All imports updated (source and test files)
- [ ] Only `index.ts` and `cli.ts` in `src/` root
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (1,654+ tests)
- [ ] `./lint.sh` passes
- [ ] Git history preserved (used `git mv`)

---

## Rollback Plan

If issues arise mid-migration:

```bash
git checkout main -- src/
npm run build && npm test
```

Each task creates a commit, so partial progress is preserved.
