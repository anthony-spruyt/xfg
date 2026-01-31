import {
  RepoInfo,
  isGitHubRepo,
  isAzureDevOpsRepo,
  isGitLabRepo,
} from "../repo-detector.js";
import type { PRStrategy } from "./pr-strategy.js";
import { GitHubPRStrategy } from "./github-pr-strategy.js";
import { AzurePRStrategy } from "./azure-pr-strategy.js";
import { GitLabPRStrategy } from "./gitlab-pr-strategy.js";
import { CommandExecutor } from "../command-executor.js";

export type {
  PRStrategy,
  PRStrategyOptions,
  CloseExistingPROptions,
  PRMergeConfig,
  MergeOptions,
  MergeResult,
} from "./pr-strategy.js";
export { BasePRStrategy, PRWorkflowExecutor } from "./pr-strategy.js";
export { GitHubPRStrategy } from "./github-pr-strategy.js";
export { AzurePRStrategy } from "./azure-pr-strategy.js";
export { GitLabPRStrategy } from "./gitlab-pr-strategy.js";

// Commit strategy exports
export type {
  CommitStrategy,
  CommitOptions,
  CommitResult,
  FileChange,
} from "./commit-strategy.js";
export { GitCommitStrategy } from "./git-commit-strategy.js";
export {
  GraphQLCommitStrategy,
  MAX_PAYLOAD_SIZE,
} from "./graphql-commit-strategy.js";
export {
  getCommitStrategy,
  hasGitHubAppCredentials,
} from "./commit-strategy-selector.js";

/**
 * Factory function to get the appropriate PR strategy for a repository.
 * @param repoInfo - Repository information
 * @param executor - Optional command executor for shell commands
 */
export function getPRStrategy(
  repoInfo: RepoInfo,
  executor?: CommandExecutor
): PRStrategy {
  if (isGitHubRepo(repoInfo)) {
    return new GitHubPRStrategy(executor);
  }

  if (isAzureDevOpsRepo(repoInfo)) {
    return new AzurePRStrategy(executor);
  }

  if (isGitLabRepo(repoInfo)) {
    return new GitLabPRStrategy(executor);
  }

  // Type exhaustiveness check - should never reach here
  const _exhaustive: never = repoInfo;
  throw new Error(`Unknown repository type: ${JSON.stringify(_exhaustive)}`);
}
