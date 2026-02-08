#!/usr/bin/env node

import { program, Command } from "commander";
import { resolve, join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import {
  loadRawConfig,
  normalizeConfig,
  MergeMode,
  MergeStrategy,
} from "./config.js";
import { validateForSync, validateForSettings } from "./config-validator.js";

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
import { RepoResult } from "./github-summary.js";
import { buildRepoResult, buildErrorResult } from "./summary-utils.js";
import {
  RulesetProcessor,
  RulesetProcessorOptions,
  RulesetProcessorResult,
} from "./ruleset-processor.js";
import { getManagedRulesets } from "./manifest.js";
import { isGitHubRepo } from "./repo-detector.js";
import {
  RepoSettingsProcessor,
  IRepoSettingsProcessor,
} from "./repo-settings-processor.js";
import { Plan, printPlan } from "./plan-formatter.js";
import { writePlanSummary } from "./plan-summary.js";
import {
  rulesetResultToResources,
  syncResultToResources,
  repoSettingsResultToResources,
} from "./resource-converters.js";

/**
 * Processor interface for dependency injection in tests.
 */
export interface IRepositoryProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult>;
  updateManifestOnly(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: ProcessorOptions,
    manifestUpdate: { rulesets: string[] }
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

/**
 * Ruleset processor interface for dependency injection in tests.
 */
export interface IRulesetProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: RulesetProcessorOptions
  ): Promise<RulesetProcessorResult>;
}

/**
 * Factory function type for creating ruleset processors.
 */
export type RulesetProcessorFactory = () => IRulesetProcessor;

/**
 * Default factory that creates a real RulesetProcessor.
 */
export const defaultRulesetProcessorFactory: RulesetProcessorFactory = () =>
  new RulesetProcessor();

/**
 * Repo settings processor factory function type.
 */
export type RepoSettingsProcessorFactory = () => IRepoSettingsProcessor;

/**
 * Default factory that creates a real RepoSettingsProcessor.
 */
export const defaultRepoSettingsProcessorFactory: RepoSettingsProcessorFactory =
  () => new RepoSettingsProcessor();

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

type SettingsOptions = SharedOptions;

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

  // Validate config is suitable for sync command
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

  // Build plan for Terraform-style output
  const plan: Plan = { resources: [], errors: [] };

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

      // Collect resources for plan output
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

  // Print Terraform-style plan summary
  console.log("");
  printPlan(plan);

  // Write GitHub Actions job summary
  writePlanSummary(plan, {
    title: "Config Sync Summary",
    dryRun: options.dryRun ?? false,
  });

  if (plan.errors && plan.errors.length > 0) {
    process.exit(1);
  }
}

// =============================================================================
// Settings Command
// =============================================================================

export async function runSettings(
  options: SettingsOptions,
  processorFactory: RulesetProcessorFactory = defaultRulesetProcessorFactory,
  repoProcessorFactory: ProcessorFactory = defaultProcessorFactory,
  repoSettingsProcessorFactory: RepoSettingsProcessorFactory = defaultRepoSettingsProcessorFactory
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

  // Validate config is suitable for settings command
  try {
    validateForSettings(rawConfig);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const config = normalizeConfig(rawConfig);

  // Check if any repos have rulesets configured or have managed rulesets to clean up
  const reposWithRulesets = config.repos.filter(
    (r) => r.settings?.rulesets && Object.keys(r.settings.rulesets).length > 0
  );

  // Check if any repos have repo settings configured
  const reposWithRepoSettings = config.repos.filter(
    (r) => r.settings?.repo && Object.keys(r.settings.repo).length > 0
  );

  if (reposWithRulesets.length === 0 && reposWithRepoSettings.length === 0) {
    console.log(
      "No settings configured. Add settings.rulesets or settings.repo to your config."
    );
    return;
  }

  if (reposWithRulesets.length > 0) {
    console.log(`Found ${reposWithRulesets.length} repositories with rulesets`);
  }
  if (reposWithRepoSettings.length > 0) {
    console.log(
      `Found ${reposWithRepoSettings.length} repositories with repo settings`
    );
  }
  console.log("");
  logger.setTotal(reposWithRulesets.length + reposWithRepoSettings.length);

  const processor = processorFactory();
  const repoProcessor = repoProcessorFactory();
  const results: RepoResult[] = [];

  // Build plan for Terraform-style output
  const plan: Plan = { resources: [], errors: [] };

  for (let i = 0; i < reposWithRulesets.length; i++) {
    const repoConfig = reposWithRulesets[i];

    let repoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });
    } catch (error) {
      logger.error(i + 1, repoConfig.git, String(error));
      results.push(buildErrorResult(repoConfig.git, error));
      plan.errors!.push({
        repo: repoConfig.git,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);

    // Skip non-GitHub repos
    if (!isGitHubRepo(repoInfo)) {
      logger.skip(
        i + 1,
        repoName,
        "GitHub Rulesets only supported for GitHub repos"
      );
      // Mark all rulesets from this repo as skipped
      if (repoConfig.settings?.rulesets) {
        for (const rulesetName of Object.keys(repoConfig.settings.rulesets)) {
          plan.resources.push({
            type: "ruleset",
            repo: repoName,
            name: rulesetName,
            action: "skipped",
            skipReason: "GitHub Rulesets only supported for GitHub repos",
          });
        }
      }
      continue;
    }

    // Note: For settings command, we don't clone repos - we work with the API directly.
    // Manifest handling for tracking managed rulesets would require cloning.
    // For now, use an empty list - orphan deletion requires the sync command first.
    const managedRulesets = getManagedRulesets(null, config.id);

    try {
      logger.progress(i + 1, repoName, "Processing rulesets...");

      const result = await processor.process(repoConfig, repoInfo, {
        configId: config.id,
        dryRun: options.dryRun,
        managedRulesets,
        noDelete: options.noDelete,
      });

      if (result.skipped) {
        logger.skip(i + 1, repoName, result.message);
      } else if (result.success) {
        logger.success(i + 1, repoName, result.message);

        // Update manifest with ruleset tracking if there are rulesets to track
        if (
          result.manifestUpdate &&
          result.manifestUpdate.rulesets.length > 0
        ) {
          const workDir = resolve(
            join(options.workDir ?? "./tmp", generateWorkspaceName(i))
          );
          logger.progress(i + 1, repoName, "Updating manifest...");
          const manifestResult = await repoProcessor.updateManifestOnly(
            repoInfo,
            repoConfig,
            {
              branchName: "chore/sync-rulesets",
              workDir,
              configId: config.id,
              dryRun: options.dryRun,
              retries: options.retries,
            },
            result.manifestUpdate
          );
          if (!manifestResult.success && !manifestResult.skipped) {
            logger.info(
              `Warning: Failed to update manifest for ${repoName}: ${manifestResult.message}`
            );
          }
        }
      } else {
        logger.error(i + 1, repoName, result.message);
      }

      results.push({
        repoName,
        status: result.skipped
          ? "skipped"
          : result.success
            ? "succeeded"
            : "failed",
        message: result.message,
        rulesetPlanDetails: result.planOutput?.entries,
      });

      // Collect resources for plan output
      plan.resources.push(...rulesetResultToResources(repoName, result));
    } catch (error) {
      logger.error(i + 1, repoName, String(error));
      results.push(buildErrorResult(repoName, error));
      plan.errors!.push({
        repo: repoName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Process repo settings
  if (reposWithRepoSettings.length > 0) {
    const repoSettingsProcessor = repoSettingsProcessorFactory();

    console.log(
      `\nProcessing repo settings for ${reposWithRepoSettings.length} repositories\n`
    );

    for (let i = 0; i < reposWithRepoSettings.length; i++) {
      const repoConfig = reposWithRepoSettings[i];
      let repoInfo;
      try {
        repoInfo = parseGitUrl(repoConfig.git, {
          githubHosts: config.githubHosts,
        });
      } catch (error) {
        console.error(`Failed to parse ${repoConfig.git}: ${error}`);
        plan.errors!.push({
          repo: repoConfig.git,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const repoName = getRepoDisplayName(repoInfo);

      try {
        const result = await repoSettingsProcessor.process(
          repoConfig,
          repoInfo,
          {
            dryRun: options.dryRun,
          }
        );

        if (result.planOutput && result.planOutput.lines.length > 0) {
          console.log(`\n  ${chalk.bold(repoName)}:`);
          console.log("  Repo Settings:");
          for (const line of result.planOutput.lines) {
            console.log(line);
          }
          if (result.warnings && result.warnings.length > 0) {
            for (const warning of result.warnings) {
              console.log(chalk.yellow(`  ⚠️  Warning: ${warning}`));
            }
          }
        }

        if (result.skipped) {
          // Silent skip for repos without repo settings
        } else if (result.success) {
          console.log(chalk.green(`  ✓ ${repoName}: ${result.message}`));
        } else {
          console.log(chalk.red(`  ✗ ${repoName}: ${result.message}`));
        }

        // Merge repo settings plan details into existing result or push new
        if (!result.skipped) {
          const existing = results.find((r) => r.repoName === repoName);
          if (existing) {
            existing.repoSettingsPlanDetails = result.planOutput?.entries;
          } else {
            results.push({
              repoName,
              status: result.success ? "succeeded" : "failed",
              message: result.message,
              repoSettingsPlanDetails: result.planOutput?.entries,
            });
          }
        }

        // Collect resources for plan output
        plan.resources.push(...repoSettingsResultToResources(repoName, result));
      } catch (error) {
        console.error(`  ✗ ${repoName}: ${error}`);
        plan.errors!.push({
          repo: repoName,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Print Terraform-style plan summary
  console.log("");
  printPlan(plan);

  // Write GitHub Actions job summary
  writePlanSummary(plan, {
    title: "Repository Settings Summary",
    dryRun: options.dryRun ?? false,
  });

  if (plan.errors && plan.errors.length > 0) {
    process.exit(1);
  }
}

// =============================================================================
// CLI Program
// =============================================================================

program
  .name("xfg")
  .description("Sync files and manage settings across repositories")
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

// Settings command (ruleset management)
const settingsCommand = new Command("settings")
  .description("Manage GitHub Rulesets for repositories")
  .action((opts) => {
    runSettings(opts as SettingsOptions).catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
  });

addSharedOptions(settingsCommand);
program.addCommand(settingsCommand);

// Export program for CLI entry point
export { program };
