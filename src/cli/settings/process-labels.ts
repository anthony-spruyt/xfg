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
import {
  getManagedLabels,
  parseManifestContent,
  MANIFEST_FILENAME,
} from "../../sync/manifest.js";
import { defaultExecutor } from "../../shared/command-executor.js";
import { escapeShellArg } from "../../shared/shell-utils.js";
import type { ILabelsProcessor, IRepositoryProcessor } from "../types.js";
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
  repoProcessor: IRepositoryProcessor,
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

    const managedLabels = await fetchManagedLabels(
      repoInfo as GitHubRepoInfo,
      config.id
    );

    try {
      logger.progress(current, repoName, "Processing labels...");

      const result = await processor.process(repoConfig, repoInfo, {
        configId: config.id,
        dryRun: options.dryRun,
        managedLabels,
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

        if (result.manifestUpdate && result.manifestUpdate.labels.length > 0) {
          const workDir = resolve(
            join(options.workDir ?? "./tmp", generateWorkspaceName(i))
          );
          logger.progress(current, repoName, "Updating manifest...");
          const manifestResult = await repoProcessor.updateManifestOnly(
            repoInfo,
            repoConfig,
            {
              branchName: "chore/sync-labels",
              workDir,
              configId: config.id,
              dryRun: options.dryRun,
              retries: options.retries,
            },
            { labels: result.manifestUpdate.labels }
          );
          if (!manifestResult.success && !manifestResult.skipped) {
            logger.info(
              `Warning: Failed to update manifest for ${repoName}: ${manifestResult.message}`
            );
          }
        }
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

/**
 * Fetches the managed labels list from a remote GitHub repo's manifest.
 * Returns an empty array if the manifest doesn't exist or can't be read.
 *
 * Uses the project's ICommandExecutor + escapeShellArg pattern for safe
 * command execution. All inputs are from parsed config (owner/repo), not
 * user input.
 */
async function fetchManagedLabels(
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
    return getManagedLabels(manifest, configId);
  } catch {
    return [];
  }
}
