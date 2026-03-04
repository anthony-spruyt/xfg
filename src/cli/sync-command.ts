import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { loadRawConfig, normalizeConfig, RepoConfig } from "../config/index.js";
import { validateForSync } from "../config/validator.js";
import {
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
} from "../shared/repo-detector.js";
import type { GitHubRepoInfo } from "../shared/repo-detector.js";
import { sanitizeBranchName, validateBranchName } from "../vcs/git-ops.js";
import { createTokenManager } from "../vcs/index.js";
import { logger } from "../shared/logger.js";
import { generateWorkspaceName } from "../shared/workspace-utils.js";
import { RepoInfo } from "../shared/repo-detector.js";
import {
  defaultProcessorFactory,
  defaultRulesetProcessorFactory,
  defaultRepoSettingsProcessorFactory,
  defaultLabelsProcessorFactory,
  type SyncDependencies,
  type SyncResultEntry,
  type SettingsResult,
  type SyncOptions,
  type ApplyRepoSettingsContext,
} from "./types.js";
export type { SharedOptions, SyncOptions } from "./types.js";
import { ResultsCollector } from "./results-collector.js";
import { buildSettingsReport } from "./settings-report-builder.js";
import { formatSettingsReportCLI } from "../output/settings-report.js";
import { buildSyncReport } from "./sync-report-builder.js";
import { formatSyncReportCLI } from "../output/sync-report.js";
import {
  buildLifecycleReport,
  formatLifecycleReportCLI,
  hasLifecycleChanges,
  type LifecycleReportInput,
} from "../output/lifecycle-report.js";
import { writeUnifiedSummary } from "../output/unified-summary.js";
import type { ProcessorResult } from "../sync/index.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { resolveGitHubToken } from "../shared/gh-api-utils.js";
import {
  RepoLifecycleManager,
  runLifecycleCheck,
  toCreateRepoSettings,
} from "../lifecycle/index.js";

/**
 * Get unique file names from all repos in the config
 */
function getUniqueFileNames(config: { repos: RepoConfig[] }): string[] {
  const fileNames = new Set<string>();
  for (const repo of config.repos) {
    for (const file of repo.files) {
      fileNames.add(file.fileName);
    }
  }
  return Array.from(fileNames);
}

/**
 * Generate default branch name based on files being synced
 */
function generateBranchName(fileNames: string[]): string {
  if (fileNames.length === 1) {
    return `chore/sync-${sanitizeBranchName(fileNames[0])}`;
  }
  return "chore/sync-config";
}

/**
 * Format file names for display
 */
function formatFileNames(fileNames: string[]): string {
  if (fileNames.length === 1) {
    return fileNames[0];
  }
  if (fileNames.length <= 3) {
    return fileNames.join(", ");
  }
  return `${fileNames.length} files`;
}

function determineMergeOutcome(
  result: ProcessorResult
): "manual" | "auto" | "force" | "direct" | undefined {
  if (!result.success) return undefined;
  if (!result.prUrl) return "direct";
  if (result.mergeResult?.merged) return "force";
  if (result.mergeResult?.autoMergeEnabled) return "auto";
  return "manual";
}

function logSettingsResult(
  result: SettingsResult,
  label: string,
  current: number,
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
    logger.success(current, repoName, `${label}: ${result.message}`);
  }
  if (!result.success && !result.skipped) {
    logger.error(current, repoName, `${label}: ${result.message}`);
    settingsCollector.appendError(repoName, result.message);
  }
}

async function applyRepoSettings(ctx: ApplyRepoSettingsContext): Promise<void> {
  const {
    repoConfig,
    repoInfo,
    repoName,
    current,
    options,
    tokenManager,
    settingsCollector,
    rulesetProcessorFactory,
    repoSettingsProcessorFactory,
    labelsProcessorFactory,
  } = ctx;

  if (!repoConfig.settings || !isGitHubRepo(repoInfo)) return;

  const { token: settingsToken } = await resolveGitHubToken(
    repoInfo as GitHubRepoInfo,
    tokenManager,
    repoName
  );

  const settingsDescriptors = [
    {
      key: "rulesets" as const,
      label: "Rulesets",
      run: async () => {
        const result = await rulesetProcessorFactory().process(
          repoConfig,
          repoInfo,
          {
            dryRun: options.dryRun,
            noDelete: options.noDelete,
            token: settingsToken,
          }
        );
        if (!result.skipped) {
          settingsCollector.getOrCreate(repoName).rulesetResult = result;
        }
        return result;
      },
    },
    {
      key: "labels" as const,
      label: "Labels",
      run: async () => {
        const result = await labelsProcessorFactory().process(
          repoConfig,
          repoInfo,
          {
            dryRun: options.dryRun,
            noDelete: options.noDelete,
            token: settingsToken,
          }
        );
        if (!result.skipped) {
          settingsCollector.getOrCreate(repoName).labelsResult = result;
        }
        return result;
      },
    },
    {
      key: "repo" as const,
      label: "Repo Settings",
      run: async () => {
        const result = await repoSettingsProcessorFactory().process(
          repoConfig,
          repoInfo,
          { dryRun: options.dryRun, token: settingsToken }
        );
        if (!result.skipped) {
          settingsCollector.getOrCreate(repoName).settingsResult = result;
        }
        return result;
      },
    },
  ];

  for (const desc of settingsDescriptors) {
    const settingsValue = repoConfig.settings[desc.key];
    if (!settingsValue || Object.keys(settingsValue).length === 0) continue;

    try {
      const result = await desc.run();
      logSettingsResult(
        result,
        desc.label,
        current,
        repoName,
        settingsCollector
      );
    } catch (error) {
      logger.error(
        current,
        repoName,
        `${desc.label}: ${toErrorMessage(error)}`
      );
      settingsCollector.appendError(repoName, error);
    }
  }
}

function displayReports(
  reportResults: SyncResultEntry[],
  lifecycleReportInputs: LifecycleReportInput[],
  settingsCollector: ResultsCollector,
  dryRun: boolean
): void {
  // Build and display lifecycle report
  const lifecycleReport = buildLifecycleReport(lifecycleReportInputs);
  if (hasLifecycleChanges(lifecycleReport)) {
    logger.log("");
    for (const line of formatLifecycleReportCLI(lifecycleReport)) {
      logger.log(line);
    }
  }

  // Build and display sync report
  const report = buildSyncReport(reportResults);
  logger.log("");
  for (const line of formatSyncReportCLI(report)) {
    logger.log(line);
  }

  // Build and display settings report (if any settings were processed)
  const settingsResults = settingsCollector.getAll();
  let settingsReport: ReturnType<typeof buildSettingsReport> | undefined;
  if (settingsResults.length > 0) {
    settingsReport = buildSettingsReport(settingsResults);
    const settingsLines = formatSettingsReportCLI(settingsReport);
    if (settingsLines.length > 0) {
      logger.log("");
      for (const line of settingsLines) {
        logger.log(line);
      }
    }
  }

  // Write unified summary to GITHUB_STEP_SUMMARY
  writeUnifiedSummary({
    lifecycle: lifecycleReport,
    sync: report,
    settings: settingsReport,
    dryRun,
  });
}

export async function runSync(
  options: SyncOptions,
  deps: SyncDependencies = {}
): Promise<void> {
  const {
    processorFactory = defaultProcessorFactory,
    lifecycleManager,
    rulesetProcessorFactory = defaultRulesetProcessorFactory,
    repoSettingsProcessorFactory = defaultRepoSettingsProcessorFactory,
    labelsProcessorFactory = defaultLabelsProcessorFactory,
  } = deps;
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  logger.log(`Loading config from: ${configPath}`);
  if (options.dryRun) {
    logger.log("Running in DRY RUN mode - no changes will be made\n");
  }

  const rawConfig = loadRawConfig(configPath);

  validateForSync(rawConfig);

  const config = normalizeConfig(rawConfig);
  const fileNames = getUniqueFileNames(config);

  let branchName: string;
  if (options.branch) {
    validateBranchName(options.branch);
    branchName = options.branch;
  } else {
    branchName = generateBranchName(fileNames);
  }

  logger.setTotal(config.repos.length);
  logger.log(`Found ${config.repos.length} repositories to process`);
  logger.log(`Target files: ${formatFileNames(fileNames)}`);
  logger.log(`Branch: ${branchName}\n`);

  const processor = processorFactory();
  const lm =
    lifecycleManager ?? new RepoLifecycleManager(undefined, options.retries);
  const tokenManager = createTokenManager();
  const reportResults: SyncResultEntry[] = [];
  const lifecycleReportInputs: LifecycleReportInput[] = [];
  const settingsCollector = new ResultsCollector();

  for (let i = 0; i < config.repos.length; i++) {
    const repoConfig = config.repos[i];

    if (options.merge || options.mergeStrategy || options.deleteBranch) {
      repoConfig.prOptions = {
        ...repoConfig.prOptions,
        merge: options.merge ?? repoConfig.prOptions?.merge,
        mergeStrategy:
          options.mergeStrategy ?? repoConfig.prOptions?.mergeStrategy,
        deleteBranch:
          options.deleteBranch ?? repoConfig.prOptions?.deleteBranch,
      };
    }

    const mergeMode = repoConfig.prOptions?.merge ?? "auto";
    if (mergeMode === "direct" && repoConfig.prOptions?.mergeStrategy) {
      logger.warn(
        `mergeStrategy '${repoConfig.prOptions.mergeStrategy}' is ignored in direct mode for ${repoConfig.git}`
      );
    }

    const current = i + 1;

    let repoInfo: RepoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });
    } catch (error) {
      logger.error(current, repoConfig.git, toErrorMessage(error));
      reportResults.push({
        repoName: repoConfig.git,
        success: false,
        fileChanges: [],
        error: toErrorMessage(error),
      });
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);
    const workDir = resolve(
      join(options.workDir ?? "./tmp", generateWorkspaceName(i))
    );

    // Resolve auth token for lifecycle gh commands
    const lifecycleToken = isGitHubRepo(repoInfo)
      ? (
          await resolveGitHubToken(
            repoInfo as GitHubRepoInfo,
            tokenManager,
            repoName
          )
        ).token
      : undefined;

    // Check if repo exists, create/fork/migrate if needed
    try {
      const { outputLines, lifecycleResult } = await runLifecycleCheck(
        repoConfig,
        repoInfo,
        i,
        {
          dryRun: options.dryRun ?? false,
          resolvedWorkDir: workDir,
          githubHosts: config.githubHosts,
          token: lifecycleToken,
        },
        lm,
        config.settings?.repo
      );

      for (const line of outputLines) {
        logger.info(line);
      }

      // Collect lifecycle result for report
      const createSettings = toCreateRepoSettings(config.settings?.repo);
      lifecycleReportInputs.push({
        repoName,
        action: lifecycleResult.action,
        upstream: repoConfig.upstream,
        source: repoConfig.source,
        settings: createSettings
          ? {
              visibility: createSettings.visibility,
              description: createSettings.description,
            }
          : undefined,
      });

      // In dry-run, skip processing repos that don't exist yet
      if (options.dryRun && lifecycleResult.action !== "existed") {
        reportResults.push({
          repoName,
          success: true,
          fileChanges: [],
        });
        continue;
      }
    } catch (error) {
      logger.error(
        current,
        repoName,
        `Lifecycle error: ${toErrorMessage(error)}`
      );
      reportResults.push({
        repoName,
        success: false,
        fileChanges: [],
        error: toErrorMessage(error),
      });
      continue;
    }

    try {
      logger.progress(current, repoName, "Processing...");

      const result = await processor.process(repoConfig, repoInfo, {
        branchName,
        workDir,
        configId: config.id,
        dryRun: options.dryRun,
        retries: options.retries,
        prTemplate: config.prTemplate,
        noDelete: options.noDelete,
      });

      const mergeOutcome = determineMergeOutcome(result);

      reportResults.push({
        repoName,
        success: result.success,
        fileChanges: (result.fileChanges ?? []).map((f) => ({
          path: f.path,
          action: f.action,
        })),
        prUrl: result.prUrl,
        mergeOutcome,
        error: result.success ? undefined : result.message,
      });

      if (result.skipped) {
        logger.skip(current, repoName, result.message);
      } else if (result.success) {
        logger.success(current, repoName, result.message);
      } else {
        logger.error(current, repoName, result.message);
      }
    } catch (error) {
      logger.error(current, repoName, toErrorMessage(error));
      reportResults.push({
        repoName,
        success: false,
        fileChanges: [],
        error: toErrorMessage(error),
      });
    }

    // After file sync, apply settings via API (GitHub-only — ADO and GitLab repos are skipped)
    await applyRepoSettings({
      repoConfig,
      repoInfo,
      repoName,
      current,
      options,
      tokenManager,
      settingsCollector,
      rulesetProcessorFactory,
      repoSettingsProcessorFactory,
      labelsProcessorFactory,
    });
  }

  displayReports(
    reportResults,
    lifecycleReportInputs,
    settingsCollector,
    options.dryRun ?? false
  );

  // Propagate failures to caller (CLI entry handles process.exit)
  const settingsResults = settingsCollector.getAll();
  const hasErrors = reportResults.some((r) => r.error);
  const hasSettingsErrors = settingsResults.some((r) => r.error);
  if (hasErrors || hasSettingsErrors) {
    throw new Error("One or more repositories had errors during sync");
  }
}
