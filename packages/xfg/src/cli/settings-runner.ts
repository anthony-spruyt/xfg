import type { RepoConfig } from "../config/index.js";
import { isGitHubRepo, type RepoInfo } from "../repo/index.js";
import type { ISettingsProcessor } from "../settings/index.js";
import type { BaseProcessorOptions } from "../settings/base-processor.js";
import type { Logger } from "../shared/logger.js";
import { toErrorMessage } from "../shared/type-guards.js";
import type {
  SettingsResult,
  ApplyRepoSettingsContext,
  SettingsKind,
} from "./types.js";
import type { ResultsCollector } from "./results-collector.js";
import type { ProcessorResults } from "./settings-report-builder.js";

interface SettingsDescriptor {
  key: SettingsKind;
  label: string;
  run: () => Promise<SettingsResult>;
}

function logWarnings(logger: Logger, warnings: string[] | undefined): void {
  for (const warning of warnings ?? []) {
    logger.warn(warning);
  }
}

function logPlanLines(logger: Logger, header: string, lines: string[]): void {
  logger.info("");
  logger.info(header);
  for (const line of lines) {
    logger.info(line);
  }
}

function logSettingsResult(
  logger: Logger,
  result: SettingsResult,
  label: string,
  repoNumber: number,
  repoName: string,
  settingsCollector: ResultsCollector
): void {
  const planLines = result.planOutput?.lines;
  if (planLines?.length) {
    logPlanLines(logger, `${repoName} - ${label}:`, planLines);
  } else if (!result.skipped && result.success) {
    logger.success(repoNumber, repoName, `${label}: ${result.message}`);
  }
  if (planLines?.length || result.skipped || result.success) {
    logWarnings(logger, result.warnings);
  }
  if (!result.success && !result.skipped) {
    logger.error(repoNumber, repoName, `${label}: ${result.message}`);
    settingsCollector.appendError(repoName, result.message);
  }
}

async function runAndStoreResult<TResult extends SettingsResult>(
  factory: () => ISettingsProcessor<BaseProcessorOptions, TResult>,
  repoConfig: RepoConfig,
  repoInfo: RepoInfo,
  opts: { dryRun?: boolean; noDelete?: boolean; token?: string },
  repoName: string,
  settingsCollector: ResultsCollector,
  assign: (entry: ProcessorResults, result: TResult) => void
): Promise<TResult> {
  const result = await factory().process(repoConfig, repoInfo, opts);
  if (!result.skipped) {
    assign(settingsCollector.findOrCreate(repoName), result);
  }
  return result;
}

function buildSettingsDescriptors(
  ctx: ApplyRepoSettingsContext
): SettingsDescriptor[] {
  const { repoConfig, repoInfo, options, token, repoName, settingsCollector } =
    ctx;
  const { factories } = ctx;
  const sharedOpts = {
    dryRun: options.dryRun,
    noDelete: options.noDelete,
    token,
  };

  return [
    {
      key: "rulesets" as const,
      label: "Rulesets",
      run: () =>
        runAndStoreResult(
          factories.rulesets,
          repoConfig,
          repoInfo,
          sharedOpts,
          repoName,
          settingsCollector,
          (e, r) => {
            e.rulesetResult = r;
          }
        ),
    },
    {
      key: "labels" as const,
      label: "Labels",
      run: () =>
        runAndStoreResult(
          factories.labels,
          repoConfig,
          repoInfo,
          sharedOpts,
          repoName,
          settingsCollector,
          (e, r) => {
            e.labelsResult = r;
          }
        ),
    },
    {
      key: "repo" as const,
      label: "Repo Settings",
      run: () =>
        runAndStoreResult(
          factories.repo,
          repoConfig,
          repoInfo,
          { dryRun: options.dryRun, token },
          repoName,
          settingsCollector,
          (e, r) => {
            e.settingsResult = r;
          }
        ),
    },
    {
      key: "codeScanning" as const,
      label: "Code Scanning",
      run: () =>
        runAndStoreResult(
          factories.codeScanning,
          repoConfig,
          repoInfo,
          sharedOpts,
          repoName,
          settingsCollector,
          (e, r) => {
            e.codeScanningResult = r;
          }
        ),
    },
    {
      key: "variables" as const,
      label: "Variables",
      run: () =>
        runAndStoreResult(
          factories.variables,
          repoConfig,
          repoInfo,
          sharedOpts,
          repoName,
          settingsCollector,
          (e, r) => {
            e.variablesResult = r;
          }
        ),
    },
    {
      key: "collaborators" as const,
      label: "Collaborators",
      run: () =>
        runAndStoreResult(
          factories.collaborators,
          repoConfig,
          repoInfo,
          sharedOpts,
          repoName,
          settingsCollector,
          (e, r) => {
            e.collaboratorsResult = r;
          }
        ),
    },
    {
      key: "environments" as const,
      label: "Environments",
      run: () =>
        runAndStoreResult(
          factories.environments,
          repoConfig,
          repoInfo,
          sharedOpts,
          repoName,
          settingsCollector,
          (e, r) => {
            e.environmentsResult = r;
          }
        ),
    },
  ];
}

export async function applyRepoSettings(
  ctx: ApplyRepoSettingsContext
): Promise<void> {
  const {
    repoConfig,
    repoInfo,
    repoName,
    repoNumber,
    settingsCollector,
    logger,
  } = ctx;

  if (!repoConfig.settings || !isGitHubRepo(repoInfo)) return;

  for (const desc of buildSettingsDescriptors(ctx)) {
    const settingsValue = repoConfig.settings[desc.key];
    if (!settingsValue || Object.keys(settingsValue).length === 0) continue;

    try {
      const result = await desc.run();
      logSettingsResult(
        logger,
        result,
        desc.label,
        repoNumber,
        repoName,
        settingsCollector
      );
    } catch (error) {
      logger.error(
        repoNumber,
        repoName,
        `${desc.label}: ${toErrorMessage(error)}`
      );
      settingsCollector.appendError(repoName, error);
    }
  }
}
