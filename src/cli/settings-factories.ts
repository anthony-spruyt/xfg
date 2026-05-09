import {
  RulesetProcessor,
  RepoSettingsProcessor,
  LabelsProcessor,
  CodeScanningProcessor,
  GitHubRulesetStrategy,
  GitHubRepoSettingsStrategy,
  GitHubLabelsStrategy,
  GitHubCodeScanningStrategy,
} from "../settings/index.js";
import { GitHubRepoMetadataProvider } from "../repo/index.js";
import type { ShellCommandExecutor } from "../shared/command-executor.js";
import type {
  RulesetProcessorFactory,
  RepoSettingsProcessorFactory,
  LabelsProcessorFactory,
  CodeScanningProcessorFactory,
  SettingsProcessorFactories,
} from "./types.js";

export function createDefaultRulesetProcessorFactory(
  executor: ShellCommandExecutor
): RulesetProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new RulesetProcessor(new GitHubRulesetStrategy(executor, { cwd }));
}

export function createDefaultRepoSettingsProcessorFactory(
  executor: ShellCommandExecutor
): RepoSettingsProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new RepoSettingsProcessor(
      new GitHubRepoSettingsStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}

export function createDefaultLabelsProcessorFactory(
  executor: ShellCommandExecutor
): LabelsProcessorFactory {
  const cwd = process.cwd();
  return () => new LabelsProcessor(new GitHubLabelsStrategy(executor, { cwd }));
}

export function createDefaultCodeScanningProcessorFactory(
  executor: ShellCommandExecutor
): CodeScanningProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new CodeScanningProcessor(
      new GitHubCodeScanningStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}

export function createDefaultFactories(
  executor: ShellCommandExecutor,
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
  };
}
