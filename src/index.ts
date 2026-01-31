#!/usr/bin/env node

import { program, Command } from "commander";
import { resolve, join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, MergeMode, MergeStrategy } from "./config.js";

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
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
import { writeSummary, RepoResult } from "./github-summary.js";
import { buildRepoResult, buildErrorResult } from "./summary-utils.js";

/**
 * Processor interface for dependency injection in tests.
 */
export interface IRepositoryProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
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

// =============================================================================
// Shared CLI Options
// =============================================================================

interface SharedOptions {
  config: string;
  dryRun?: boolean;
  workDir?: string;
  retries?: number;
  noDelete?: boolean;
}

interface SyncOptions extends SharedOptions {
  branch?: string;
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
}

interface ProtectOptions extends SharedOptions {}

/**
 * Adds shared options to a command.
 */
function addSharedOptions(cmd: Command): Command {
  return cmd
    .requiredOption("-c, --config <path>", "Path to YAML config file")
    .option("-d, --dry-run", "Show what would be done without making changes")
    .option("-w, --work-dir <path>", "Temporary directory for cloning", "./tmp")
    .option(
      "-r, --retries <number>",
      "Number of retries for network operations (0 to disable)",
      (v) => parseInt(v, 10),
      3
    )
    .option(
      "--no-delete",
      "Skip deletion of orphaned resources even if deleteOrphaned is configured"
    );
}

// =============================================================================
// Sync Command
// =============================================================================

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

async function runSync(options: SyncOptions): Promise<void> {
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
  const results: RepoResult[] = [];

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
      repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });
    } catch (error) {
      logger.error(current, repoConfig.git, String(error));
      results.push(buildErrorResult(repoConfig.git, error));
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
    } catch (error) {
      logger.error(current, repoName, String(error));
      results.push(buildErrorResult(repoName, error));
    }
  }

  logger.summary();

  // Write GitHub Actions job summary if running in GitHub Actions
  const succeeded = results.filter((r) => r.status === "succeeded").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
  writeSummary({
    total: config.repos.length,
    succeeded,
    skipped,
    failed,
    results,
  });

  if (logger.hasFailures()) {
    process.exit(1);
  }
}

// =============================================================================
// Protect Command
// =============================================================================

async function runProtect(options: ProtectOptions): Promise<void> {
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

  // Check if any repos have rulesets configured
  const reposWithRulesets = config.repos.filter(
    (r) => r.settings?.rulesets && Object.keys(r.settings.rulesets).length > 0
  );

  if (reposWithRulesets.length === 0) {
    console.log(
      "No rulesets configured. Add settings.rulesets to your config to manage GitHub Rulesets."
    );
    return;
  }

  console.log(`Found ${reposWithRulesets.length} repositories with rulesets`);

  // TODO: Implement ruleset processing in Task 7 (Create ruleset processor)
  console.log("\nRuleset management is not yet implemented.");
  console.log("This will be available in a future version.");
}

// =============================================================================
// CLI Program
// =============================================================================

program
  .name("xfg")
  .description(
    "Sync configuration files and manage GitHub Rulesets across repositories"
  )
  .version(packageJson.version);

// Sync command (file synchronization)
const syncCommand = new Command("sync")
  .description("Sync configuration files across repositories (default command)")
  .option(
    "-b, --branch <name>",
    "Override the branch name (default: chore/sync-{filename} or chore/sync-config)"
  )
  .option(
    "-m, --merge <mode>",
    "PR merge mode: manual, auto (default, merge when checks pass), force (bypass requirements), direct (push to default branch, no PR)",
    (value: string): MergeMode => {
      const valid: MergeMode[] = ["manual", "auto", "force", "direct"];
      if (!valid.includes(value as MergeMode)) {
        throw new Error(
          `Invalid merge mode: ${value}. Valid: ${valid.join(", ")}`
        );
      }
      return value as MergeMode;
    }
  )
  .option(
    "--merge-strategy <strategy>",
    "Merge strategy: merge, squash (default), rebase",
    (value: string): MergeStrategy => {
      const valid: MergeStrategy[] = ["merge", "squash", "rebase"];
      if (!valid.includes(value as MergeStrategy)) {
        throw new Error(
          `Invalid merge strategy: ${value}. Valid: ${valid.join(", ")}`
        );
      }
      return value as MergeStrategy;
    }
  )
  .option("--delete-branch", "Delete source branch after merge")
  .action((opts) => {
    runSync(opts as SyncOptions).catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
  });

addSharedOptions(syncCommand);
program.addCommand(syncCommand);

// Protect command (ruleset management)
const protectCommand = new Command("protect")
  .description("Manage GitHub Rulesets for repositories")
  .action((opts) => {
    runProtect(opts as ProtectOptions).catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
  });

addSharedOptions(protectCommand);
program.addCommand(protectCommand);

// Handle backwards compatibility: if no subcommand is provided, default to sync
// This maintains compatibility with existing usage like `xfg -c config.yaml`
const args = process.argv.slice(2);
const subcommands = ["sync", "protect", "help"];
const versionFlags = ["-V", "--version"];

// Check if the first argument is a subcommand or version flag
const firstArg = args[0];
const isSubcommand = firstArg && subcommands.includes(firstArg);
const isVersionFlag = firstArg && versionFlags.includes(firstArg);

if (isSubcommand || isVersionFlag) {
  // Explicit subcommand or version flag - parse normally
  program.parse();
} else {
  // No subcommand - prepend 'sync' for backwards compatibility
  // This handles: `xfg -c config.yaml`, `xfg --help`, `xfg` (no args)
  program.parse(["node", "xfg", "sync", ...args]);
}
