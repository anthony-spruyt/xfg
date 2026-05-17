// Base processor
export {
  type BaseProcessorResult,
  type ISettingsProcessor,
  type SettingsAction,
  type ActiveAction,
  countActions,
  isActiveAction,
} from "./base-processor.js";

// Rulesets
export {
  type PropertyDiff,
  type RulesetPlanEntry,
  RulesetProcessor,
  type IRulesetProcessor,
  GitHubRulesetStrategy,
} from "./rulesets/index.js";

// Repo settings
export {
  RepoSettingsProcessor,
  type IRepoSettingsProcessor,
  type RepoSettingsPlanEntry,
  GitHubRepoSettingsStrategy,
} from "./repo-settings/index.js";

// Labels
export {
  type LabelsPlanEntry,
  LabelsProcessor,
  type ILabelsProcessor,
  GitHubLabelsStrategy,
} from "./labels/index.js";

// Code scanning
export {
  type CodeScanningPlanEntry,
  CodeScanningProcessor,
  type ICodeScanningProcessor,
  GitHubCodeScanningStrategy,
} from "./code-scanning/index.js";

// Variables
export {
  type VariablesPlanEntry,
  VariablesProcessor,
  type IVariablesProcessor,
  GitHubVariablesStrategy,
} from "./variables/index.js";
