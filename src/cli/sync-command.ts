import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import {
  loadRawConfig,
  normalizeConfig,
  validateForSync,
  type MergeMode,
  type RepoConfig,
  type Config,
} from "../config/index.js";
import { ValidationError, SyncError } from "../shared/errors.js";
import {
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
  type RepoInfo,
  type GitHubRepoInfo,
} from "../repo/index.js";
import { sanitizeBranchName, validateBranchName } from "./branch-utils.js";
import { createTokenManager } from "../vcs/index.js";
import { RepositoryProcessor } from "../sync/index.js";
import {
  type ISettingsProcessor,
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
import { ShellCommandExecutor } from "../shared/command-executor.js";
import { Logger } from "../shared/logger.js";
import { generateWorkspaceName } from "../shared/workspace-utils.js";
import {
  type SyncDependencies,
  type SyncResultEntry,
  type SettingsResult,
  type SyncOptions,
  type ApplyRepoSettingsContext,
  type SettingsProcessorFactories,
  type RulesetProcessorFactory,
  type RepoSettingsProcessorFactory,
  type LabelsProcessorFactory,
  type CodeScanningProcessorFactory,
} from "./types.js";
import type { IRepositoryProcessor } from "../sync/index.js";

export type { SharedOptions, SyncOptions } from "./types.js";
import { ResultsCollector } from "./results-collector.js";
import {
  buildSettingsReport,
  type ProcessorResults,
} from "./settings-report-builder.js";
import {
  formatSettingsReportCLI,
  formatSyncReportCLI,
  formatLifecycleReportCLI,
  hasLifecycleChanges,
  type LifecycleAction,
} from "../output/index.js";
import { buildSyncReport } from "./sync-report-builder.js";
import { buildLifecycleReport } from "./lifecycle-report-builder.js";
import { writeUnifiedSummary } from "./unified-summary.js";
import type { ProcessorResult } from "../sync/index.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { resolveGitHubToken } from "../shared/gh-token-utils.js";
import {
  RepoLifecycleManager,
  runLifecycleCheck,
  type IRepoLifecycleManager,
} from "../lifecycle/index.js";

function createDefaultRulesetProcessorFactory(
  executor: ShellCommandExecutor
): RulesetProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new RulesetProcessor(new GitHubRulesetStrategy(executor, { cwd }));
}

function createDefaultRepoSettingsProcessorFactory(
  executor: ShellCommandExecutor
): RepoSettingsProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new RepoSettingsProcessor(
      new GitHubRepoSettingsStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}

function createDefaultLabelsProcessorFactory(
  executor: ShellCommandExecutor
): LabelsProcessorFactory {
  const cwd = process.cwd();
  return () => new LabelsProcessor(new GitHubLabelsStrategy(executor, { cwd }));
}

function createDefaultCodeScanningProcessorFactory(
  executor: ShellCommandExecutor
): CodeScanningProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new CodeScanningProcessor(
      new GitHubCodeScanningStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}

function getUniqueFileNames(config: { repos: RepoConfig[] }): string[] {
  const fileNames = new Set<string>();
  for (const repo of config.repos) {
    for (const file of repo.files) {
      fileNames.add(file.fileName);
    }
  }
  return Array.from(fileNames);
}

function generateBranchName(fileNames: string[]): string {
  if (fileNames.length === 1) {
    return `chore/sync-${sanitizeBranchName(fileNames[0])}`;
  }
  return "chore/sync-config";
}

function formatFileNames(fileNames: string[]): string {
  if (fileNames.length === 1) {
    return fileNames[0];
  }
  if (fileNames.length <= 3) {
    return fileNames.join(", ");
  }
  return `${fileNames.length} files`;
}

function determineMergeOutcome(result: ProcessorResult): MergeMode | undefined {
  if (!result.success) return undefined;
  if (!result.prUrl) return "direct";
  if (result.mergeResult?.merged) return "force";
  if (result.mergeResult?.autoMergeEnabled) return "auto";
  return "manual";
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

interface SettingsDescriptor {
  key: "rulesets" | "labels" | "repo" | "codeScanning";
  label: string;
  run: () => Promise<SettingsResult>;
}

async function runAndStoreResult(
  factory: () => ISettingsProcessor,
  repoConfig: RepoConfig,
  repoInfo: RepoInfo,
  opts: { dryRun?: boolean; noDelete?: boolean; token?: string },
  repoName: string,
  settingsCollector: ResultsCollector,
  assign: (entry: ProcessorResults, result: SettingsResult) => void
): Promise<SettingsResult> {
  const result = await runSettingsProcessor(
    factory,
    repoConfig,
    repoInfo,
    opts
  );
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
            e.rulesetResult = r as ProcessorResults["rulesetResult"];
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
            e.labelsResult = r as ProcessorResults["labelsResult"];
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
            e.settingsResult = r as ProcessorResults["settingsResult"];
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
            e.codeScanningResult = r as ProcessorResults["codeScanningResult"];
          }
        ),
    },
  ];
}

function runSettingsProcessor(
  factory: () => ISettingsProcessor,
  repoConfig: RepoConfig,
  repoInfo: RepoInfo,
  processOptions: { dryRun?: boolean; noDelete?: boolean; token?: string }
): Promise<SettingsResult> {
  return factory()
    .process(repoConfig, repoInfo, processOptions)
    .then((result) => result as SettingsResult);
}

async function applyRepoSettings(ctx: ApplyRepoSettingsContext): Promise<void> {
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

function displayReports(
  logger: Logger,
  reportResults: SyncResultEntry[],
  lifecycleReportInputs: LifecycleAction[],
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

  writeUnifiedSummary({
    lifecycle: lifecycleReport,
    sync: report,
    settings: settingsReport,
    dryRun,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
  });
}

interface RepoIterationContext {
  config: Config;
  options: SyncOptions;
  branchName: string;
  processor: IRepositoryProcessor;
  lifecycleManager: IRepoLifecycleManager;
  tokenManager: ReturnType<typeof createTokenManager>;
  reportResults: SyncResultEntry[];
  lifecycleReportInputs: LifecycleAction[];
  settingsCollector: ResultsCollector;
  factories: SettingsProcessorFactories;
  logger: Logger;
  executor: ShellCommandExecutor;
}

interface RepoPhaseParams {
  repoConfig: RepoConfig;
  repoInfo: RepoInfo;
  repoName: string;
  index: number;
  workDir: string;
  token: string | undefined;
}

function pushFailure(
  results: SyncResultEntry[],
  repoName: string,
  error: unknown
): void {
  results.push({
    repoName,
    success: false,
    fileChanges: [],
    error: toErrorMessage(error),
  });
}

async function processSingleRepo(
  repoConfig: RepoConfig,
  index: number,
  ctx: RepoIterationContext
): Promise<void> {
  const { config, options, logger } = ctx;
  const repoNumber = index + 1;

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
    logger.error(repoNumber, repoConfig.git, toErrorMessage(error));
    pushFailure(ctx.reportResults, repoConfig.git, error);
    return;
  }

  const repoName = getRepoDisplayName(repoInfo);
  const workDir = resolve(
    join(options.workDir ?? "./tmp", generateWorkspaceName(index))
  );

  const repoToken = isGitHubRepo(repoInfo)
    ? (
        await resolveGitHubToken({
          repoInfo: repoInfo as GitHubRepoInfo,
          tokenManager: ctx.tokenManager,
          context: repoName,
          log: logger,
          envToken: process.env.GH_TOKEN,
        })
      ).token
    : undefined;

  const repo: RepoPhaseParams = {
    repoConfig,
    repoInfo,
    repoName,
    index,
    workDir,
    token: repoToken,
  };

  const skipFileSync = await runLifecyclePhase(repo, ctx);
  if (skipFileSync) return;

  await runFileSyncPhase(repo, ctx);

  await applyRepoSettings({
    repoConfig,
    repoInfo,
    repoName,
    repoNumber,
    options,
    token: repoToken,
    settingsCollector: ctx.settingsCollector,
    factories: ctx.factories,
    logger,
  });
}

async function runLifecyclePhase(
  repo: RepoPhaseParams,
  ctx: RepoIterationContext
): Promise<boolean> {
  const repoNumber = repo.index + 1;

  try {
    const { outputLines, lifecycleResult, createSettings } =
      await runLifecycleCheck(repo.repoConfig, repo.repoInfo, {
        dryRun: ctx.options.dryRun ?? false,
        resolvedWorkDir: repo.workDir,
        githubHosts: ctx.config.githubHosts,
        token: repo.token,
        repoIndex: repo.index,
        lifecycleManager: ctx.lifecycleManager,
        repoSettings: ctx.config.settings?.repo,
      });

    for (const line of outputLines) {
      ctx.logger.info(line);
    }
    ctx.lifecycleReportInputs.push({
      repoName: repo.repoName,
      action: lifecycleResult.action,
      upstream: repo.repoConfig.upstream,
      source: repo.repoConfig.source,
      settings: createSettings
        ? {
            visibility: createSettings.visibility,
            description: createSettings.description,
          }
        : undefined,
    });

    if (ctx.options.dryRun && lifecycleResult.action !== "existed") {
      ctx.reportResults.push({
        repoName: repo.repoName,
        success: true,
        fileChanges: [],
      });
      return true;
    }

    return false;
  } catch (error) {
    ctx.logger.error(
      repoNumber,
      repo.repoName,
      `Lifecycle error: ${toErrorMessage(error)}`
    );
    pushFailure(ctx.reportResults, repo.repoName, error);
    return true;
  }
}

async function runFileSyncPhase(
  repo: RepoPhaseParams,
  ctx: RepoIterationContext
): Promise<void> {
  const repoNumber = repo.index + 1;
  try {
    ctx.logger.progress(repoNumber, repo.repoName, "Processing...");

    const result = await ctx.processor.process(repo.repoConfig, repo.repoInfo, {
      branchName: ctx.branchName,
      workDir: repo.workDir,
      configId: ctx.config.id,
      dryRun: ctx.options.dryRun,
      retries: ctx.options.retries,
      executor: ctx.executor,
      prTemplate: ctx.config.prTemplate,
      noDelete: ctx.options.noDelete,
      token: repo.token,
      hasAppCredentials:
        isGitHubRepo(repo.repoInfo) && ctx.tokenManager !== null,
    });

    const mergeOutcome = determineMergeOutcome(result);

    ctx.reportResults.push({
      repoName: repo.repoName,
      success: result.success,
      fileChanges: result.fileChanges ?? [],
      prUrl: result.prUrl,
      mergeOutcome,
      error: result.success ? undefined : result.message,
    });

    if (result.skipped) {
      ctx.logger.skip(repoNumber, repo.repoName, result.message);
    } else if (result.success) {
      ctx.logger.success(repoNumber, repo.repoName, result.message);
    } else {
      ctx.logger.error(repoNumber, repo.repoName, result.message);
    }
  } catch (error) {
    ctx.logger.error(repoNumber, repo.repoName, toErrorMessage(error));
    pushFailure(ctx.reportResults, repo.repoName, error);
  }
}

export async function runSync(
  options: SyncOptions,
  deps: SyncDependencies = {}
): Promise<void> {
  const executor = new ShellCommandExecutor(process.env);
  const logger = new Logger(!!(process.env.DEBUG || process.env.XFG_DEBUG));

  const { lifecycleManager, settingsProcessorFactories } = deps;
  const factories: SettingsProcessorFactories = {
    rulesets:
      settingsProcessorFactories?.rulesets ??
      createDefaultRulesetProcessorFactory(executor),
    labels:
      settingsProcessorFactories?.labels ??
      createDefaultLabelsProcessorFactory(executor),
    repo:
      settingsProcessorFactories?.repo ??
      createDefaultRepoSettingsProcessorFactory(executor),
    codeScanning:
      settingsProcessorFactories?.codeScanning ??
      createDefaultCodeScanningProcessorFactory(executor),
  };
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    throw new ValidationError(`Config path not found: ${configPath}`);
  }

  logger.log(`Loading config from: ${configPath}`);
  if (options.dryRun) {
    logger.log("Running in DRY RUN mode - no changes will be made\n");
  }

  const rawConfig = loadRawConfig(configPath);

  validateForSync(rawConfig);

  const config = normalizeConfig(rawConfig, process.env);
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
    process.env.XFG_GITHUB_CLIENT_ID && process.env.XFG_GITHUB_APP_PRIVATE_KEY
      ? {
          clientId: process.env.XFG_GITHUB_CLIENT_ID,
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
      new RepoLifecycleManager(
        undefined,
        executor,
        options.retries,
        process.cwd(),
        logger
      ),
    tokenManager,
    reportResults: [],
    lifecycleReportInputs: [],
    settingsCollector: new ResultsCollector(),
    factories,
    logger,
    executor,
  };

  for (let i = 0; i < config.repos.length; i++) {
    await processSingleRepo(config.repos[i], i, ctx);
  }

  displayReports(
    logger,
    ctx.reportResults,
    ctx.lifecycleReportInputs,
    ctx.settingsCollector,
    options.dryRun ?? false
  );

  const settingsResults = ctx.settingsCollector.getAll();
  const hasErrors = ctx.reportResults.some((r) => r.error);
  const hasSettingsErrors = settingsResults.some((r) => r.error);
  if (hasErrors || hasSettingsErrors) {
    throw new SyncError("One or more repositories had errors during sync");
  }
}
