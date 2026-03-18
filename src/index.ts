// Public API for library consumers
export { runSync } from "./cli/index.js";

export type { SyncOptions, SharedOptions } from "./cli/index.js";

export {
  type ProcessorFactory,
  type RulesetProcessorFactory,
  type RepoSettingsProcessorFactory,
  type LabelsProcessorFactory,
} from "./cli/index.js";

export type { IRepositoryProcessor } from "./sync/index.js";
export type { IRulesetProcessor, ILabelsProcessor } from "./settings/index.js";
