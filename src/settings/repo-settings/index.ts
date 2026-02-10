// Repo settings processor
export {
  RepoSettingsProcessor,
  type IRepoSettingsProcessor,
  type RepoSettingsProcessorOptions,
  type RepoSettingsProcessorResult,
} from "./processor.js";

// Repo settings diff
export {
  diffRepoSettings,
  hasChanges,
  type RepoSettingsAction,
  type RepoSettingsChange,
} from "./diff.js";

// Repo settings formatter
export {
  formatRepoSettingsPlan,
  type RepoSettingsPlanResult,
  type RepoSettingsPlanEntry,
} from "./formatter.js";
