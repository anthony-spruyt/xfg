import type { MergeMode, MergeStrategy, RepoConfig } from "../config/index.js";
import type { IRepoLifecycleManager } from "../lifecycle/index.js";
import type { IRepositoryProcessor } from "../sync/index.js";
import type {
  ISettingsProcessor,
  IRulesetProcessor,
  IRepoSettingsProcessor,
  ILabelsProcessor,
} from "../settings/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ResultsCollector } from "./results-collector.js";

export type ProcessorFactory = () => IRepositoryProcessor;

export type SettingsProcessorFactory<T extends ISettingsProcessor> = () => T;

export type RulesetProcessorFactory =
  SettingsProcessorFactory<IRulesetProcessor>;
export type RepoSettingsProcessorFactory =
  SettingsProcessorFactory<IRepoSettingsProcessor>;
export type LabelsProcessorFactory = SettingsProcessorFactory<ILabelsProcessor>;

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
  fileChanges: Array<{
    path: string;
    action: "create" | "update" | "delete";
    diffLines?: string[];
  }>;
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
  repoNumber: number;
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
