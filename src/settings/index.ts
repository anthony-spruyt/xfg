// Base processor
export {
  type ISettingsProcessor,
  type SettingsAction,
} from "./base-processor.js";

// Rulesets
export {
  type PropertyDiff,
  formatPropertyTree,
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
