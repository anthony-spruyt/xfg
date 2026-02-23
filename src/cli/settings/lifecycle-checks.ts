import {
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
} from "../../shared/repo-detector.js";
import type { GitHubRepoInfo } from "../../shared/repo-detector.js";
import type { GitHubAppTokenManager } from "../../vcs/index.js";
import { logger } from "../../shared/logger.js";
import type { RepoResult } from "../../output/github-summary.js";
import { buildErrorResult } from "../../output/summary-utils.js";
import { runLifecycleCheck } from "../../lifecycle/index.js";
import type { IRepoLifecycleManager } from "../../lifecycle/index.js";
import type { Config, RepoConfig } from "../../config/types.js";
import type { RepoInfo } from "../../shared/repo-detector.js";
import type { ResultsCollector } from "./results-collector.js";
import type { SettingsOptions } from "../settings-command.js";

/**
 * Run lifecycle checks for all unique repos before processing.
 * Returns a Set of git URLs to skip (lifecycle errors or repos that would be created in dry-run).
 */
export async function runLifecycleChecks(
  allRepos: RepoConfig[],
  config: Config,
  options: SettingsOptions,
  lifecycleManager: IRepoLifecycleManager,
  results: RepoResult[],
  collector: ResultsCollector,
  tokenManager: GitHubAppTokenManager | null
): Promise<Set<string>> {
  const checked = new Set<string>();
  const skippedRepos = new Set<string>();

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
      const { outputLines, lifecycleResult } = await runLifecycleCheck(
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

      // In dry-run, skip processing repos that don't exist yet
      if (options.dryRun && lifecycleResult.action !== "existed") {
        skippedRepos.add(repoConfig.git);
      }
    } catch (error) {
      logger.error(
        i + 1,
        repoName,
        `Lifecycle error: ${error instanceof Error ? error.message : String(error)}`
      );
      results.push(buildErrorResult(repoName, error));
      collector.appendError(repoName, error);
      skippedRepos.add(repoConfig.git);
    }
  }

  return skippedRepos;
}
