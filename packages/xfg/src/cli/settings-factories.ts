import {
  RulesetProcessor,
  RepoSettingsProcessor,
  LabelsProcessor,
  CodeScanningProcessor,
  VariablesProcessor,
  CollaboratorsProcessor,
  EnvironmentsProcessor,
  GitHubRulesetStrategy,
  GitHubRepoSettingsStrategy,
  GitHubLabelsStrategy,
  GitHubCodeScanningStrategy,
  GitHubVariablesStrategy,
  GitHubCollaboratorsStrategy,
  GitHubEnvironmentsStrategy,
} from "../settings/index.js";
import { GitHubRepoMetadataProvider } from "../repo/index.js";
import type { ProcessExecutor } from "../shared/command-executor.js";
import type {
  RulesetProcessorFactory,
  RepoSettingsProcessorFactory,
  LabelsProcessorFactory,
  CodeScanningProcessorFactory,
  VariablesProcessorFactory,
  CollaboratorsProcessorFactory,
  EnvironmentsProcessorFactory,
  SettingsProcessorFactories,
} from "./types.js";

export function createDefaultRulesetProcessorFactory(
  executor: ProcessExecutor
): RulesetProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new RulesetProcessor(new GitHubRulesetStrategy(executor, { cwd }));
}

export function createDefaultRepoSettingsProcessorFactory(
  executor: ProcessExecutor
): RepoSettingsProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new RepoSettingsProcessor(
      new GitHubRepoSettingsStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}

export function createDefaultLabelsProcessorFactory(
  executor: ProcessExecutor
): LabelsProcessorFactory {
  const cwd = process.cwd();
  return () => new LabelsProcessor(new GitHubLabelsStrategy(executor, { cwd }));
}

export function createDefaultCodeScanningProcessorFactory(
  executor: ProcessExecutor
): CodeScanningProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new CodeScanningProcessor(
      new GitHubCodeScanningStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}

export function createDefaultVariablesProcessorFactory(
  executor: ProcessExecutor
): VariablesProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new VariablesProcessor(new GitHubVariablesStrategy(executor, { cwd }));
}

export function createDefaultCollaboratorsProcessorFactory(
  executor: ProcessExecutor
): CollaboratorsProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new CollaboratorsProcessor(
      new GitHubCollaboratorsStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}

export function createDefaultEnvironmentsProcessorFactory(
  executor: ProcessExecutor
): EnvironmentsProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new EnvironmentsProcessor(
      new GitHubEnvironmentsStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}

export function createDefaultFactories(
  executor: ProcessExecutor,
  overrides?: Partial<SettingsProcessorFactories>
): SettingsProcessorFactories {
  return {
    rulesets:
      overrides?.rulesets ?? createDefaultRulesetProcessorFactory(executor),
    labels: overrides?.labels ?? createDefaultLabelsProcessorFactory(executor),
    repo:
      overrides?.repo ?? createDefaultRepoSettingsProcessorFactory(executor),
    codeScanning:
      overrides?.codeScanning ??
      createDefaultCodeScanningProcessorFactory(executor),
    variables:
      overrides?.variables ?? createDefaultVariablesProcessorFactory(executor),
    collaborators:
      overrides?.collaborators ??
      createDefaultCollaboratorsProcessorFactory(executor),
    environments:
      overrides?.environments ??
      createDefaultEnvironmentsProcessorFactory(executor),
  };
}
