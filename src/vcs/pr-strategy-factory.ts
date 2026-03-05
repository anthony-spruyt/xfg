import {
  RepoInfo,
  isGitHubRepo,
  isAzureDevOpsRepo,
  isGitLabRepo,
} from "../shared/repo-detector.js";
import type { IPRStrategy } from "./types.js";
import { GitHubPRStrategy } from "./github-pr-strategy.js";
import { AzurePRStrategy } from "./azure-pr-strategy.js";
import { GitLabPRStrategy } from "./gitlab-pr-strategy.js";
import { ICommandExecutor } from "../shared/command-executor.js";
import type { IPRStrategyLogger } from "./pr-strategy.js";

export function getPRStrategy(
  repoInfo: RepoInfo,
  executor?: ICommandExecutor,
  log?: IPRStrategyLogger
): IPRStrategy {
  if (isGitHubRepo(repoInfo)) {
    return new GitHubPRStrategy(executor, log);
  }
  if (isAzureDevOpsRepo(repoInfo)) {
    return new AzurePRStrategy(executor, log);
  }
  if (isGitLabRepo(repoInfo)) {
    return new GitLabPRStrategy(executor, log);
  }
  const _exhaustive: never = repoInfo;
  throw new Error(`Unknown repository type: ${JSON.stringify(_exhaustive)}`);
}
