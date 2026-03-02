import chalk from "chalk";
import {
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
} from "../../shared/repo-detector.js";
import { logger } from "../../shared/logger.js";
import type { RepoResult } from "../../output/github-summary.js";
import type { ILabelsProcessor } from "../types.js";
import type { Config, RepoConfig } from "../../config/types.js";
import type { RepoInfo } from "../../shared/repo-detector.js";
import type { ResultsCollector } from "./results-collector.js";
import type { SettingsOptions } from "../settings-command.js";

/**
 * Process labels for all configured repositories.
 */
export async function processLabels(
  repos: RepoConfig[],
  config: Config,
  options: SettingsOptions,
  processor: ILabelsProcessor,
  results: RepoResult[],
  collector: ResultsCollector,
  lifecycleSkipped: Set<string>,
  indexOffset: number
): Promise<void> {
  if (repos.length === 0) {
    return;
  }

  console.log(`\nProcessing labels for ${repos.length} repositories\n`);

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

    if (!isGitHubRepo(repoInfo)) {
      logger.skip(
        current,
        repoName,
        "GitHub Labels only supported for GitHub repos"
      );
      continue;
    }

    try {
      logger.progress(current, repoName, "Processing labels...");

      const result = await processor.process(repoConfig, repoInfo, {
        configId: config.id,
        dryRun: options.dryRun,
        noDelete: options.noDelete,
      });

      if (result.planOutput && result.planOutput.lines.length > 0) {
        logger.info("");
        logger.info(chalk.bold(`${repoName} - Labels:`));
        for (const line of result.planOutput.lines) {
          logger.info(line);
        }
      }

      if (result.skipped) {
        logger.skip(current, repoName, result.message);
      } else if (result.success) {
        logger.success(current, repoName, result.message);
      } else {
        logger.error(current, repoName, result.message);
        collector.appendError(repoName, result.message);
      }

      const existing = results.find((r) => r.repoName === repoName);
      if (existing) {
        existing.labelsPlanDetails = result.planOutput?.entries;
      } else {
        results.push({
          repoName,
          status: result.skipped
            ? "skipped"
            : result.success
              ? "succeeded"
              : "failed",
          message: result.message,
          labelsPlanDetails: result.planOutput?.entries,
        });
      }

      if (!result.skipped) {
        collector.getOrCreate(repoName).labelsResult = result;
      }
    } catch (error) {
      logger.error(current, repoName, String(error));
      collector.appendError(repoName, error);
    }
  }
}
