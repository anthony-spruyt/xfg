import { RepoInfo, isGitHubRepo, isAzureDevOpsRepo } from "../repo-detector.js";
import type { PRStrategy } from "./pr-strategy.js";
import { GitHubPRStrategy } from "./github-pr-strategy.js";
import { AzurePRStrategy } from "./azure-pr-strategy.js";
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

/**
 * Factory function to get the appropriate PR strategy for a repository.
 * @param repoInfo - Repository information
 * @param executor - Optional command executor for shell commands
 */
export function getPRStrategy(
  repoInfo: RepoInfo,
  executor?: CommandExecutor,
): PRStrategy {
  if (isGitHubRepo(repoInfo)) {
    return new GitHubPRStrategy(executor);
  }

  if (isAzureDevOpsRepo(repoInfo)) {
    return new AzurePRStrategy(executor);
  }

  // Type exhaustiveness check - should never reach here
  const _exhaustive: never = repoInfo;
  throw new Error(`Unknown repository type: ${JSON.stringify(_exhaustive)}`);
}
