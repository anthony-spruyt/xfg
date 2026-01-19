import { RepoInfo, isGitHubRepo, isAzureDevOpsRepo } from "../repo-detector.js";
import type { PRStrategy } from "./pr-strategy.js";
import { GitHubPRStrategy } from "./github-pr-strategy.js";
import { AzurePRStrategy } from "./azure-pr-strategy.js";

export type {
  PRStrategy,
  PRStrategyOptions,
  PRMergeConfig,
  MergeOptions,
  MergeResult,
} from "./pr-strategy.js";
export { BasePRStrategy, PRWorkflowExecutor } from "./pr-strategy.js";
export { GitHubPRStrategy } from "./github-pr-strategy.js";
export { AzurePRStrategy } from "./azure-pr-strategy.js";

/**
 * Factory function to get the appropriate PR strategy for a repository.
 * Note: repoInfo is passed via PRStrategyOptions.execute() rather than constructor
 * to ensure LSP compliance (all strategies have identical constructors).
 */
export function getPRStrategy(repoInfo: RepoInfo): PRStrategy {
  if (isGitHubRepo(repoInfo)) {
    return new GitHubPRStrategy();
  }

  if (isAzureDevOpsRepo(repoInfo)) {
    return new AzurePRStrategy();
  }

  // Type exhaustiveness check - should never reach here
  const _exhaustive: never = repoInfo;
  throw new Error(`Unknown repository type: ${JSON.stringify(_exhaustive)}`);
}
