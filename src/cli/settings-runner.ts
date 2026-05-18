import type { RepoConfig } from "../config/index.js";
import { isGitHubRepo, type RepoInfo } from "../repo/index.js";
import type {
  ISettingsProcessor,
  BaseProcessorOptions,
} from "../settings/index.js";
import type { Logger } from "../shared/logger.js";
import { toErrorMessage } from "../shared/type-guards.js";
import type { SettingsResult, ApplyRepoSettingsContext } from "./types.js";
import type { ResultsCollector } from "./results-collector.js";
import type { ProcessorResults } from "./settings-report-builder.js";

interface SettingsDescriptor {
  key: "rulesets" | "labels" | "repo" | "codeScanning" | "variables";
  label: string;
  run: () => Promise<SettingsResult>;
}

function logSettingsResult(
  logger: Logger,
  result: SettingsResult,
  label: string,
  repoNumber: number,
  repoName: string,
  settingsCollector: ResultsCollector
): void {
  if (result.planOutput?.lines?.length) {
    logger.info("");
    logger.info(`${repoName} - ${label}:`);
    for (const line of result.planOutput.lines) {
      logger.info(line);
    }
    if (result.warnings?.length) {
      for (const warning of result.warnings) {
        logger.warn(warning);
      }
    }
  } else if (!result.skipped && result.success) {
    logger.success(repoNumber, repoName, `${label}: ${result.message}`);
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
