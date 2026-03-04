import { RepoConfig } from "../config/index.js";
import { RepoInfo } from "../shared/repo-detector.js";
import type { IRepoLifecycleManager } from "../lifecycle/index.js";
import {
  RepositoryProcessor,
  type ProcessorResult,
  type ProcessorOptions,
  type IRepositoryProcessor,
} from "../sync/index.js";
import {
  RulesetProcessor,
  type IRulesetProcessor,
  RulesetProcessorOptions,
  RulesetProcessorResult,
} from "../settings/rulesets/processor.js";
import {
  RepoSettingsProcessor,
  type IRepoSettingsProcessor,
} from "../settings/repo-settings/processor.js";
import {
  LabelsProcessor,
  type ILabelsProcessor,
} from "../settings/labels/processor.js";

export type { IRepositoryProcessor, IRulesetProcessor };

export type ProcessorFactory = () => IRepositoryProcessor;

/**
 * Default factory that creates a real RepositoryProcessor.
 */
export const defaultProcessorFactory: ProcessorFactory = () =>
  new RepositoryProcessor();

/**
 * Factory function type for creating ruleset processors.
 */
export type RulesetProcessorFactory = () => IRulesetProcessor;

/**
 * Default factory that creates a real RulesetProcessor.
 */
export const defaultRulesetProcessorFactory: RulesetProcessorFactory = () =>
  new RulesetProcessor();

/**
 * Repo settings processor factory function type.
 */
export type RepoSettingsProcessorFactory = () => IRepoSettingsProcessor;

/**
 * Default factory that creates a real RepoSettingsProcessor.
 */
export const defaultRepoSettingsProcessorFactory: RepoSettingsProcessorFactory =
  () => new RepoSettingsProcessor();

/**
 * Labels processor interface for dependency injection in tests.
 */
export type LabelsProcessorFactory = () => ILabelsProcessor;

/**
 * Default factory that creates a real LabelsProcessor.
 */
export const defaultLabelsProcessorFactory: LabelsProcessorFactory = () =>
  new LabelsProcessor();

/**
 * Dependencies for the sync command (dependency injection).
 */
export interface SyncDependencies {
  processorFactory?: ProcessorFactory;
  lifecycleManager?: IRepoLifecycleManager;
  rulesetProcessorFactory?: RulesetProcessorFactory;
  repoSettingsProcessorFactory?: RepoSettingsProcessorFactory;
  labelsProcessorFactory?: LabelsProcessorFactory;
}

// Re-export for convenience
export type { IRepoSettingsProcessor, ILabelsProcessor };
