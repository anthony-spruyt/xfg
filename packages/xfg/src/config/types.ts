import type { ArrayMergeStrategy } from "./merge.js";

export type MergeMode = "manual" | "auto" | "force" | "direct";
export type MergeStrategy = "merge" | "squash" | "rebase";

export type AiProvider = "anthropic" | "openai";

export interface AiProviderConfig {
  provider?: AiProvider;
  model?: string;
  baseUrl?: string;
  /** Name of the env var that holds the base URL; exclusive with `baseUrl` */
  baseUrlEnv?: string;
  apiKeyEnv?: string;
  /** Extra request headers: header name to the env var that holds its value */
  headersEnv?: Record<string, string>;
  prompt?: string;
  maxDiffChars?: number;
}

export interface AiConfig extends AiProviderConfig {
  /** Tried when the primary provider fails; one level only */
  fallback?: AiProviderConfig;
}

export type ResolvedAiProviderConfig = AiProviderConfig & {
  provider: AiProvider;
};

export type ResolvedAiConfig = ResolvedAiProviderConfig & {
  fallback?: ResolvedAiProviderConfig;
};

export interface PRMergeOptions {
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
  bypassReason?: string;
  labels?: string[];
  branch?: string;
  ai?: boolean | AiConfig;
}

/** prOptions of a group or repo layer; `inherit: false` drops everything inherited. */
export interface RawPRMergeOptions extends PRMergeOptions {
  inherit?: boolean;
}

export type RepoPROptions = Omit<PRMergeOptions, "ai"> & {
  ai?: ResolvedAiConfig;
};

export type RulesetTarget = "branch" | "tag";

export type RulesetEnforcement = "active" | "disabled" | "evaluate";

export type BypassActorType = "Team" | "User" | "Integration";

export type BypassMode = "always" | "pull_request" | "exempt";

type PatternOperator = "starts_with" | "ends_with" | "contains" | "regex";

export type MergeMethod = "merge" | "squash" | "rebase";

export type AlertsThreshold = "none" | "errors" | "errors_and_warnings" | "all";

export type SecurityAlertsThreshold =
  "none" | "critical" | "high_or_higher" | "medium_or_higher" | "all";

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

export interface StatusCheckConfig {
  context: string;
  integrationId?: number;
}

export interface RequiredReviewer {
  filePatterns: string[];
  minimumApprovals: number;
  reviewer: {
    id: number;
    type: "Team";
  };
}

export interface CodeScanningTool {
  tool: string;
  alertsThreshold: AlertsThreshold;
  securityAlertsThreshold: SecurityAlertsThreshold;
}

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
  target?: RulesetTarget;
  enforcement?: RulesetEnforcement;
  bypassActors?: BypassActor[];
  conditions?: RulesetConditions;
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

export type SquashMergeCommitTitle = "PR_TITLE" | "COMMIT_OR_PR_TITLE";

export type SquashMergeCommitMessage = "PR_BODY" | "COMMIT_MESSAGES" | "BLANK";

export type MergeCommitTitle = "PR_TITLE" | "MERGE_MESSAGE";

export type MergeCommitMessage = "PR_BODY" | "PR_TITLE" | "BLANK";

export type RepoVisibility = "public" | "private" | "internal";

/**
 * GitHub repository settings configuration.
 * All properties are optional - only specified properties are applied.
 * @see https://docs.github.com/en/rest/repos/repos#update-a-repository
 */
export interface GitHubRepoSettings {
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

export type CodeScanningState = "configured" | "not-configured";
export type CodeScanningQuerySuite = "default" | "extended";
export type CodeScanningLanguage =
  | "actions"
  | "c-cpp"
  | "csharp"
  | "go"
  | "java-kotlin"
  | "javascript-typescript"
  | "python"
  | "ruby"
  | "swift";

export interface CodeScanningSettings {
  state: CodeScanningState;
  querySuite?: CodeScanningQuerySuite;
  languages?: CodeScanningLanguage[];
}

export type ActionsAllowedActions = "all" | "local_only" | "selected";
export type ActionsDefaultWorkflowPermissions = "read" | "write";
export type ActionsForkPrApprovalPolicy =
  | "first_time_contributors_new_to_github"
  | "first_time_contributors"
  | "all_external_contributors";

/**
 * GitHub Actions repository settings.
 * @see https://docs.github.com/en/rest/actions/permissions
 */
export interface ActionsSettings {
  enabled?: boolean;
  allowedActions?: ActionsAllowedActions;
  shaPinningRequired?: boolean;
  /** Only applies when allowedActions is `selected` */
  githubOwnedAllowed?: boolean;
  /** Only applies when allowedActions is `selected` */
  verifiedAllowed?: boolean;
  /** Only applies when allowedActions is `selected`; `!` prefix blocks a pattern */
  patternsAllowed?: string[];
  defaultWorkflowPermissions?: ActionsDefaultWorkflowPermissions;
  /** Covers creating pull requests as well as approving them */
  canApprovePullRequestReviews?: boolean;
  forkPrApprovalPolicy?: ActionsForkPrApprovalPolicy;
  artifactAndLogRetentionDays?: number;
  cacheRetentionDays?: number;
  cacheSizeGb?: number;
}

/** Fields of the selected-actions endpoint; GitHub only accepts them when allowedActions is `selected`. */
export const ACTIONS_SELECTED_FIELDS = [
  "githubOwnedAllowed",
  "verifiedAllowed",
  "patternsAllowed",
] as const satisfies ReadonlyArray<keyof ActionsSettings>;

export interface SecretConfig {
  env: string;
}

/** Raw secrets map: entries keyed by name, plus the `deleteOrphaned` peer key. */
export type SecretsConfig = Record<string, SecretConfig | boolean> & {
  deleteOrphaned?: boolean;
};

export type DeploymentBranchPatternType = "branch" | "tag";

export interface DeploymentBranchPattern {
  type: DeploymentBranchPatternType;
  /** fnmatch-style name pattern, e.g. `main` or `v*.*.*` */
  name: string;
}

/** Exactly one of `protectedBranches: true` or a non-empty `custom` list. */
export interface DeploymentBranchPolicy {
  protectedBranches?: boolean;
  custom?: DeploymentBranchPattern[];
  /** Delete patterns on GitHub that are not in `custom` */
  deleteOrphaned?: boolean;
}

export interface EnvironmentConfig {
  /** Omitted: any branch can deploy */
  deploymentBranchPolicy?: DeploymentBranchPolicy;
  /** Environment secrets keyed by name; only `xfg secrets sync` writes them */
  secrets?: Record<string, SecretConfig> & { deleteOrphaned?: boolean };
}

export interface RawEnvironmentConfig {
  /** `false` clears an inherited policy so any branch can deploy */
  deploymentBranchPolicy?: DeploymentBranchPolicy | false;
  secrets?: Record<string, SecretConfig | false> & { deleteOrphaned?: boolean };
}

/** Environments keyed by name, plus the `deleteOrphaned` peer key. */
export type EnvironmentsConfig = Record<string, EnvironmentConfig> & {
  deleteOrphaned?: boolean;
};

export interface CollaboratorsConfig {
  /** GitHub usernames granted write access (personal repos only) */
  users?: string[];
  /** Remove users xfg added (tracked in .xfg.json) once they leave the config */
  deleteOrphaned?: boolean;
}

export interface RawCollaboratorsConfig extends CollaboratorsConfig {
  inherit?: boolean;
}

export interface RepoSettings {
  rulesets?: Record<string, Ruleset>;
  repo?: GitHubRepoSettings;
  labels?: Record<string, Label>;
  codeScanning?: CodeScanningSettings;
  actions?: ActionsSettings;
  variables?: Record<string, string> & { deleteOrphaned?: boolean };
  secrets?: Record<string, SecretConfig> & { deleteOrphaned?: boolean };
  collaborators?: CollaboratorsConfig;
  environments?: EnvironmentsConfig;
  deleteOrphaned?: boolean;
}

export type ContentValue = Record<string, unknown> | string | string[];

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
  extends?: string | string[];
  files?: Record<string, RawFileConfig | RawRepoFileOverride | false> & {
    inherit?: boolean;
  };
  prOptions?: RawPRMergeOptions;
  settings?: RawRepoSettings;
}

export interface RawConditionalGroupWhen {
  /** All listed groups must be present in the repo's effective group set */
  allOf?: string[];
  /** At least one listed group must be present */
  anyOf?: string[];
  /** None of the listed groups may be present */
  noneOf?: string[];
}

export interface RawConditionalGroupConfig {
  when: RawConditionalGroupWhen;
  /** File definitions or overrides (same capabilities as regular groups) */
  files?: Record<string, RawFileConfig | RawRepoFileOverride | false> & {
    inherit?: boolean;
  };
  prOptions?: RawPRMergeOptions;
  settings?: RawRepoSettings;
}

// Root-level settings (before normalization) - inherit not valid here
export interface RawRootSettings {
  rulesets?: Record<string, Ruleset | false>;
  repo?: GitHubRepoSettings | false;
  labels?: Record<string, Label | false>;
  codeScanning?: CodeScanningSettings | false;
  actions?: ActionsSettings | false;
  variables?: Record<string, string | false> & { deleteOrphaned?: boolean };
  secrets?: SecretsConfig;
  collaborators?: CollaboratorsConfig;
  environments?: Record<string, RawEnvironmentConfig | false> & {
    deleteOrphaned?: boolean;
  };
  deleteOrphaned?: boolean;
}

// Per-repo settings (before normalization) - inherit controls whether root settings are inherited
export interface RawRepoSettings {
  rulesets?: Record<string, Ruleset | false> & { inherit?: boolean };
  repo?: (GitHubRepoSettings & { inherit?: boolean }) | false;
  labels?: Record<string, Label | false> & { inherit?: boolean };
  codeScanning?: CodeScanningSettings | false;
  actions?: (ActionsSettings & { inherit?: boolean }) | false;
  variables?: Record<string, string | false> & {
    inherit?: boolean;
    deleteOrphaned?: boolean;
  };
  secrets?: SecretsConfig & { inherit?: boolean };
  collaborators?: RawCollaboratorsConfig;
  environments?: Record<string, RawEnvironmentConfig | false> & {
    inherit?: boolean;
    deleteOrphaned?: boolean;
  };
  deleteOrphaned?: boolean;
}

// files can map to false to exclude, or an object to override
// inherit: false skips all root files
export interface RawRepoConfig {
  git: string | string[];
  files?: Record<string, RawRepoFileOverride | false> & { inherit?: boolean };
  groups?: string[];
  prOptions?: RawPRMergeOptions;
  settings?: RawRepoSettings;
  /** Fork upstream repo if target doesn't exist */
  upstream?: string;
  /** Migrate from source repo if target doesn't exist */
  source?: string;
}

export interface RawConfig {
  id: string;
  files?: Record<string, RawFileConfig>;
  groups?: Record<string, RawGroupConfig>;
  conditionalGroups?: RawConditionalGroupConfig[];
  repos: RawRepoConfig[];
  prOptions?: PRMergeOptions;
  prTemplate?: string;
  githubHosts?: string[];
  deleteOrphaned?: boolean;
  settings?: RawRootSettings;
}

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

export interface RepoConfig {
  git: string;
  files: FileContent[];
  prOptions?: RepoPROptions;
  settings?: RepoSettings;
  /** Fork upstream repo if target doesn't exist */
  upstream?: string;
  /** Migrate from source repo if target doesn't exist */
  source?: string;
}

export interface Config {
  id: string;
  repos: RepoConfig[];
  prTemplate?: string;
  githubHosts?: string[];
  deleteOrphaned?: boolean;
  settings?: RepoSettings;
}
