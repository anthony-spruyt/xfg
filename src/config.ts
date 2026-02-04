import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "yaml";
import type { ArrayMergeStrategy } from "./merge.js";
import { validateRawConfig } from "./config-validator.js";
import { normalizeConfig as normalizeConfigInternal } from "./config-normalizer.js";

export { normalizeConfigInternal as normalizeConfig };
import { resolveFileReferencesInConfig } from "./file-reference-resolver.js";

// Re-export formatter functions for backwards compatibility
export { convertContentToString } from "./config-formatter.js";

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

// =============================================================================
// Settings
// =============================================================================

export interface RepoSettings {
  /** GitHub rulesets keyed by name */
  rulesets?: Record<string, Ruleset>;
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

// =============================================================================
// Public API
// =============================================================================

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
