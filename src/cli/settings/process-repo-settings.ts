import chalk from "chalk";
import { parseGitUrl, getRepoDisplayName } from "../../shared/repo-detector.js";
import { logger } from "../../shared/logger.js";
import type { RepoResult } from "../../output/github-summary.js";
import type { RepoSettingsProcessorFactory } from "../types.js";
import type { Config, RepoConfig } from "../../config/types.js";
import type { RepoInfo } from "../../shared/repo-detector.js";
import type { ResultsCollector } from "./results-collector.js";
import type { SettingsOptions } from "../settings-command.js";

/**
 * Process repo settings for all configured repositories.
 */
export async function processRepoSettings(
  repos: RepoConfig[],
  config: Config,
  options: SettingsOptions,
  processorFactory: RepoSettingsProcessorFactory,
  results: RepoResult[],
  collector: ResultsCollector,
  lifecycleSkipped: Set<string>,
  indexOffset: number
): Promise<void> {
  if (repos.length === 0) {
    return;
  }

  const processor = processorFactory();

  console.log(`\nProcessing repo settings for ${repos.length} repositories\n`);

  for (let i = 0; i < repos.length; i++) {
    const repoConfig = repos[i];
    const current = indexOffset + i + 1;

    if (lifecycleSkipped.has(repoConfig.git)) {
      continue;
    }

    let repoInfo: RepoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });
    } catch (error) {
      logger.error(current, repoConfig.git, String(error));
      collector.appendError(repoConfig.git, error);
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);

    try {
      const result = await processor.process(repoConfig, repoInfo, {
        dryRun: options.dryRun,
      });

      if (result.planOutput && result.planOutput.lines.length > 0) {
        logger.info("");
        logger.info(chalk.bold(`${repoName} - Repo Settings:`));
        for (const line of result.planOutput.lines) {
          logger.info(line);
        }
        if (result.warnings && result.warnings.length > 0) {
          for (const warning of result.warnings) {
            logger.info(chalk.yellow(`Warning: ${warning}`));
          }
        }
      }

      if (result.skipped) {
        // Silent skip
      } else if (result.success) {
        logger.success(current, repoName, result.message);
      } else {
        logger.error(current, repoName, result.message);
        collector.appendError(repoName, result.message);
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
      logger.error(current, repoName, String(error));
      collector.appendError(repoName, error);
    }
  }
}
