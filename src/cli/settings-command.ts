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
import { logger } from "../shared/logger.js";
import { generateWorkspaceName } from "../shared/workspace-utils.js";
import { RepoResult } from "../output/github-summary.js";
import { buildErrorResult } from "../output/summary-utils.js";
import { getManagedRulesets } from "../sync/manifest.js";
import { Plan, printPlan } from "../output/plan-formatter.js";
import { writePlanSummary } from "../output/plan-summary.js";
import {
  rulesetResultToResources,
  repoSettingsResultToResources,
} from "../settings/resource-converters.js";
import { SharedOptions } from "./sync-command.js";
import {
  ProcessorFactory,
  defaultProcessorFactory,
  RulesetProcessorFactory,
  defaultRulesetProcessorFactory,
  RepoSettingsProcessorFactory,
  defaultRepoSettingsProcessorFactory,
} from "./types.js";

/**
 * Options for the settings command.
 */
export type SettingsOptions = SharedOptions;

/**
 * Run the settings command - manages GitHub Rulesets and repo settings.
 */
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
  const results: RepoResult[] = [];
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

    if (!isGitHubRepo(repoInfo)) {
      logger.skip(
        i + 1,
        repoName,
        "GitHub Rulesets only supported for GitHub repos"
      );
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

  console.log("");
  printPlan(plan);

  writePlanSummary(plan, {
    title: "Repository Settings Summary",
    dryRun: options.dryRun ?? false,
  });

  if (plan.errors && plan.errors.length > 0) {
    process.exit(1);
  }
}
