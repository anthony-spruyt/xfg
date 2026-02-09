// CLI command implementations
export { runSync, SyncOptions, SharedOptions } from "./sync-command.js";
export { runSettings, SettingsOptions } from "./settings-command.js";

// Processor interfaces and factories for dependency injection
export {
  IRepositoryProcessor,
  ProcessorFactory,
  defaultProcessorFactory,
  IRulesetProcessor,
  RulesetProcessorFactory,
  defaultRulesetProcessorFactory,
  RepoSettingsProcessorFactory,
  defaultRepoSettingsProcessorFactory,
  IRepoSettingsProcessor,
} from "./types.js";
