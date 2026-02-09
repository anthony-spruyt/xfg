# Refactor Phase 1: Create Domain Folders and Extract Types

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish domain boundaries by creating folder structure and extracting type definitions from config.ts to config/types.ts.

**Architecture:** Create domain folders first (empty), then extract types to config/types.ts, add barrel exports, and update all imports. This is a pure refactor - no behavioral changes.

**Tech Stack:** TypeScript, Node.js ESM (NodeNext module resolution, `.js` extensions in imports)

**Related Issues:** #435 (parent), #436 (this phase)

---

## Overview

Current state:

- `config.ts`: 551 lines (types: 1-519, loading logic: 520-552)
- 20+ files import types from `config.ts`
- All 1654 tests passing

Target state:

- `src/config/types.ts`: ~520 lines (all type definitions)
- `src/config/loader.ts`: ~35 lines (loadRawConfig, loadConfig functions)
- `src/config/index.ts`: barrel export re-exporting everything
- All 1654 tests still passing

---

## Task 1: Create Domain Folder Structure

**Files:**

- Create: `src/cli/.gitkeep`
- Create: `src/config/.gitkeep`
- Create: `src/config/validators/.gitkeep`
- Create: `src/git/.gitkeep`
- Create: `src/sync/.gitkeep`
- Create: `src/settings/.gitkeep`
- Create: `src/settings/rulesets/.gitkeep`
- Create: `src/settings/repo-settings/.gitkeep`
- Create: `src/shared/.gitkeep`

**Step 1: Create all domain folders with .gitkeep placeholders**

```bash
mkdir -p src/cli src/config/validators src/git src/sync src/settings/rulesets src/settings/repo-settings src/shared
touch src/cli/.gitkeep src/config/.gitkeep src/config/validators/.gitkeep src/git/.gitkeep src/sync/.gitkeep src/settings/.gitkeep src/settings/rulesets/.gitkeep src/settings/repo-settings/.gitkeep src/shared/.gitkeep
```

**Step 2: Verify folders exist**

Run: `ls -la src/`
Expected: New folders visible (cli, config, git, sync, settings, shared)

**Step 3: Run tests to confirm no breakage**

Run: `npm test`
Expected: 1654 tests pass

**Step 4: Commit**

```bash
git add src/cli src/config src/git src/sync src/settings src/shared
git commit -m "chore: create domain folder structure for refactor phase 1

Part of #435, #436"
```

---

## Task 2: Create config/types.ts with All Type Exports

**Files:**

- Create: `src/config/types.ts`
- Reference: `src/config.ts:14-519` (type definitions to extract)

**Step 1: Run tests to establish baseline**

Run: `npm test`
Expected: 1654 tests pass

**Step 2: Create config/types.ts with all type definitions**

Create `src/config/types.ts` containing all types from `src/config.ts` lines 14-519:

```typescript
import type { ArrayMergeStrategy } from "../merge.js";

// =============================================================================
// PR Merge Options Types
// =============================================================================

export type MergeMode = "manual" | "auto" | "force" | "direct";
export type MergeStrategy = "merge" | "squash" | "rebase";

export interface PRMergeOptions {
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
  bypassReason?: string;
}

// =============================================================================
// GitHub Rulesets Types (aligned with GitHub REST API)
// @see https://docs.github.com/en/rest/repos/rules
// =============================================================================

/** Ruleset target type */
export type RulesetTarget = "branch" | "tag";

/** Ruleset enforcement level */
export type RulesetEnforcement = "active" | "disabled" | "evaluate";

/** Bypass actor type */
export type BypassActorType = "Team" | "User" | "Integration";

/** Bypass mode - always bypass or only for PRs */
export type BypassMode = "always" | "pull_request";

/** Pattern operator for pattern-based rules */
export type PatternOperator =
  | "starts_with"
  | "ends_with"
  | "contains"
  | "regex";

/** Allowed merge methods */
export type MergeMethod = "merge" | "squash" | "rebase";

/** Code scanning alerts threshold */
export type AlertsThreshold = "none" | "errors" | "errors_and_warnings" | "all";

/** Security alerts threshold */
export type SecurityAlertsThreshold =
  | "none"
  | "critical"
  | "high_or_higher"
  | "medium_or_higher"
  | "all";

// =============================================================================
// Bypass Actors
// =============================================================================

export interface BypassActor {
  actorId: number;
  actorType: BypassActorType;
  bypassMode?: BypassMode;
}

// =============================================================================
// Conditions
// =============================================================================

export interface RefNameCondition {
  include?: string[];
  exclude?: string[];
}

export interface RulesetConditions {
  refName?: RefNameCondition;
}

// =============================================================================
// Rule Parameters
// =============================================================================

/** Status check in required_status_checks rule */
export interface StatusCheckConfig {
  context: string;
  integrationId?: number;
}

/** Reviewer configuration for pull_request rule (beta) */
export interface RequiredReviewer {
  filePatterns: string[];
  minimumApprovals: number;
  reviewer: {
    id: number;
    type: "Team";
  };
}

/** Code scanning tool configuration */
export interface CodeScanningTool {
  tool: string;
  alertsThreshold: AlertsThreshold;
  securityAlertsThreshold: SecurityAlertsThreshold;
}

/** Workflow configuration */
export interface WorkflowConfig {
  path: string;
  repositoryId: number;
  ref?: string;
  sha?: string;
}

// =============================================================================
// Rule Types (discriminated union)
// =============================================================================

export interface PullRequestRuleParameters {
  requiredApprovingReviewCount?: number;
  dismissStaleReviewsOnPush?: boolean;
  requireCodeOwnerReview?: boolean;
  requireLastPushApproval?: boolean;
  requiredReviewThreadResolution?: boolean;
  allowedMergeMethods?: MergeMethod[];
  requiredReviewers?: RequiredReviewer[];
}

export interface RequiredStatusChecksParameters {
  strictRequiredStatusChecksPolicy?: boolean;
  doNotEnforceOnCreate?: boolean;
  requiredStatusChecks?: StatusCheckConfig[];
}

export interface UpdateRuleParameters {
  updateAllowsFetchAndMerge?: boolean;
}

export interface RequiredDeploymentsParameters {
  requiredDeploymentEnvironments?: string[];
}

export interface CodeScanningParameters {
  codeScanningTools?: CodeScanningTool[];
}

export interface CodeQualityParameters {
  severity?: "errors" | "errors_and_warnings" | "all";
}

export interface WorkflowsParameters {
  doNotEnforceOnCreate?: boolean;
  workflows?: WorkflowConfig[];
}

export interface PatternRuleParameters {
  name?: string;
  negate?: boolean;
  operator: PatternOperator;
  pattern: string;
}

export interface FilePathRestrictionParameters {
  restrictedFilePaths?: string[];
}

export interface FileExtensionRestrictionParameters {
  restrictedFileExtensions?: string[];
}

export interface MaxFilePathLengthParameters {
  maxFilePathLength?: number;
}

export interface MaxFileSizeParameters {
  maxFileSize?: number;
}

// Rule type definitions
export interface PullRequestRule {
  type: "pull_request";
  parameters?: PullRequestRuleParameters;
}

export interface RequiredStatusChecksRule {
  type: "required_status_checks";
  parameters?: RequiredStatusChecksParameters;
}

export interface RequiredSignaturesRule {
  type: "required_signatures";
}

export interface RequiredLinearHistoryRule {
  type: "required_linear_history";
}

export interface NonFastForwardRule {
  type: "non_fast_forward";
}

export interface CreationRule {
  type: "creation";
}

export interface UpdateRule {
  type: "update";
  parameters?: UpdateRuleParameters;
}

export interface DeletionRule {
  type: "deletion";
}

export interface RequiredDeploymentsRule {
  type: "required_deployments";
  parameters?: RequiredDeploymentsParameters;
}

export interface CodeScanningRule {
  type: "code_scanning";
  parameters?: CodeScanningParameters;
}

export interface CodeQualityRule {
  type: "code_quality";
  parameters?: CodeQualityParameters;
}

export interface WorkflowsRule {
  type: "workflows";
  parameters?: WorkflowsParameters;
}

export interface CommitAuthorEmailPatternRule {
  type: "commit_author_email_pattern";
  parameters: PatternRuleParameters;
}

export interface CommitMessagePatternRule {
  type: "commit_message_pattern";
  parameters: PatternRuleParameters;
}

export interface CommitterEmailPatternRule {
  type: "committer_email_pattern";
  parameters: PatternRuleParameters;
}

export interface BranchNamePatternRule {
  type: "branch_name_pattern";
  parameters: PatternRuleParameters;
}

export interface TagNamePatternRule {
  type: "tag_name_pattern";
  parameters: PatternRuleParameters;
}

export interface FilePathRestrictionRule {
  type: "file_path_restriction";
  parameters?: FilePathRestrictionParameters;
}

export interface FileExtensionRestrictionRule {
  type: "file_extension_restriction";
  parameters?: FileExtensionRestrictionParameters;
}

export interface MaxFilePathLengthRule {
  type: "max_file_path_length";
  parameters?: MaxFilePathLengthParameters;
}

export interface MaxFileSizeRule {
  type: "max_file_size";
  parameters?: MaxFileSizeParameters;
}

/** Union of all rule types */
export type RulesetRule =
  | PullRequestRule
  | RequiredStatusChecksRule
  | RequiredSignaturesRule
  | RequiredLinearHistoryRule
  | NonFastForwardRule
  | CreationRule
  | UpdateRule
  | DeletionRule
  | RequiredDeploymentsRule
  | CodeScanningRule
  | CodeQualityRule
  | WorkflowsRule
  | CommitAuthorEmailPatternRule
  | CommitMessagePatternRule
  | CommitterEmailPatternRule
  | BranchNamePatternRule
  | TagNamePatternRule
  | FilePathRestrictionRule
  | FileExtensionRestrictionRule
  | MaxFilePathLengthRule
  | MaxFileSizeRule;

// =============================================================================
// Ruleset Configuration
// =============================================================================

/**
 * GitHub Ruleset configuration.
 * @see https://docs.github.com/en/rest/repos/rules
 */
export interface Ruleset {
  /** Target type: branch or tag */
  target?: RulesetTarget;
  /** Enforcement level */
  enforcement?: RulesetEnforcement;
  /** Actors who can bypass this ruleset */
  bypassActors?: BypassActor[];
  /** Conditions for when this ruleset applies */
  conditions?: RulesetConditions;
  /** Rules to enforce */
  rules?: RulesetRule[];
}

/**
 * Maps Ruleset config keys (camelCase) to GitHub API keys (snake_case).
 * TypeScript enforces this stays in sync with the Ruleset interface.
 */
export const RULESET_FIELD_MAP: Record<keyof Ruleset, string> = {
  target: "target",
  enforcement: "enforcement",
  bypassActors: "bypass_actors",
  conditions: "conditions",
  rules: "rules",
};

/**
 * Set of snake_case field names that are comparable between config and API.
 * Used as an allowlist — any API response field not in this set is ignored.
 */
export const RULESET_COMPARABLE_FIELDS = new Set(
  Object.values(RULESET_FIELD_MAP)
);

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
  webCommitSignoffRequired?: boolean;
  defaultBranch?: string;

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

// =============================================================================
// Settings
// =============================================================================

export interface RepoSettings {
  /** GitHub rulesets keyed by name */
  rulesets?: Record<string, Ruleset>;
  /** GitHub repository settings */
  repo?: GitHubRepoSettings;
  deleteOrphaned?: boolean;
}

// =============================================================================
// Raw Config Types (as parsed from YAML)
// =============================================================================

// Content can be object (JSON/YAML), string (text), or string[] (text lines)
export type ContentValue = Record<string, unknown> | string | string[];

// Per-file configuration at root level
export interface RawFileConfig {
  content?: ContentValue;
  mergeStrategy?: ArrayMergeStrategy;
  createOnly?: boolean;
  executable?: boolean;
  header?: string | string[];
  schemaUrl?: string;
  template?: boolean;
  vars?: Record<string, string>;
  deleteOrphaned?: boolean;
}

// Per-repo file override
export interface RawRepoFileOverride {
  content?: ContentValue;
  override?: boolean;
  createOnly?: boolean;
  executable?: boolean;
  header?: string | string[];
  schemaUrl?: string;
  template?: boolean;
  vars?: Record<string, string>;
  deleteOrphaned?: boolean;
}

// Raw settings (before normalization)
export interface RawRepoSettings {
  rulesets?: Record<string, Ruleset | false> & { inherit?: boolean };
  repo?: GitHubRepoSettings | false;
  deleteOrphaned?: boolean;
}

// Repo configuration
// files can map to false to exclude, or an object to override
// inherit: false skips all root files
export interface RawRepoConfig {
  git: string | string[];
  files?: Record<string, RawRepoFileOverride | false> & { inherit?: boolean };
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings;
}

// Root config structure
export interface RawConfig {
  id: string;
  files?: Record<string, RawFileConfig>;
  repos: RawRepoConfig[];
  prOptions?: PRMergeOptions;
  prTemplate?: string;
  githubHosts?: string[];
  deleteOrphaned?: boolean;
  settings?: RawRepoSettings;
}

// =============================================================================
// Normalized Config Types (output)
// =============================================================================

// File content for a single file in a repo
export interface FileContent {
  fileName: string;
  content: ContentValue | null;
  createOnly?: boolean;
  executable?: boolean;
  header?: string[];
  schemaUrl?: string;
  template?: boolean;
  vars?: Record<string, string>;
  deleteOrphaned?: boolean;
}

// Normalized repo config with all files to sync
export interface RepoConfig {
  git: string;
  files: FileContent[];
  prOptions?: PRMergeOptions;
  settings?: RepoSettings;
}

// Normalized config
export interface Config {
  id: string;
  repos: RepoConfig[];
  prTemplate?: string;
  githubHosts?: string[];
  deleteOrphaned?: boolean;
  settings?: RepoSettings;
}
```

**Step 3: Run tests (expected to still pass - types.ts not yet imported)**

Run: `npm test`
Expected: 1654 tests pass (types.ts exists but is orphaned)

**Step 4: Commit**

```bash
git add src/config/types.ts
git commit -m "feat: add config/types.ts with all type definitions

Extracted from config.ts. Not yet wired up - next step.
Part of #435, #436"
```

---

## Task 3: Create config/loader.ts with Loading Functions

**Files:**

- Create: `src/config/loader.ts`
- Reference: `src/config.ts:520-552` (loading logic to extract)

**Step 1: Create config/loader.ts with loading functions**

Create `src/config/loader.ts`:

```typescript
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "yaml";
import { validateRawConfig } from "../config-validator.js";
import { normalizeConfig as normalizeConfigInternal } from "../config-normalizer.js";
import { resolveFileReferencesInConfig } from "../file-reference-resolver.js";
import type { RawConfig, Config } from "./types.js";

export { normalizeConfigInternal as normalizeConfig };

/**
 * Load and validate raw config without normalization.
 * Use this when you need to perform command-specific validation before normalizing.
 */
export function loadRawConfig(filePath: string): RawConfig {
  const content = readFileSync(filePath, "utf-8");
  const configDir = dirname(filePath);

  let rawConfig: RawConfig;
  try {
    rawConfig = parse(content) as RawConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML config at ${filePath}: ${message}`);
  }

  // Resolve file references before validation so content type checking works
  rawConfig = resolveFileReferencesInConfig(rawConfig, { configDir });

  validateRawConfig(rawConfig);

  return rawConfig;
}

export function loadConfig(filePath: string): Config {
  const rawConfig = loadRawConfig(filePath);
  return normalizeConfigInternal(rawConfig);
}
```

**Step 2: Run tests (expected to still pass - loader.ts not yet imported)**

Run: `npm test`
Expected: 1654 tests pass

**Step 3: Commit**

```bash
git add src/config/loader.ts
git commit -m "feat: add config/loader.ts with loading functions

Extracted from config.ts. Not yet wired up - next step.
Part of #435, #436"
```

---

## Task 4: Create config/index.ts Barrel Export

**Files:**

- Create: `src/config/index.ts`
- Remove: `src/config/.gitkeep`

**Step 1: Create config/index.ts barrel export**

Create `src/config/index.ts`:

```typescript
// Re-export all types
export type {
  // PR Merge Options
  MergeMode,
  MergeStrategy,
  PRMergeOptions,
  // Rulesets
  RulesetTarget,
  RulesetEnforcement,
  BypassActorType,
  BypassMode,
  PatternOperator,
  MergeMethod,
  AlertsThreshold,
  SecurityAlertsThreshold,
  BypassActor,
  RefNameCondition,
  RulesetConditions,
  StatusCheckConfig,
  RequiredReviewer,
  CodeScanningTool,
  WorkflowConfig,
  PullRequestRuleParameters,
  RequiredStatusChecksParameters,
  UpdateRuleParameters,
  RequiredDeploymentsParameters,
  CodeScanningParameters,
  CodeQualityParameters,
  WorkflowsParameters,
  PatternRuleParameters,
  FilePathRestrictionParameters,
  FileExtensionRestrictionParameters,
  MaxFilePathLengthParameters,
  MaxFileSizeParameters,
  PullRequestRule,
  RequiredStatusChecksRule,
  RequiredSignaturesRule,
  RequiredLinearHistoryRule,
  NonFastForwardRule,
  CreationRule,
  UpdateRule,
  DeletionRule,
  RequiredDeploymentsRule,
  CodeScanningRule,
  CodeQualityRule,
  WorkflowsRule,
  CommitAuthorEmailPatternRule,
  CommitMessagePatternRule,
  CommitterEmailPatternRule,
  BranchNamePatternRule,
  TagNamePatternRule,
  FilePathRestrictionRule,
  FileExtensionRestrictionRule,
  MaxFilePathLengthRule,
  MaxFileSizeRule,
  RulesetRule,
  Ruleset,
  // Repo Settings
  SquashMergeCommitTitle,
  SquashMergeCommitMessage,
  MergeCommitTitle,
  MergeCommitMessage,
  RepoVisibility,
  GitHubRepoSettings,
  RepoSettings,
  // Raw Config
  ContentValue,
  RawFileConfig,
  RawRepoFileOverride,
  RawRepoSettings,
  RawRepoConfig,
  RawConfig,
  // Normalized Config
  FileContent,
  RepoConfig,
  Config,
} from "./types.js";

// Re-export values (non-type exports)
export { RULESET_FIELD_MAP, RULESET_COMPARABLE_FIELDS } from "./types.js";

// Re-export loading functions
export { loadRawConfig, loadConfig, normalizeConfig } from "./loader.js";

// Re-export formatter for backwards compatibility
export { convertContentToString } from "../config-formatter.js";
```

**Step 2: Remove .gitkeep placeholder**

```bash
rm src/config/.gitkeep
```

**Step 3: Run tests (expected to still pass - barrel not yet used)**

Run: `npm test`
Expected: 1654 tests pass

**Step 4: Commit**

```bash
git add src/config/index.ts
git rm src/config/.gitkeep 2>/dev/null || true
git commit -m "feat: add config/index.ts barrel export

Re-exports all types and functions from types.ts and loader.ts.
Part of #435, #436"
```

---

## Task 5: Update config.ts to Re-export from config/index.ts

**Files:**

- Modify: `src/config.ts` (replace content with re-exports)

**Step 1: Read current config.ts to understand what's exported**

Verify exports needed:

- Types: all from types.ts
- Values: RULESET_FIELD_MAP, RULESET_COMPARABLE_FIELDS
- Functions: loadRawConfig, loadConfig, normalizeConfig
- Re-export: convertContentToString from config-formatter.js

**Step 2: Replace config.ts with re-exports**

Replace entire `src/config.ts` with:

```typescript
// =============================================================================
// DEPRECATED: Import from "./config/index.js" instead
// This file exists for backwards compatibility during refactor.
// =============================================================================

// Re-export everything from the new location
export * from "./config/index.js";
```

**Step 3: Run tests**

Run: `npm test`
Expected: 1654 tests pass

**Step 4: Verify build compiles**

Run: `npm run build`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add src/config.ts
git commit -m "refactor: config.ts now re-exports from config/index.ts

All imports from './config.js' continue to work unchanged.
config.ts reduced from 551 lines to 7 lines.
Part of #435, #436"
```

---

## Task 6: Remove Remaining .gitkeep Placeholders

**Files:**

- Remove: All `.gitkeep` files (folders will be populated in future phases)

**Step 1: Remove all .gitkeep files**

```bash
rm -f src/cli/.gitkeep src/config/validators/.gitkeep src/git/.gitkeep src/sync/.gitkeep src/settings/.gitkeep src/settings/rulesets/.gitkeep src/settings/repo-settings/.gitkeep src/shared/.gitkeep
```

**Step 2: Note empty folders will not be tracked**

Empty folders (`cli/`, `git/`, `sync/`, `settings/`, `shared/`) won't be in git until they have files. This is expected - they'll be populated in future phases.

**Step 3: Run tests**

Run: `npm test`
Expected: 1654 tests pass

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove .gitkeep placeholders

Empty domain folders will be populated in subsequent refactor phases.
Part of #435, #436"
```

---

## Task 7: Run Full Verification

**Step 1: Run all tests**

Run: `npm test`
Expected: 1654 tests pass

**Step 2: Run linting**

Run: `./lint.sh`
Expected: No errors

**Step 3: Verify build**

Run: `npm run build`
Expected: Compiles without errors

**Step 4: Verify line counts**

Run: `wc -l src/config.ts src/config/types.ts src/config/loader.ts src/config/index.ts`
Expected:

- `src/config.ts`: ~7 lines
- `src/config/types.ts`: ~350 lines (types only, no loading)
- `src/config/loader.ts`: ~35 lines
- `src/config/index.ts`: ~80 lines

**Step 5: Final commit if any uncommitted changes**

```bash
git status
# If clean, skip. Otherwise:
git add -A
git commit -m "chore: final cleanup for refactor phase 1"
```

---

## Acceptance Criteria Checklist

- [ ] All 1654 tests pass
- [ ] No behavioral changes (pure refactor)
- [ ] `src/config.ts` reduced to ~7 lines (re-export only)
- [ ] `src/config/types.ts` contains all type definitions
- [ ] `src/config/loader.ts` contains loading logic
- [ ] `src/config/index.ts` barrel exports everything
- [ ] Domain folder structure created for future phases
- [ ] Linting passes
- [ ] Build compiles

---

## Files Changed Summary

| File                          | Action          | Lines    |
| ----------------------------- | --------------- | -------- |
| `src/config.ts`               | Modified        | 551 → ~7 |
| `src/config/types.ts`         | Created         | ~350     |
| `src/config/loader.ts`        | Created         | ~35      |
| `src/config/index.ts`         | Created         | ~80      |
| `src/cli/`                    | Created (empty) | -        |
| `src/git/`                    | Created (empty) | -        |
| `src/sync/`                   | Created (empty) | -        |
| `src/settings/rulesets/`      | Created (empty) | -        |
| `src/settings/repo-settings/` | Created (empty) | -        |
| `src/shared/`                 | Created (empty) | -        |
