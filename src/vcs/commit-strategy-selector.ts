import { type RepoInfo, isGitHubRepo } from "../shared/repo-detector.js";
import type { ICommitStrategy } from "./types.js";
import { GitCommitStrategy } from "./git-commit-strategy.js";
import { GraphQLCommitStrategy } from "./graphql-commit-strategy.js";
import { FileModeFixupCommitStrategy } from "./file-mode-fixup-commit-strategy.js";
import { GitHubAppTokenManager } from "./github-app-token-manager.js";
import type { ICommandExecutor } from "../shared/command-executor.js";

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
 * Returns FileModeFixupCommitStrategy (decorating GraphQLCommitStrategy) for
 * GitHub repos with App credentials (verified commits + executable file mode
 * support), or GitCommitStrategy for all other cases.
 */
export function createCommitStrategy(
  repoInfo: RepoInfo,
  executor: ICommandExecutor,
  hasAppCredentials?: boolean
): ICommitStrategy {
  if (isGitHubRepo(repoInfo) && hasAppCredentials) {
    const inner = new GraphQLCommitStrategy(executor);
    return new FileModeFixupCommitStrategy(inner, executor);
  }
  return new GitCommitStrategy(executor);
}
