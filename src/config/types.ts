import type { ArrayMergeStrategy } from "./merge.js";

export type MergeMode = "manual" | "auto" | "force" | "direct";
export type MergeStrategy = "merge" | "squash" | "rebase";

export interface PRMergeOptions {
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
  bypassReason?: string;
  labels?: string[];
}

export type RulesetTarget = "branch" | "tag";

export type RulesetEnforcement = "active" | "disabled" | "evaluate";

export type BypassActorType = "Team" | "User" | "Integration";

export type BypassMode = "always" | "pull_request";

type PatternOperator = "starts_with" | "ends_with" | "contains" | "regex";

export type MergeMethod = "merge" | "squash" | "rebase";

export type AlertsThreshold = "none" | "errors" | "errors_and_warnings" | "all";

export type SecurityAlertsThreshold =
  | "none"
  | "critical"
  | "high_or_higher"
  | "medium_or_higher"
  | "all";

export interface BypassActor {
  actorId: number;
  actorType: BypassActorType;
  bypassMode?: BypassMode;
}

interface RefNameCondition {
  include?: string[];
  exclude?: string[];
}

export interface RulesetConditions {
  refName?: RefNameCondition;
}

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
interface WorkflowConfig {
  path: string;
  repositoryId: number;
  ref?: string;
  sha?: string;
}

export interface PullRequestRuleParameters {
  requiredApprovingReviewCount?: number;
  dismissStaleReviewsOnPush?: boolean;
  requireCodeOwnerReview?: boolean;
  requireLastPushApproval?: boolean;
  requiredReviewThreadResolution?: boolean;
  allowedMergeMethods?: MergeMethod[];
  requiredReviewers?: RequiredReviewer[];
}

interface RequiredStatusChecksParameters {
  strictRequiredStatusChecksPolicy?: boolean;
  doNotEnforceOnCreate?: boolean;
  requiredStatusChecks?: StatusCheckConfig[];
}

interface UpdateRuleParameters {
  updateAllowsFetchAndMerge?: boolean;
}

interface RequiredDeploymentsParameters {
  requiredDeploymentEnvironments?: string[];
}

interface CodeScanningParameters {
  codeScanningTools?: CodeScanningTool[];
}

interface CodeQualityParameters {
  severity?: "errors" | "errors_and_warnings" | "all";
}

interface WorkflowsParameters {
  doNotEnforceOnCreate?: boolean;
  workflows?: WorkflowConfig[];
}

interface PatternRuleParameters {
  name?: string;
  negate?: boolean;
  operator: PatternOperator;
  pattern: string;
}

interface FilePathRestrictionParameters {
  restrictedFilePaths?: string[];
}

interface FileExtensionRestrictionParameters {
  restrictedFileExtensions?: string[];
}

interface MaxFilePathLengthParameters {
  maxFilePathLength?: number;
}

interface MaxFileSizeParameters {
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
const RULESET_FIELD_MAP: Record<keyof Ruleset, string> = {
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
  description?: string;
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

/**
 * GitHub label configuration.
 * @see https://docs.github.com/en/rest/issues/labels
 */
export interface Label {
  /** Hex color code (with or without #). Stripped on normalization. */
  color: string;
  /** Label description (max 100 characters) */
  description?: string;
  /** Rename target. Maps to GitHub API's new_name field. */
  new_name?: string;
}

export interface RepoSettings {
  /** GitHub rulesets keyed by name */
  rulesets?: Record<string, Ruleset>;
  /** GitHub repository settings */
  repo?: GitHubRepoSettings;
  /** GitHub labels keyed by name */
  labels?: Record<string, Label>;
  deleteOrphaned?: boolean;
}

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

// Group configuration (shared config layer between root and per-repo)
// Groups need the same file override capabilities as repos: file: false to remove,
// inherit: false to discard accumulated files. So files uses the repo-style type.
// Groups need inherit: false support on settings sub-sections (rulesets, labels),
// so settings uses RawRepoSettings (which has inherit on rulesets/labels).
export interface RawGroupConfig {
  files?: Record<string, RawFileConfig | RawRepoFileOverride | false> & {
    inherit?: boolean;
  };
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings;
}

// Root-level settings (before normalization) - inherit not valid here
export interface RawRootSettings {
  rulesets?: Record<string, Ruleset | false>;
  repo?: GitHubRepoSettings | false;
  labels?: Record<string, Label | false>;
  deleteOrphaned?: boolean;
}

// Per-repo settings (before normalization) - inherit controls whether root settings are inherited
export interface RawRepoSettings {
  rulesets?: Record<string, Ruleset | false> & { inherit?: boolean };
  repo?: GitHubRepoSettings | false;
  labels?: Record<string, Label | false> & { inherit?: boolean };
  deleteOrphaned?: boolean;
}

// Repo configuration
// files can map to false to exclude, or an object to override
// inherit: false skips all root files
export interface RawRepoConfig {
  git: string | string[];
  files?: Record<string, RawRepoFileOverride | false> & { inherit?: boolean };
  groups?: string[];
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings;
  /** Fork upstream repo if target doesn't exist */
  upstream?: string;
  /** Migrate from source repo if target doesn't exist */
  source?: string;
}

// Root config structure
export interface RawConfig {
  id: string;
  files?: Record<string, RawFileConfig>;
  groups?: Record<string, RawGroupConfig>;
  repos: RawRepoConfig[];
  prOptions?: PRMergeOptions;
  prTemplate?: string;
  githubHosts?: string[];
  deleteOrphaned?: boolean;
  settings?: RawRootSettings;
}

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
  /** Fork upstream repo if target doesn't exist */
  upstream?: string;
  /** Migrate from source repo if target doesn't exist */
  source?: string;
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
