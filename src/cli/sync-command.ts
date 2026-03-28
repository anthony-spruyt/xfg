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
} from "../shared/repo-detector.js";
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
import { GitHubRepoMetadataProvider } from "../shared/repo-metadata-provider.js";
import { ShellCommandExecutor } from "../shared/command-executor.js";
import { Logger } from "../shared/logger.js";
import { generateWorkspaceName } from "../shared/workspace-utils.js";
import {
  type SyncDependencies,
  type SyncResultEntry,
  type SettingsResult,
  type SyncOptions,
  type ApplyRepoSettingsContext,
  type RulesetProcessorFactory,
  type RepoSettingsProcessorFactory,
  type LabelsProcessorFactory,
  type CodeScanningProcessorFactory,
} from "./types.js";
import type { IRepositoryProcessor } from "../sync/index.js";

let _defaultExecutor: ShellCommandExecutor | undefined;
let _logger: Logger | undefined;

function getDefaultExecutor(): ShellCommandExecutor {
  return (_defaultExecutor ??= new ShellCommandExecutor(process.env));
}

function getLogger(): Logger {
  return (_logger ??= new Logger(
    !!(process.env.DEBUG || process.env.XFG_DEBUG)
  ));
}

function createDefaultRulesetProcessorFactory(): RulesetProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new RulesetProcessor(
      new GitHubRulesetStrategy(getDefaultExecutor(), { cwd })
    );
}

function createDefaultRepoSettingsProcessorFactory(): RepoSettingsProcessorFactory {
  const cwd = process.cwd();
  const executor = getDefaultExecutor();
  return () =>
    new RepoSettingsProcessor(
      new GitHubRepoSettingsStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}

function createDefaultLabelsProcessorFactory(): LabelsProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new LabelsProcessor(
      new GitHubLabelsStrategy(getDefaultExecutor(), { cwd })
    );
}

function createDefaultCodeScanningProcessorFactory(): CodeScanningProcessorFactory {
  const cwd = process.cwd();
  const executor = getDefaultExecutor();
  return () =>
    new CodeScanningProcessor(
      new GitHubCodeScanningStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}

export type { SharedOptions, SyncOptions } from "./types.js";
import { ResultsCollector } from "./results-collector.js";
import {
  buildSettingsReport,
  type ProcessorResults,
} from "./settings-report-builder.js";
import { formatSettingsReportCLI } from "../output/settings-report.js";
import { buildSyncReport } from "./sync-report-builder.js";
import { formatSyncReportCLI } from "../output/sync-report.js";
import { buildLifecycleReport } from "./lifecycle-report-builder.js";
import {
  formatLifecycleReportCLI,
  hasLifecycleChanges,
  type LifecycleAction,
} from "../output/lifecycle-report.js";
import { writeUnifiedSummary } from "../output/unified-summary.js";
import type { ProcessorResult } from "../sync/index.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { resolveGitHubToken } from "../shared/gh-api-utils.js";
import {
  RepoLifecycleManager,
  runLifecycleCheck,
  type IRepoLifecycleManager,
} from "../lifecycle/index.js";

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
  result: SettingsResult,
  label: string,
  repoNumber: number,
  repoName: string,
  settingsCollector: ResultsCollector
): void {
  if (result.planOutput?.lines?.length) {
    getLogger().info("");
    getLogger().info(`${repoName} - ${label}:`);
    for (const line of result.planOutput.lines) {
      getLogger().info(line);
    }
    if (result.warnings?.length) {
      for (const warning of result.warnings) {
        getLogger().warn(warning);
      }
    }
  } else if (!result.skipped && result.success) {
    getLogger().success(repoNumber, repoName, `${label}: ${result.message}`);
  }
  if (!result.success && !result.skipped) {
    getLogger().error(repoNumber, repoName, `${label}: ${result.message}`);
    settingsCollector.appendError(repoName, result.message);
  }
}

interface SettingsDescriptor {
  key: "rulesets" | "labels" | "repo" | "codeScanning";
  label: string;
  run: () => Promise<SettingsResult>;
}

// Each processor returns a subtype of BaseProcessorResult whose planOutput
// contains both `lines` (for CLI display) and `entries` (for report building).
// ProcessorResults fields capture only the `entries` slice; the runtime object
// satisfies both views, so we assign with an explicit per-field cast.
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
    assign(settingsCollector.getOrCreate(repoName), result);
  }
  return result;
}

function buildSettingsDescriptors(
  ctx: ApplyRepoSettingsContext
): SettingsDescriptor[] {
  const {
    repoConfig,
    repoInfo,
    options,
    token,
    repoName,
    settingsCollector,
    rulesetProcessorFactory,
    repoSettingsProcessorFactory,
    labelsProcessorFactory,
    codeScanningProcessorFactory,
  } = ctx;
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
          rulesetProcessorFactory,
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
          labelsProcessorFactory,
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
          repoSettingsProcessorFactory,
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
          codeScanningProcessorFactory,
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
  const { repoConfig, repoInfo, repoName, repoNumber, settingsCollector } = ctx;

  if (!repoConfig.settings || !isGitHubRepo(repoInfo)) return;

  for (const desc of buildSettingsDescriptors(ctx)) {
    const settingsValue = repoConfig.settings[desc.key];
    if (!settingsValue || Object.keys(settingsValue).length === 0) continue;

    try {
      const result = await desc.run();
      logSettingsResult(
        result,
        desc.label,
        repoNumber,
        repoName,
        settingsCollector
      );
    } catch (error) {
      getLogger().error(
        repoNumber,
        repoName,
        `${desc.label}: ${toErrorMessage(error)}`
      );
      settingsCollector.appendError(repoName, error);
    }
  }
}

function displayReports(
  reportResults: SyncResultEntry[],
  lifecycleReportInputs: LifecycleAction[],
  settingsCollector: ResultsCollector,
  dryRun: boolean
): void {
  const lifecycleReport = buildLifecycleReport(lifecycleReportInputs);
  if (hasLifecycleChanges(lifecycleReport)) {
    getLogger().log("");
    for (const line of formatLifecycleReportCLI(lifecycleReport)) {
      getLogger().log(line);
    }
  }

  const report = buildSyncReport(reportResults);
  getLogger().log("");
  for (const line of formatSyncReportCLI(report)) {
    getLogger().log(line);
  }

  // Build and display settings report (if any settings were processed)
  const settingsResults = settingsCollector.getAll();
  let settingsReport: ReturnType<typeof buildSettingsReport> | undefined;
  if (settingsResults.length > 0) {
    settingsReport = buildSettingsReport(settingsResults);
    const settingsLines = formatSettingsReportCLI(settingsReport);
    if (settingsLines.length > 0) {
      getLogger().log("");
      for (const line of settingsLines) {
        getLogger().log(line);
      }
    }
  }

  // Write unified summary to GITHUB_STEP_SUMMARY
  writeUnifiedSummary({
    lifecycle: lifecycleReport,
    sync: report,
    settings: settingsReport,
    dryRun,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
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
  lifecycleReportInputs: LifecycleAction[];
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
  codeScanningProcessorFactory: NonNullable<
    SyncDependencies["codeScanningProcessorFactory"]
  >;
}

interface RepoPhaseParams {
  repoConfig: RepoConfig;
  repoInfo: RepoInfo;
  repoName: string;
  index: number;
  workDir: string;
  token: string | undefined;
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
  const repoNumber = index + 1;

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
    getLogger().warn(
      `mergeStrategy '${repoConfig.prOptions.mergeStrategy}' is ignored in direct mode for ${repoConfig.git}`
    );
  }

  let repoInfo: RepoInfo;
  try {
    repoInfo = parseGitUrl(repoConfig.git, {
      githubHosts: config.githubHosts,
    });
  } catch (error) {
    getLogger().error(repoNumber, repoConfig.git, toErrorMessage(error));
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
        await resolveGitHubToken({
          repoInfo: repoInfo as GitHubRepoInfo,
          tokenManager: ctx.tokenManager,
          context: repoName,
          log: getLogger(),
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

  // Sync files via processor
  await runFileSyncPhase(repo, ctx);

  // Apply settings via API (GitHub-only — ADO and GitLab repos are skipped)
  await applyRepoSettings({
    repoConfig,
    repoInfo,
    repoName,
    repoNumber,
    options,
    token: repoToken,
    settingsCollector: ctx.settingsCollector,
    rulesetProcessorFactory: ctx.rulesetProcessorFactory,
    repoSettingsProcessorFactory: ctx.repoSettingsProcessorFactory,
    labelsProcessorFactory: ctx.labelsProcessorFactory,
    codeScanningProcessorFactory: ctx.codeScanningProcessorFactory,
  });
}

/**
 * Run lifecycle check (repo existence, creation, forking).
 * Returns true if the main loop should skip file sync for this repo.
 */
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
      getLogger().info(line);
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

    // In dry-run, skip processing repos that don't exist yet
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
    getLogger().error(
      repoNumber,
      repo.repoName,
      `Lifecycle error: ${toErrorMessage(error)}`
    );
    ctx.reportResults.push({
      repoName: repo.repoName,
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
  repo: RepoPhaseParams,
  ctx: RepoIterationContext
): Promise<void> {
  const repoNumber = repo.index + 1;
  try {
    getLogger().progress(repoNumber, repo.repoName, "Processing...");

    const result = await ctx.processor.process(repo.repoConfig, repo.repoInfo, {
      branchName: ctx.branchName,
      workDir: repo.workDir,
      configId: ctx.config.id,
      dryRun: ctx.options.dryRun,
      retries: ctx.options.retries,
      executor: getDefaultExecutor(),
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
      fileChanges: (result.fileChanges ?? []).map((f) => ({
        path: f.path,
        action: f.action,
        ...(f.diffLines ? { diffLines: f.diffLines } : {}),
      })),
      prUrl: result.prUrl,
      mergeOutcome,
      error: result.success ? undefined : result.message,
    });

    if (result.skipped) {
      getLogger().skip(repoNumber, repo.repoName, result.message);
    } else if (result.success) {
      getLogger().success(repoNumber, repo.repoName, result.message);
    } else {
      getLogger().error(repoNumber, repo.repoName, result.message);
    }
  } catch (error) {
    getLogger().error(repoNumber, repo.repoName, toErrorMessage(error));
    ctx.reportResults.push({
      repoName: repo.repoName,
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
  // Reset module-level singletons to ensure fresh state per invocation
  _defaultExecutor = undefined;
  _logger = undefined;

  const {
    lifecycleManager,
    rulesetProcessorFactory = createDefaultRulesetProcessorFactory(),
    repoSettingsProcessorFactory = createDefaultRepoSettingsProcessorFactory(),
    labelsProcessorFactory = createDefaultLabelsProcessorFactory(),
    codeScanningProcessorFactory = createDefaultCodeScanningProcessorFactory(),
  } = deps;
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    throw new ValidationError(`Config path not found: ${configPath}`);
  }

  getLogger().log(`Loading config from: ${configPath}`);
  if (options.dryRun) {
    getLogger().log("Running in DRY RUN mode - no changes will be made\n");
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

  getLogger().setTotal(config.repos.length);
  getLogger().log(`Found ${config.repos.length} repositories to process`);
  getLogger().log(`Target files: ${formatFileNames(fileNames)}`);
  getLogger().log(`Branch: ${branchName}\n`);

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
    : new RepositoryProcessor(undefined, getLogger(), {
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
        getDefaultExecutor(),
        options.retries,
        process.cwd(),
        getLogger()
      ),
    tokenManager,
    reportResults: [],
    lifecycleReportInputs: [],
    settingsCollector: new ResultsCollector(),
    rulesetProcessorFactory,
    repoSettingsProcessorFactory,
    labelsProcessorFactory,
    codeScanningProcessorFactory,
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
