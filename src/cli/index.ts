export { runSync } from "./sync-command.js";

export {
  type IRepositoryProcessor,
  type ProcessorFactory,
  type IRulesetProcessor,
  type RulesetProcessorFactory,
  type RepoSettingsProcessorFactory,
  type ILabelsProcessor,
  type LabelsProcessorFactory,
  defaultProcessorFactory,
  defaultRulesetProcessorFactory,
  defaultRepoSettingsProcessorFactory,
  defaultLabelsProcessorFactory,
} from "./types.js";

export type { SyncOptions, SharedOptions } from "./sync-command.js";
