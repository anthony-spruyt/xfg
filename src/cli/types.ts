import type { MergeMode, MergeStrategy, RepoConfig } from "../config/index.js";
import type { IRepoLifecycleManager } from "../lifecycle/index.js";
import type { IRepositoryProcessor, FileChangeDetail } from "../sync/index.js";
import type {
  ISettingsProcessor,
  IRulesetProcessor,
  IRepoSettingsProcessor,
  ILabelsProcessor,
  ICodeScanningProcessor,
  BaseProcessorResult,
} from "../settings/index.js";
import type { RepoInfo } from "../repo/index.js";
import type { ResultsCollector } from "./results-collector.js";
import type { Logger } from "../shared/logger.js";

export type ProcessorFactory = () => IRepositoryProcessor;

export type SettingsProcessorFactory<T extends ISettingsProcessor> = () => T;

export type RulesetProcessorFactory =
  SettingsProcessorFactory<IRulesetProcessor>;
export type RepoSettingsProcessorFactory =
  SettingsProcessorFactory<IRepoSettingsProcessor>;
export type LabelsProcessorFactory = SettingsProcessorFactory<ILabelsProcessor>;
export type CodeScanningProcessorFactory =
  SettingsProcessorFactory<ICodeScanningProcessor>;

export type SettingsKind = "rulesets" | "labels" | "repo" | "codeScanning";

export interface SettingsProcessorFactories {
  rulesets: RulesetProcessorFactory;
  labels: LabelsProcessorFactory;
  repo: RepoSettingsProcessorFactory;
  codeScanning: CodeScanningProcessorFactory;
}

/**
 * Dependencies for the sync command (dependency injection).
 */
export interface SyncDependencies {
  processorFactory?: ProcessorFactory;
  lifecycleManager?: IRepoLifecycleManager;
  settingsProcessorFactories?: Partial<SettingsProcessorFactories>;
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
  fileChanges: FileChangeDetail[];
  prUrl?: string;
  mergeOutcome?: MergeMode;
  error?: string;
}

export interface SettingsResult extends BaseProcessorResult {
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
  factories: SettingsProcessorFactories;
  logger: Logger;
}
