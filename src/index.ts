// Public API for library consumers
export { runSync } from "./cli/index.js";

export type { SyncOptions, SharedOptions } from "./cli/index.js";

export {
  type IRepositoryProcessor,
  type ProcessorFactory,
  type IRulesetProcessor,
  type RulesetProcessorFactory,
  type RepoSettingsProcessorFactory,
  type ILabelsProcessor,
  type LabelsProcessorFactory,
} from "./cli/index.js";
