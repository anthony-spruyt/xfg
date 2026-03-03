// CLI command implementations
export { runSync } from "./sync-command.js";

// Export types - using 'export type' for type aliases, but interfaces need special handling
// For ESM compatibility, re-export everything from types.js
export {
  // Interfaces (can be imported without 'type' keyword)
  type IRepositoryProcessor,
  type ProcessorFactory,
  type IRulesetProcessor,
  type RulesetProcessorFactory,
  type RepoSettingsProcessorFactory,
  type ILabelsProcessor,
  type LabelsProcessorFactory,
  // Runtime values
  defaultProcessorFactory,
  defaultRulesetProcessorFactory,
  defaultRepoSettingsProcessorFactory,
  defaultLabelsProcessorFactory,
} from "./types.js";

// Export command option types
export type { SyncOptions, SharedOptions } from "./sync-command.js";
