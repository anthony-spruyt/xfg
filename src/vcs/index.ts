// Types
export type { PRMergeConfig, FileChange } from "./types.js";

// Commit strategies
export {
  getCommitStrategy,
  hasGitHubAppCredentials,
  createTokenManager,
} from "./commit-strategy-selector.js";

// PR strategy factory
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

export function getPRStrategy(
  repoInfo: RepoInfo,
  executor?: ICommandExecutor
): IPRStrategy {
  if (isGitHubRepo(repoInfo)) {
    return new GitHubPRStrategy(executor);
  }
  if (isAzureDevOpsRepo(repoInfo)) {
    return new AzurePRStrategy(executor);
  }
  if (isGitLabRepo(repoInfo)) {
    return new GitLabPRStrategy(executor);
  }
  const _exhaustive: never = repoInfo;
  throw new Error(`Unknown repository type: ${JSON.stringify(_exhaustive)}`);
}
