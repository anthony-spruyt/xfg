import type { MergeMode, MergeStrategy, RepoConfig } from "../config/index.js";
import type { IRepoLifecycleManager } from "../lifecycle/index.js";
import {
  RepositoryProcessor,
  type IRepositoryProcessor,
} from "../sync/index.js";
import {
  type ISettingsProcessor,
  RulesetProcessor,
  type IRulesetProcessor,
  RepoSettingsProcessor,
  type IRepoSettingsProcessor,
  LabelsProcessor,
  type ILabelsProcessor,
} from "../settings/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ResultsCollector } from "./results-collector.js";

export type { IRepositoryProcessor, IRulesetProcessor };

export type ProcessorFactory = () => IRepositoryProcessor;

/**
 * Default factory that creates a real RepositoryProcessor.
 */
export const defaultProcessorFactory: ProcessorFactory = () =>
  new RepositoryProcessor();

/**
 * Generic factory type for settings processors.
 */
export type SettingsProcessorFactory<T extends ISettingsProcessor> = () => T;

export type RulesetProcessorFactory =
  SettingsProcessorFactory<IRulesetProcessor>;
export type RepoSettingsProcessorFactory =
  SettingsProcessorFactory<IRepoSettingsProcessor>;
export type LabelsProcessorFactory = SettingsProcessorFactory<ILabelsProcessor>;

export const defaultRulesetProcessorFactory: RulesetProcessorFactory = () =>
  new RulesetProcessor();

export const defaultRepoSettingsProcessorFactory: RepoSettingsProcessorFactory =
  () => new RepoSettingsProcessor();

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
  repoConfig: RepoConfig;
  repoInfo: RepoInfo;
  repoName: string;
  current: number;
  options: SyncOptions;
  token: string | undefined;
  settingsCollector: ResultsCollector;
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
