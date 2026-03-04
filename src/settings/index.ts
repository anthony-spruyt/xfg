// Base processor
export {
  BaseSettingsProcessor,
  type BaseProcessorOptions,
  type BaseProcessorResult,
} from "./base-processor.js";

// Rulesets
export {
  computePropertyDiffs,
  deepEqual,
  isObject,
  isArrayOfObjects,
  type DiffAction,
  type PropertyDiff,
} from "./rulesets/index.js";

// Repo settings
export {
  isRepoSettingsStrategy,
  type IRepoSettingsStrategy,
  type CurrentRepoSettings,
  RepoSettingsProcessor,
  type IRepoSettingsProcessor,
  type RepoSettingsProcessorOptions,
  type RepoSettingsProcessorResult,
  diffRepoSettings,
  hasChanges,
  type RepoSettingsAction,
  type RepoSettingsChange,
  formatRepoSettingsPlan,
  type RepoSettingsPlanResult,
  type RepoSettingsPlanEntry,
  GitHubRepoSettingsStrategy,
} from "./repo-settings/index.js";

// Labels
export {
  type ILabelsStrategy,
  type GitHubLabel,
  normalizeColor,
  labelConfigToPayload,
  diffLabels,
  type LabelChange,
  type LabelAction,
  formatLabelsPlan,
  type LabelsPlanResult,
  type LabelsPlanEntry,
  LabelsProcessor,
  type ILabelsProcessor,
  type LabelsProcessorOptions,
  type LabelsProcessorResult,
  GitHubLabelsStrategy,
} from "./labels/index.js";
