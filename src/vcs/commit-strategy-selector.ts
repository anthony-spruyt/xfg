import { RepoInfo, isGitHubRepo } from "../shared/repo-detector.js";
import type { ICommitStrategy } from "./types.js";
import { GitCommitStrategy } from "./git-commit-strategy.js";
import { GraphQLCommitStrategy } from "./graphql-commit-strategy.js";
import { GitHubAppTokenManager } from "./github-app-token-manager.js";
import { ICommandExecutor } from "../shared/command-executor.js";

interface GitHubAppCredentials {
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
 * Returns GraphQLCommitStrategy for GitHub repos with App credentials (verified commits),
 * or GitCommitStrategy for all other cases.
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
