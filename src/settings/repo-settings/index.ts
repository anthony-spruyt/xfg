// Types
export {
  isRepoSettingsStrategy,
  type IRepoSettingsStrategy,
  type RepoSettingsStrategyOptions,
  type CurrentRepoSettings,
} from "./types.js";

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

// Repo settings strategies
export { GitHubRepoSettingsStrategy } from "./github-repo-settings-strategy.js";
