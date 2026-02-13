import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import {
  loadRawConfig,
  normalizeConfig,
  MergeMode,
  MergeStrategy,
  RepoConfig,
} from "../config/index.js";
import { validateForSync } from "../config/validator.js";
import {
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
} from "../shared/repo-detector.js";
import type { GitHubRepoInfo } from "../shared/repo-detector.js";
import { sanitizeBranchName, validateBranchName } from "../vcs/git-ops.js";
import {
  hasGitHubAppCredentials,
  GitHubAppTokenManager,
} from "../vcs/index.js";
import { logger } from "../shared/logger.js";
import { generateWorkspaceName } from "../shared/workspace-utils.js";
import { RepoInfo } from "../shared/repo-detector.js";
import { ProcessorFactory, defaultProcessorFactory } from "./types.js";
import { buildSyncReport } from "./sync-report-builder.js";
import {
  formatSyncReportCLI,
  writeSyncReportSummary,
} from "../output/sync-report.js";
import {
  buildLifecycleReport,
  formatLifecycleReportCLI,
  writeLifecycleReportSummary,
  hasLifecycleChanges,
  type LifecycleReportInput,
} from "../output/lifecycle-report.js";
import type { ProcessorResult } from "../sync/index.js";
import {
  RepoLifecycleManager,
  runLifecycleCheck,
  toCreateRepoSettings,
  type IRepoLifecycleManager,
} from "../lifecycle/index.js";

/**
 * Shared options common to all commands.
 */
export interface SharedOptions {
  config: string;
  dryRun?: boolean;
  workDir?: string;
  retries?: number;
  noDelete?: boolean;
}

/**
 * Options specific to the sync command.
 */
export interface SyncOptions extends SharedOptions {
  branch?: string;
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
}

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

/**
 * Entry for collecting sync results
 */
interface SyncResultEntry {
  repoName: string;
  success: boolean;
  fileChanges: Array<{ path: string; action: "create" | "update" | "delete" }>;
  prUrl?: string;
  mergeOutcome?: "manual" | "auto" | "force" | "direct";
  error?: string;
}

/**
 * Determine merge outcome from processor result
 */
function determineMergeOutcome(
  result: ProcessorResult
): "manual" | "auto" | "force" | "direct" | undefined {
  if (!result.success) return undefined;
  if (!result.prUrl) return "direct";
  if (result.mergeResult?.merged) return "force";
  if (result.mergeResult?.autoMergeEnabled) return "auto";
  return "manual";
}

/**
 * Run the sync command - synchronizes files across repositories.
 */
export async function runSync(
  options: SyncOptions,
  processorFactory: ProcessorFactory = defaultProcessorFactory,
  lifecycleManager?: IRepoLifecycleManager
): Promise<void> {
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  console.log(`Loading config from: ${configPath}`);
  if (options.dryRun) {
    console.log("Running in DRY RUN mode - no changes will be made\n");
  }

  const rawConfig = loadRawConfig(configPath);

  try {
    validateForSync(rawConfig);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

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
  console.log(`Found ${config.repos.length} repositories to process`);
  console.log(`Target files: ${formatFileNames(fileNames)}`);
  console.log(`Branch: ${branchName}\n`);

  const processor = processorFactory();
  const lm =
    lifecycleManager ?? new RepoLifecycleManager(undefined, options.retries);
  const tokenManager = hasGitHubAppCredentials()
    ? new GitHubAppTokenManager(
        process.env.XFG_GITHUB_APP_ID!,
        process.env.XFG_GITHUB_APP_PRIVATE_KEY!
      )
    : null;
  const reportResults: SyncResultEntry[] = [];
  const lifecycleReportInputs: LifecycleReportInput[] = [];

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

    const current = i + 1;

    let repoInfo: RepoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });
    } catch (error) {
      logger.error(current, repoConfig.git, String(error));
      reportResults.push({
        repoName: repoConfig.git,
        success: false,
        fileChanges: [],
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);
    const workDir = resolve(
      join(options.workDir ?? "./tmp", generateWorkspaceName(i))
    );

    // Resolve auth token for lifecycle gh commands
    let lifecycleToken: string | undefined;
    if (isGitHubRepo(repoInfo)) {
      try {
        lifecycleToken =
          (await tokenManager?.getTokenForRepo(repoInfo as GitHubRepoInfo)) ??
          process.env.GH_TOKEN;
      } catch {
        lifecycleToken = process.env.GH_TOKEN;
      }
    }

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
        `Lifecycle error: ${error instanceof Error ? error.message : String(error)}`
      );
      reportResults.push({
        repoName,
        success: false,
        fileChanges: [],
        error: error instanceof Error ? error.message : String(error),
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
      logger.error(current, repoName, String(error));
      reportResults.push({
        repoName,
        success: false,
        fileChanges: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Build and display lifecycle report (before sync report)
  const lifecycleReport = buildLifecycleReport(lifecycleReportInputs);
  if (hasLifecycleChanges(lifecycleReport)) {
    console.log("");
    for (const line of formatLifecycleReportCLI(lifecycleReport)) {
      console.log(line);
    }
  }
  writeLifecycleReportSummary(lifecycleReport, options.dryRun ?? false);

  // Build and display sync report
  const report = buildSyncReport(reportResults);
  console.log("");
  for (const line of formatSyncReportCLI(report)) {
    console.log(line);
  }
  writeSyncReportSummary(report, options.dryRun ?? false);

  // Exit with error if any failures
  const hasErrors = reportResults.some((r) => r.error);
  if (hasErrors) {
    process.exit(1);
  }
}
