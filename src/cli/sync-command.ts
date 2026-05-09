import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  loadRawConfig,
  normalizeConfig,
  validateForSync,
} from "../config/index.js";
import { ValidationError, SyncError } from "../shared/errors.js";
import { validateBranchName } from "./branch-utils.js";
import { createTokenManager } from "../vcs/index.js";
import { RepositoryProcessor } from "../sync/index.js";
import { ShellCommandExecutor } from "../shared/command-executor.js";
import { Logger } from "../shared/logger.js";
import type { SyncDependencies, SyncOptions } from "./types.js";
import { ResultsCollector } from "./results-collector.js";
import { buildSettingsReport } from "./settings-report-builder.js";
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
import { RepoLifecycleManager } from "../lifecycle/index.js";
import { createDefaultFactories } from "./settings-factories.js";
import {
  getUniqueFileNames,
  generateBranchName,
  formatFileNames,
} from "./sync-utils.js";
import {
  runSingleRepo,
  type RepoIterationContext,
} from "./repo-sync-runner.js";
import type { SyncResultEntry } from "./types.js";

export type { SharedOptions, SyncOptions } from "./types.js";

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

export async function runSync(
  options: SyncOptions,
  deps: SyncDependencies = {}
): Promise<void> {
  const executor = new ShellCommandExecutor(process.env);
  const logger = new Logger(!!(process.env.DEBUG || process.env.XFG_DEBUG));

  const { lifecycleManager, settingsProcessorFactories } = deps;
  const factories = createDefaultFactories(
    executor,
    settingsProcessorFactories
  );
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
    await runSingleRepo(config.repos[i], i, ctx);
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
