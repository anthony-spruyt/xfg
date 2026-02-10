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

// Config formatting
export {
  convertContentToString,
  detectOutputFormat,
  type OutputFormat,
  type ConvertOptions,
} from "./formatter.js";

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
  stripMergeDirectives,
  createMergeContext,
  isTextContent,
  mergeTextContent,
  type ArrayMergeStrategy,
  type ArrayMergeHandler,
  type MergeContext,
} from "./merge.js";

// Validation
export {
  validateRawConfig,
  validateSettings,
  validateForSync,
  validateForSettings,
  hasActionableSettings,
} from "./validator.js";
