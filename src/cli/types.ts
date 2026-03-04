import type { MergeMode, MergeStrategy } from "../config/index.js";
import type { IRepoLifecycleManager } from "../lifecycle/index.js";
import {
  RepositoryProcessor,
  type IRepositoryProcessor,
} from "../sync/index.js";
import {
  RulesetProcessor,
  type IRulesetProcessor,
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

export interface SharedOptions {
  config: string;
  dryRun?: boolean;
  workDir?: string;
  retries?: number;
  noDelete?: boolean;
}

export interface SyncOptions extends SharedOptions {
  branch?: string;
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
}

export interface SyncResultEntry {
  repoName: string;
  success: boolean;
  fileChanges: Array<{ path: string; action: "create" | "update" | "delete" }>;
  prUrl?: string;
  mergeOutcome?: "manual" | "auto" | "force" | "direct";
  error?: string;
}

export interface SettingsResult {
  success: boolean;
  message: string;
  skipped?: boolean;
  planOutput?: { lines?: string[] };
  warnings?: string[];
}

/**
 * Context for applying repo settings (rulesets, labels, repo config).
 * Groups parameters that were previously passed individually.
 */
export interface ApplyRepoSettingsContext {
  repoConfig: import("../config/index.js").RepoConfig;
  repoInfo: import("../shared/repo-detector.js").RepoInfo;
  repoName: string;
  current: number;
  options: SyncOptions;
  tokenManager: ReturnType<typeof import("../vcs/index.js").createTokenManager>;
  settingsCollector: import("./results-collector.js").ResultsCollector;
  rulesetProcessorFactory: NonNullable<
    SyncDependencies["rulesetProcessorFactory"]
  >;
  repoSettingsProcessorFactory: NonNullable<
    SyncDependencies["repoSettingsProcessorFactory"]
  >;
  labelsProcessorFactory: NonNullable<
    SyncDependencies["labelsProcessorFactory"]
  >;
}

// Re-export for convenience
export type { IRepoSettingsProcessor, ILabelsProcessor };
