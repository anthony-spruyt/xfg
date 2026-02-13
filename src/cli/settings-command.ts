import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import { loadRawConfig, normalizeConfig } from "../config/index.js";
import { validateForSettings } from "../config/validator.js";
import {
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
} from "../shared/repo-detector.js";
import type { GitHubRepoInfo } from "../shared/repo-detector.js";
import {
  hasGitHubAppCredentials,
  GitHubAppTokenManager,
} from "../vcs/index.js";
import { logger } from "../shared/logger.js";
import { generateWorkspaceName } from "../shared/workspace-utils.js";
import { RepoResult } from "../output/github-summary.js";
import { buildErrorResult } from "../output/summary-utils.js";
import { getManagedRulesets } from "../sync/manifest.js";
import {
  formatSettingsReportCLI,
  writeSettingsReportSummary,
} from "../output/settings-report.js";
import {
  buildSettingsReport,
  ProcessorResults,
} from "./settings-report-builder.js";
import { SharedOptions } from "./sync-command.js";
import {
  ProcessorFactory,
  defaultProcessorFactory,
  RulesetProcessorFactory,
  defaultRulesetProcessorFactory,
  RepoSettingsProcessorFactory,
  defaultRepoSettingsProcessorFactory,
  IRulesetProcessor,
  IRepositoryProcessor,
} from "./types.js";
import type { Config, RepoConfig } from "../config/types.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import {
  RepoLifecycleManager,
  runLifecycleCheck,
  type IRepoLifecycleManager,
} from "../lifecycle/index.js";

/**
 * Options for the settings command.
 */
export type SettingsOptions = SharedOptions;

/**
 * Collects processing results for the SettingsReport.
 * Provides a centralized way to track results across rulesets and repo settings.
 */
class ResultsCollector {
  private readonly results: ProcessorResults[] = [];

  getOrCreate(repoName: string): ProcessorResults {
    let result = this.results.find((r) => r.repoName === repoName);
    if (!result) {
      result = { repoName };
      this.results.push(result);
    }
    return result;
  }

  appendError(repoName: string, error: unknown): void {
    const existing = this.getOrCreate(repoName);
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (existing.error) {
      existing.error += `; ${errorMsg}`;
    } else {
      existing.error = errorMsg;
    }
  }

  getAll(): ProcessorResults[] {
    return this.results;
  }
}

/**
 * Run lifecycle checks for all unique repos before processing.
 * Returns a Set of git URLs that failed lifecycle checks.
 */
async function runLifecycleChecks(
  allRepos: RepoConfig[],
  config: Config,
  options: SettingsOptions,
  lifecycleManager: IRepoLifecycleManager,
  results: RepoResult[],
  collector: ResultsCollector,
  tokenManager: GitHubAppTokenManager | null
): Promise<Set<string>> {
  const checked = new Set<string>();
  const failed = new Set<string>();

  for (let i = 0; i < allRepos.length; i++) {
    const repoConfig = allRepos[i];

    if (checked.has(repoConfig.git)) {
      continue;
    }
    checked.add(repoConfig.git);

    let repoInfo: RepoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });
    } catch {
      // URL parsing errors are handled in individual processors
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);

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

    try {
      const { outputLines } = await runLifecycleCheck(
        repoConfig,
        repoInfo,
        i,
        {
          dryRun: options.dryRun ?? false,
          workDir: options.workDir,
          githubHosts: config.githubHosts,
          token: lifecycleToken,
        },
        lifecycleManager,
        config.settings?.repo
      );

      for (const line of outputLines) {
        logger.info(line);
      }
    } catch (error) {
      logger.error(
        i + 1,
        repoName,
        `Lifecycle error: ${error instanceof Error ? error.message : String(error)}`
      );
      results.push(buildErrorResult(repoName, error));
      collector.appendError(repoName, error);
      failed.add(repoConfig.git);
    }
  }

  return failed;
}

/**
 * Process rulesets for all configured repositories.
 */
async function processRulesets(
  repos: RepoConfig[],
  config: Config,
  options: SettingsOptions,
  processor: IRulesetProcessor,
  repoProcessor: IRepositoryProcessor,
  results: RepoResult[],
  collector: ResultsCollector,
  lifecycleFailed: Set<string>
): Promise<void> {
  for (let i = 0; i < repos.length; i++) {
    const repoConfig = repos[i];

    if (lifecycleFailed.has(repoConfig.git)) {
      continue;
    }

    let repoInfo: RepoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });
    } catch (error) {
      logger.error(i + 1, repoConfig.git, String(error));
      results.push(buildErrorResult(repoConfig.git, error));
      collector.appendError(repoConfig.git, error);
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);

    if (!isGitHubRepo(repoInfo)) {
      logger.skip(
        i + 1,
        repoName,
        "GitHub Rulesets only supported for GitHub repos"
      );
      continue;
    }

    const managedRulesets = getManagedRulesets(null, config.id);

    try {
      logger.progress(i + 1, repoName, "Processing rulesets...");

      const result = await processor.process(repoConfig, repoInfo, {
        configId: config.id,
        dryRun: options.dryRun,
        managedRulesets,
        noDelete: options.noDelete,
      });

      if (result.planOutput && result.planOutput.lines.length > 0) {
        logger.info("");
        logger.info(chalk.bold(`${repoName} - Rulesets:`));
        for (const line of result.planOutput.lines) {
          logger.info(line);
        }
      }

      if (result.skipped) {
        logger.skip(i + 1, repoName, result.message);
      } else if (result.success) {
        logger.success(i + 1, repoName, result.message);

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

      if (!result.skipped) {
        collector.getOrCreate(repoName).rulesetResult = result;
      }
    } catch (error) {
      logger.error(i + 1, repoName, String(error));
      results.push(buildErrorResult(repoName, error));
      collector.appendError(repoName, error);
    }
  }
}

/**
 * Process repo settings for all configured repositories.
 */
async function processRepoSettings(
  repos: RepoConfig[],
  config: Config,
  options: SettingsOptions,
  processorFactory: RepoSettingsProcessorFactory,
  results: RepoResult[],
  collector: ResultsCollector,
  lifecycleFailed: Set<string>
): Promise<void> {
  if (repos.length === 0) {
    return;
  }

  const processor = processorFactory();

  console.log(`\nProcessing repo settings for ${repos.length} repositories\n`);

  for (let i = 0; i < repos.length; i++) {
    const repoConfig = repos[i];

    if (lifecycleFailed.has(repoConfig.git)) {
      continue;
    }

    let repoInfo: RepoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });
    } catch (error) {
      logger.error(i + 1, repoConfig.git, String(error));
      collector.appendError(repoConfig.git, error);
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);

    try {
      const result = await processor.process(repoConfig, repoInfo, {
        dryRun: options.dryRun,
      });

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
        // Silent skip
      } else if (result.success) {
        console.log(chalk.green(`  ✓ ${repoName}: ${result.message}`));
      } else {
        console.log(chalk.red(`  ✗ ${repoName}: ${result.message}`));
      }

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

      if (!result.skipped) {
        collector.getOrCreate(repoName).settingsResult = result;
      }
    } catch (error) {
      logger.error(i + 1, repoName, String(error));
      collector.appendError(repoName, error);
    }
  }
}

/**
 * Run the settings command - manages GitHub Rulesets and repo settings.
 */
export async function runSettings(
  options: SettingsOptions,
  processorFactory: RulesetProcessorFactory = defaultRulesetProcessorFactory,
  repoProcessorFactory: ProcessorFactory = defaultProcessorFactory,
  repoSettingsProcessorFactory: RepoSettingsProcessorFactory = defaultRepoSettingsProcessorFactory,
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
    validateForSettings(rawConfig);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const config = normalizeConfig(rawConfig);

  const reposWithRulesets = config.repos.filter(
    (r) => r.settings?.rulesets && Object.keys(r.settings.rulesets).length > 0
  );

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
  const lm =
    lifecycleManager ?? new RepoLifecycleManager(undefined, options.retries);
  const tokenManager = hasGitHubAppCredentials()
    ? new GitHubAppTokenManager(
        process.env.XFG_GITHUB_APP_ID!,
        process.env.XFG_GITHUB_APP_PRIVATE_KEY!
      )
    : null;
  const results: RepoResult[] = [];
  const collector = new ResultsCollector();

  // Pre-check lifecycle for all unique repos before processing
  const allRepos = [...reposWithRulesets, ...reposWithRepoSettings];
  const lifecycleFailed = await runLifecycleChecks(
    allRepos,
    config,
    options,
    lm,
    results,
    collector,
    tokenManager
  );

  await processRulesets(
    reposWithRulesets,
    config,
    options,
    processor,
    repoProcessor,
    results,
    collector,
    lifecycleFailed
  );

  await processRepoSettings(
    reposWithRepoSettings,
    config,
    options,
    repoSettingsProcessorFactory,
    results,
    collector,
    lifecycleFailed
  );

  console.log("");
  const report = buildSettingsReport(collector.getAll());
  const lines = formatSettingsReportCLI(report);
  for (const line of lines) {
    console.log(line);
  }
  writeSettingsReportSummary(report, options.dryRun ?? false);

  const hasErrors = report.repos.some((r) => r.error);
  if (hasErrors) {
    process.exit(1);
  }
}
