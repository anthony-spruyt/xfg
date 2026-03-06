import { RepoInfo, isGitHubRepo } from "../shared/repo-detector.js";
import type { ICommitStrategy } from "./types.js";
import { GitCommitStrategy } from "./git-commit-strategy.js";
import { GraphQLCommitStrategy } from "./graphql-commit-strategy.js";
import { GitHubAppTokenManager } from "./github-app-token-manager.js";
import { ICommandExecutor } from "../shared/command-executor.js";

export interface GitHubAppCredentials {
  appId: string;
  privateKey: string;
}

/**
 * Creates a GitHubAppTokenManager from credentials, or null if not provided.
 */
export function createTokenManager(
  credentials?: GitHubAppCredentials
): GitHubAppTokenManager | null {
  if (!credentials) {
    return null;
  }
  return new GitHubAppTokenManager(credentials.appId, credentials.privateKey);
}

/**
 * Factory function to get the appropriate commit strategy for a repository.
 *
 * For GitHub repositories with GitHub App credentials, returns GraphQLCommitStrategy
 * which creates verified commits via the GitHub GraphQL API.
 *
 * For all other cases (GitHub with PAT, Azure DevOps, GitLab), returns GitCommitStrategy
 * which uses standard git commands.
 *
 * @param repoInfo - Repository information
 * @param executor - Optional command executor for shell commands
 * @param hasAppCredentials - Whether GitHub App credentials are configured
 */
export function getCommitStrategy(
  repoInfo: RepoInfo,
  executor?: ICommandExecutor,
  hasAppCredentials?: boolean
): ICommitStrategy {
  if (isGitHubRepo(repoInfo) && hasAppCredentials) {
    return new GraphQLCommitStrategy(executor);
  }
  return new GitCommitStrategy(executor);
}
