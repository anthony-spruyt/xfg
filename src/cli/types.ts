import { RepoConfig } from "../config.js";
import { RepoInfo } from "../repo-detector.js";
import {
  ProcessorResult,
  ProcessorOptions,
  RepositoryProcessor,
} from "../repository-processor.js";
import {
  RulesetProcessor,
  RulesetProcessorOptions,
  RulesetProcessorResult,
} from "../ruleset-processor.js";
import {
  RepoSettingsProcessor,
  type IRepoSettingsProcessor,
} from "../repo-settings-processor.js";

/**
 * Processor interface for dependency injection in tests.
 */
export interface IRepositoryProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult>;
  updateManifestOnly(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: ProcessorOptions,
    manifestUpdate: { rulesets: string[] }
  ): Promise<ProcessorResult>;
}

/**
 * Factory function type for creating processors.
 */
export type ProcessorFactory = () => IRepositoryProcessor;

/**
 * Default factory that creates a real RepositoryProcessor.
 */
export const defaultProcessorFactory: ProcessorFactory = () =>
  new RepositoryProcessor();

/**
 * Ruleset processor interface for dependency injection in tests.
 */
export interface IRulesetProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: RulesetProcessorOptions
  ): Promise<RulesetProcessorResult>;
}

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

// Re-export IRepoSettingsProcessor for convenience
export type { IRepoSettingsProcessor };
