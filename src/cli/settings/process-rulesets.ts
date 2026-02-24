import { resolve, join } from "node:path";
import chalk from "chalk";
import {
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
  type GitHubRepoInfo,
} from "../../shared/repo-detector.js";
import { logger } from "../../shared/logger.js";
import { generateWorkspaceName } from "../../shared/workspace-utils.js";
import type { RepoResult } from "../../output/github-summary.js";
import { buildErrorResult } from "../../output/summary-utils.js";
import {
  getManagedRulesets,
  parseManifestContent,
  MANIFEST_FILENAME,
} from "../../sync/manifest.js";
import { defaultExecutor } from "../../shared/command-executor.js";
import { escapeShellArg } from "../../shared/shell-utils.js";
import type { IRulesetProcessor, IRepositoryProcessor } from "../types.js";
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
  repoProcessor: IRepositoryProcessor,
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

    const managedRulesets = await fetchManagedRulesets(
      repoInfo as GitHubRepoInfo,
      config.id
    );

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

/**
 * Fetches the managed rulesets list from a remote GitHub repo's manifest.
 * Returns an empty array if the manifest doesn't exist or can't be read.
 *
 * Uses the project's ICommandExecutor + escapeShellArg pattern for safe
 * command execution. All inputs are from parsed config (owner/repo), not
 * user input.
 */
async function fetchManagedRulesets(
  repoInfo: GitHubRepoInfo,
  configId: string
): Promise<string[]> {
  try {
    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${MANIFEST_FILENAME}`;
    const command = `gh api ${escapeShellArg(endpoint)} --jq '.content'`;
    const base64Content = await defaultExecutor.exec(command, process.cwd());
    const content = Buffer.from(base64Content.trim(), "base64").toString(
      "utf-8"
    );
    const manifest = parseManifestContent(content);
    return getManagedRulesets(manifest, configId);
  } catch {
    return [];
  }
}
