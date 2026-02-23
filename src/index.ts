// Public API for library consumers
export { runSync, runSettings } from "./cli/index.js";

export type {
  SyncOptions,
  SettingsOptions,
  SharedOptions,
} from "./cli/index.js";

export {
  type IRepositoryProcessor,
  type ProcessorFactory,
  defaultProcessorFactory,
  type IRulesetProcessor,
  type RulesetProcessorFactory,
  defaultRulesetProcessorFactory,
  type RepoSettingsProcessorFactory,
  defaultRepoSettingsProcessorFactory,
  type ILabelsProcessor,
  type LabelsProcessorFactory,
  defaultLabelsProcessorFactory,
} from "./cli/index.js";
