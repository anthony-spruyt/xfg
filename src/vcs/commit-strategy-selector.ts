import { RepoInfo, isGitHubRepo } from "../shared/repo-detector.js";
import type { ICommitStrategy } from "./types.js";
import { GitCommitStrategy } from "./git-commit-strategy.js";
import { GraphQLCommitStrategy } from "./graphql-commit-strategy.js";
import { ICommandExecutor } from "../shared/command-executor.js";

/**
 * Checks if GitHub App credentials are configured via environment variables.
 * Both XFG_GITHUB_APP_ID and XFG_GITHUB_APP_PRIVATE_KEY must be set.
 */
export function hasGitHubAppCredentials(): boolean {
  return !!(
    process.env.XFG_GITHUB_APP_ID && process.env.XFG_GITHUB_APP_PRIVATE_KEY
  );
}

/**
 * Factory function to get the appropriate commit strategy for a repository.
 *
 * For GitHub repositories with GitHub App credentials (XFG_GITHUB_APP_ID and
 * XFG_GITHUB_APP_PRIVATE_KEY), returns GraphQLCommitStrategy which creates
 * verified commits via the GitHub GraphQL API.
 *
 * For all other cases (GitHub with PAT, Azure DevOps, GitLab), returns GitCommitStrategy
 * which uses standard git commands.
 *
 * @param repoInfo - Repository information
 * @param executor - Optional command executor for shell commands
 */
export function getCommitStrategy(
  repoInfo: RepoInfo,
  executor?: ICommandExecutor
): ICommitStrategy {
  if (isGitHubRepo(repoInfo) && hasGitHubAppCredentials()) {
    return new GraphQLCommitStrategy(executor);
  }
  return new GitCommitStrategy(executor);
}
