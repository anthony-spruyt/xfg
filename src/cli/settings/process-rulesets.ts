import chalk from "chalk";
import {
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
} from "../../shared/repo-detector.js";
import { logger } from "../../shared/logger.js";
import type { RepoResult } from "../../output/github-summary.js";
import { buildErrorResult } from "../../output/summary-utils.js";
import type { IRulesetProcessor } from "../types.js";
import type { Config, RepoConfig } from "../../config/types.js";
import type { RepoInfo } from "../../shared/repo-detector.js";
import type { ResultsCollector } from "./results-collector.js";
import type { SettingsOptions } from "../settings-command.js";

/**
 * Process rulesets for all configured repositories.
 */
export async function processRulesets(
  repos: RepoConfig[],
  config: Config,
  options: SettingsOptions,
  processor: IRulesetProcessor,
  results: RepoResult[],
  collector: ResultsCollector,
  lifecycleSkipped: Set<string>
): Promise<void> {
  for (let i = 0; i < repos.length; i++) {
    const repoConfig = repos[i];

    if (lifecycleSkipped.has(repoConfig.git)) {
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

    try {
      logger.progress(i + 1, repoName, "Processing rulesets...");

      const result = await processor.process(repoConfig, repoInfo, {
        configId: config.id,
        dryRun: options.dryRun,
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
      } else {
        logger.error(i + 1, repoName, result.message);
        collector.appendError(repoName, result.message);
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
