#!/usr/bin/env node

import { program } from "commander";
import { resolve, join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, MergeMode, MergeStrategy } from "./config.js";

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };
import { parseGitUrl, getRepoDisplayName } from "./repo-detector.js";
import { sanitizeBranchName, validateBranchName } from "./git-ops.js";
import { logger } from "./logger.js";
import { generateWorkspaceName } from "./workspace-utils.js";
import {
  RepositoryProcessor,
  ProcessorResult,
} from "./repository-processor.js";
import { RepoConfig } from "./config.js";
import { RepoInfo } from "./repo-detector.js";
import { ProcessorOptions } from "./repository-processor.js";

/**
 * Processor interface for dependency injection in tests.
 */
export interface IRepositoryProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions,
  ): Promise<ProcessorResult>;
}

/**
 * Factory function type for creating processors.
 * Allows dependency injection for testing.
 */
export type ProcessorFactory = () => IRepositoryProcessor;

/**
 * Default factory that creates a real RepositoryProcessor.
 */
export const defaultProcessorFactory: ProcessorFactory = () =>
  new RepositoryProcessor();

interface CLIOptions {
  config: string;
  dryRun?: boolean;
  workDir?: string;
  retries?: number;
  branch?: string;
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
}

program
  .name("xfg")
  .description("Sync JSON configuration files across multiple repositories")
  .version(packageJson.version)
  .requiredOption("-c, --config <path>", "Path to YAML config file")
  .option("-d, --dry-run", "Show what would be done without making changes")
  .option("-w, --work-dir <path>", "Temporary directory for cloning", "./tmp")
  .option(
    "-r, --retries <number>",
    "Number of retries for network operations (0 to disable)",
    (v) => parseInt(v, 10),
    3,
  )
  .option(
    "-b, --branch <name>",
    "Override the branch name (default: chore/sync-{filename} or chore/sync-config)",
  )
  .option(
    "-m, --merge <mode>",
    "PR merge mode: manual, auto (default, merge when checks pass), force (bypass requirements)",
    (value: string): MergeMode => {
      const valid: MergeMode[] = ["manual", "auto", "force"];
      if (!valid.includes(value as MergeMode)) {
        throw new Error(
          `Invalid merge mode: ${value}. Valid: ${valid.join(", ")}`,
        );
      }
      return value as MergeMode;
    },
  )
  .option(
    "--merge-strategy <strategy>",
    "Merge strategy: merge, squash (default), rebase",
    (value: string): MergeStrategy => {
      const valid: MergeStrategy[] = ["merge", "squash", "rebase"];
      if (!valid.includes(value as MergeStrategy)) {
        throw new Error(
          `Invalid merge strategy: ${value}. Valid: ${valid.join(", ")}`,
        );
      }
      return value as MergeStrategy;
    },
  )
  .option("--delete-branch", "Delete source branch after merge")
  .parse();

const options = program.opts<CLIOptions>();

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

async function main(): Promise<void> {
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  console.log(`Loading config from: ${configPath}`);
  if (options.dryRun) {
    console.log("Running in DRY RUN mode - no changes will be made\n");
  }

  const config = loadConfig(configPath);
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

  const processor = defaultProcessorFactory();

  for (let i = 0; i < config.repos.length; i++) {
    const repoConfig = config.repos[i];

    // Apply CLI merge overrides to repo config
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

    let repoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(current, repoConfig.git, message);
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);
    const workDir = resolve(
      join(options.workDir ?? "./tmp", generateWorkspaceName(i)),
    );

    try {
      logger.progress(current, repoName, "Processing...");

      const result = await processor.process(repoConfig, repoInfo, {
        branchName,
        workDir,
        dryRun: options.dryRun,
        retries: options.retries,
        prTemplate: config.prTemplate,
      });

      if (result.skipped) {
        logger.skip(current, repoName, result.message);
      } else if (result.success) {
        let message = result.prUrl ? `PR: ${result.prUrl}` : result.message;
        if (result.mergeResult) {
          if (result.mergeResult.merged) {
            message += " (merged)";
          } else if (result.mergeResult.autoMergeEnabled) {
            message += " (auto-merge enabled)";
          }
        }
        logger.success(current, repoName, message);
      } else {
        logger.error(current, repoName, result.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(current, repoName, message);
    }
  }

  logger.summary();

  if (logger.hasFailures()) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
