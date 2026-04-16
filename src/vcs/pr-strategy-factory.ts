import {
  type RepoInfo,
  isGitHubRepo,
  isAzureDevOpsRepo,
  isGitLabRepo,
} from "../repo/index.js";
import type { IPRStrategy } from "./types.js";
import { SyncError } from "../shared/errors.js";
import { GitHubPRStrategy } from "./github-pr-strategy.js";
import { AdoPRStrategy } from "./ado-pr-strategy.js";
import { GitLabPRStrategy } from "./gitlab-pr-strategy.js";
import type { ICommandExecutor } from "../shared/command-executor.js";
import type { IPRStrategyLogger } from "./pr-strategy.js";

export function createPRStrategy(
  repoInfo: RepoInfo,
  executor: ICommandExecutor,
  log?: IPRStrategyLogger
): IPRStrategy {
  if (isGitHubRepo(repoInfo)) {
    return new GitHubPRStrategy(executor, log);
  }
  if (isAzureDevOpsRepo(repoInfo)) {
    return new AdoPRStrategy(executor, log);
  }
  if (isGitLabRepo(repoInfo)) {
    return new GitLabPRStrategy(executor, log);
  }
  const _exhaustive: never = repoInfo;
  throw new SyncError(
    `Unknown repository type: ${JSON.stringify(_exhaustive)}`
  );
}
