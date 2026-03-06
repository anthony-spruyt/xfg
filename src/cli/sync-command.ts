import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { loadRawConfig, normalizeConfig, RepoConfig } from "../config/index.js";
import { ValidationError, SyncError } from "../shared/errors.js";
import { validateForSync } from "../config/validator.js";
import {
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
} from "../shared/repo-detector.js";
import type { GitHubRepoInfo } from "../shared/repo-detector.js";
import { sanitizeBranchName, validateBranchName } from "../vcs/branch-utils.js";
import { createTokenManager } from "../vcs/index.js";
import { RepositoryProcessor } from "../sync/index.js";
import {
  RulesetProcessor,
  RepoSettingsProcessor,
  LabelsProcessor,
} from "../settings/index.js";
import { logger } from "../shared/logger.js";
import { generateWorkspaceName } from "../shared/workspace-utils.js";
import { RepoInfo } from "../shared/repo-detector.js";
import {
  type SyncDependencies,
  type SyncResultEntry,
  type SettingsResult,
  type SyncOptions,
  type ApplyRepoSettingsContext,
  type RulesetProcessorFactory,
  type RepoSettingsProcessorFactory,
  type LabelsProcessorFactory,
} from "./types.js";
import type { IRepositoryProcessor } from "../sync/index.js";

const defaultRulesetProcessorFactory: RulesetProcessorFactory = () =>
  new RulesetProcessor();
const defaultRepoSettingsProcessorFactory: RepoSettingsProcessorFactory = () =>
  new RepoSettingsProcessor();
const defaultLabelsProcessorFactory: LabelsProcessorFactory = () =>
  new LabelsProcessor();
export type { SharedOptions, SyncOptions } from "./types.js";
import type { Config } from "../config/types.js";
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
  type IRepoLifecycleManager,
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
    token,
    settingsCollector,
    rulesetProcessorFactory,
    repoSettingsProcessorFactory,
    labelsProcessorFactory,
  } = ctx;

  if (!repoConfig.settings || !isGitHubRepo(repoInfo)) return;

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
            token,
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
            token,
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
          { dryRun: options.dryRun, token }
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
  const lifecycleReport = buildLifecycleReport(lifecycleReportInputs);
  if (hasLifecycleChanges(lifecycleReport)) {
    logger.log("");
    for (const line of formatLifecycleReportCLI(lifecycleReport)) {
      logger.log(line);
    }
  }

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

/**
 * Shared context for processing a single repository within the sync loop.
 * Groups the per-run state so processSingleRepo doesn't need 15+ parameters.
 */
interface RepoIterationContext {
  config: Config;
  options: SyncOptions;
  branchName: string;
  processor: IRepositoryProcessor;
  lifecycleManager: IRepoLifecycleManager;
  tokenManager: ReturnType<typeof createTokenManager>;
  reportResults: SyncResultEntry[];
  lifecycleReportInputs: LifecycleReportInput[];
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

/**
 * Process a single repository: resolve URL, run lifecycle check, sync files, apply settings.
 * Pushes results into ctx.reportResults, ctx.lifecycleReportInputs, and ctx.settingsCollector.
 */
async function processSingleRepo(
  repoConfig: RepoConfig,
  index: number,
  ctx: RepoIterationContext
): Promise<void> {
  const { config, options } = ctx;
  const current = index + 1;

  // Apply CLI-level PR option overrides
  if (options.merge || options.mergeStrategy || options.deleteBranch) {
    repoConfig.prOptions = {
      ...repoConfig.prOptions,
      merge: options.merge ?? repoConfig.prOptions?.merge,
      mergeStrategy:
        options.mergeStrategy ?? repoConfig.prOptions?.mergeStrategy,
      deleteBranch: options.deleteBranch ?? repoConfig.prOptions?.deleteBranch,
    };
  }

  const mergeMode = repoConfig.prOptions?.merge ?? "auto";
  if (mergeMode === "direct" && repoConfig.prOptions?.mergeStrategy) {
    logger.warn(
      `mergeStrategy '${repoConfig.prOptions.mergeStrategy}' is ignored in direct mode for ${repoConfig.git}`
    );
  }

  let repoInfo: RepoInfo;
  try {
    repoInfo = parseGitUrl(repoConfig.git, {
      githubHosts: config.githubHosts,
    });
  } catch (error) {
    logger.error(current, repoConfig.git, toErrorMessage(error));
    ctx.reportResults.push({
      repoName: repoConfig.git,
      success: false,
      fileChanges: [],
      error: toErrorMessage(error),
    });
    return;
  }

  const repoName = getRepoDisplayName(repoInfo);
  const workDir = resolve(
    join(options.workDir ?? "./tmp", generateWorkspaceName(index))
  );

  const repoToken = isGitHubRepo(repoInfo)
    ? (
        await resolveGitHubToken(
          repoInfo as GitHubRepoInfo,
          ctx.tokenManager,
          repoName,
          logger,
          process.env.GH_TOKEN
        )
      ).token
    : undefined;

  const skipFileSync = await runLifecyclePhase(
    repoConfig,
    repoInfo,
    repoName,
    index,
    workDir,
    repoToken,
    ctx
  );
  if (skipFileSync) return;

  // Sync files via processor
  await runFileSyncPhase(
    repoConfig,
    repoInfo,
    repoName,
    current,
    workDir,
    repoToken,
    ctx
  );

  // Apply settings via API (GitHub-only — ADO and GitLab repos are skipped)
  await applyRepoSettings({
    repoConfig,
    repoInfo,
    repoName,
    current,
    options,
    token: repoToken,
    settingsCollector: ctx.settingsCollector,
    rulesetProcessorFactory: ctx.rulesetProcessorFactory,
    repoSettingsProcessorFactory: ctx.repoSettingsProcessorFactory,
    labelsProcessorFactory: ctx.labelsProcessorFactory,
  });
}

/**
 * Run lifecycle check (repo existence, creation, forking).
 * Returns true if the main loop should skip file sync for this repo.
 */
async function runLifecyclePhase(
  repoConfig: RepoConfig,
  repoInfo: RepoInfo,
  repoName: string,
  index: number,
  workDir: string,
  lifecycleToken: string | undefined,
  ctx: RepoIterationContext
): Promise<boolean> {
  const current = index + 1;

  try {
    const { outputLines, lifecycleResult } = await runLifecycleCheck(
      repoConfig,
      repoInfo,
      index,
      {
        dryRun: ctx.options.dryRun ?? false,
        resolvedWorkDir: workDir,
        githubHosts: ctx.config.githubHosts,
        token: lifecycleToken,
      },
      ctx.lifecycleManager,
      ctx.config.settings?.repo
    );

    for (const line of outputLines) {
      logger.info(line);
    }

    const createSettings = toCreateRepoSettings(ctx.config.settings?.repo);
    ctx.lifecycleReportInputs.push({
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
    if (ctx.options.dryRun && lifecycleResult.action !== "existed") {
      ctx.reportResults.push({
        repoName,
        success: true,
        fileChanges: [],
      });
      return true;
    }

    return false;
  } catch (error) {
    logger.error(
      current,
      repoName,
      `Lifecycle error: ${toErrorMessage(error)}`
    );
    ctx.reportResults.push({
      repoName,
      success: false,
      fileChanges: [],
      error: toErrorMessage(error),
    });
    return true;
  }
}

/**
 * Run the file sync processor for a single repo and collect results.
 */
async function runFileSyncPhase(
  repoConfig: RepoConfig,
  repoInfo: RepoInfo,
  repoName: string,
  current: number,
  workDir: string,
  token: string | undefined,
  ctx: RepoIterationContext
): Promise<void> {
  try {
    logger.progress(current, repoName, "Processing...");

    const result = await ctx.processor.process(repoConfig, repoInfo, {
      branchName: ctx.branchName,
      workDir,
      configId: ctx.config.id,
      dryRun: ctx.options.dryRun,
      retries: ctx.options.retries,
      prTemplate: ctx.config.prTemplate,
      noDelete: ctx.options.noDelete,
      token,
      isGraphQLCommitMode: isGitHubRepo(repoInfo) && ctx.tokenManager !== null,
    });

    const mergeOutcome = determineMergeOutcome(result);

    ctx.reportResults.push({
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
    ctx.reportResults.push({
      repoName,
      success: false,
      fileChanges: [],
      error: toErrorMessage(error),
    });
  }
}

export async function runSync(
  options: SyncOptions,
  deps: SyncDependencies = {}
): Promise<void> {
  const {
    lifecycleManager,
    rulesetProcessorFactory = defaultRulesetProcessorFactory,
    repoSettingsProcessorFactory = defaultRepoSettingsProcessorFactory,
    labelsProcessorFactory = defaultLabelsProcessorFactory,
  } = deps;
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    throw new ValidationError(`Config file not found: ${configPath}`);
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

  const tokenManager = createTokenManager(
    process.env.XFG_GITHUB_APP_ID && process.env.XFG_GITHUB_APP_PRIVATE_KEY
      ? {
          appId: process.env.XFG_GITHUB_APP_ID,
          privateKey: process.env.XFG_GITHUB_APP_PRIVATE_KEY,
        }
      : undefined
  );

  const processor = deps.processorFactory
    ? deps.processorFactory()
    : new RepositoryProcessor(undefined, logger, {
        tokenManager,
        envToken: process.env.GH_TOKEN,
      });

  const ctx: RepoIterationContext = {
    config,
    options,
    branchName,
    processor,
    lifecycleManager:
      lifecycleManager ??
      new RepoLifecycleManager(undefined, options.retries, logger),
    tokenManager,
    reportResults: [],
    lifecycleReportInputs: [],
    settingsCollector: new ResultsCollector(),
    rulesetProcessorFactory,
    repoSettingsProcessorFactory,
    labelsProcessorFactory,
  };

  for (let i = 0; i < config.repos.length; i++) {
    await processSingleRepo(config.repos[i], i, ctx);
  }

  displayReports(
    ctx.reportResults,
    ctx.lifecycleReportInputs,
    ctx.settingsCollector,
    options.dryRun ?? false
  );

  // Propagate failures to caller (CLI entry handles process.exit)
  const settingsResults = ctx.settingsCollector.getAll();
  const hasErrors = ctx.reportResults.some((r) => r.error);
  const hasSettingsErrors = settingsResults.some((r) => r.error);
  if (hasErrors || hasSettingsErrors) {
    throw new SyncError("One or more repositories had errors during sync");
  }
}
