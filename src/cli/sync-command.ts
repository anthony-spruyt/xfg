import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import {
  loadRawConfig,
  normalizeConfig,
  MergeMode,
  MergeStrategy,
  RepoConfig,
} from "../config.js";
import { validateForSync } from "../config-validator.js";
import { parseGitUrl, getRepoDisplayName } from "../repo-detector.js";
import { sanitizeBranchName, validateBranchName } from "../git-ops.js";
import { logger } from "../logger.js";
import { generateWorkspaceName } from "../workspace-utils.js";
import { RepoInfo } from "../repo-detector.js";
import { RepoResult } from "../github-summary.js";
import { buildRepoResult, buildErrorResult } from "../summary-utils.js";
import { Plan, printPlan } from "../plan-formatter.js";
import { writePlanSummary } from "../plan-summary.js";
import { syncResultToResources } from "../resource-converters.js";
import { ProcessorFactory, defaultProcessorFactory } from "./types.js";

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
 * Run the sync command - synchronizes files across repositories.
 */
export async function runSync(
  options: SyncOptions,
  processorFactory: ProcessorFactory = defaultProcessorFactory
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
  const results: RepoResult[] = [];
  const plan: Plan = { resources: [], errors: [] };

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
      results.push(buildErrorResult(repoConfig.git, error));
      plan.errors!.push({
        repo: repoConfig.git,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);
    const workDir = resolve(
      join(options.workDir ?? "./tmp", generateWorkspaceName(i))
    );

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

      const repoResult = buildRepoResult(repoName, repoConfig, result);
      results.push(repoResult);

      if (result.skipped) {
        logger.skip(current, repoName, result.message);
      } else if (result.success) {
        logger.success(current, repoName, repoResult.message);
      } else {
        logger.error(current, repoName, result.message);
      }

      plan.resources.push(
        ...syncResultToResources(repoName, repoConfig, result)
      );
    } catch (error) {
      logger.error(current, repoName, String(error));
      results.push(buildErrorResult(repoName, error));
      plan.errors!.push({
        repo: repoName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log("");
  printPlan(plan);

  writePlanSummary(plan, {
    title: "Config Sync Summary",
    dryRun: options.dryRun ?? false,
  });

  if (plan.errors && plan.errors.length > 0) {
    process.exit(1);
  }
}
