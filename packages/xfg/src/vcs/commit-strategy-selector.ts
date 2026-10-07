import { type RepoInfo, isGitHubRepo } from "../repo/index.js";
import type { ICommitStrategy } from "./types.js";
import { GitCommitStrategy } from "./git-commit-strategy.js";
import { GraphQLCommitStrategy } from "./graphql-commit-strategy.js";
import { FileModeFixupCommitStrategy } from "./file-mode-fixup-commit-strategy.js";
import { GitHubAppTokenManager } from "./github-app-token-manager.js";
import type { ICommandExecutor } from "../shared/command-executor.js";
import {
  createGitHubHostPolicyFromEnv,
  type IGitHubHostPolicy,
} from "../shared/github-host-policy.js";

interface GitHubAppCredentials {
  clientId: string;
  privateKey: string;
}

/**
 * Creates a GitHubAppTokenManager from credentials, or null if not provided.
 */
export function createTokenManager(
  credentials?: GitHubAppCredentials,
  hostPolicy?: IGitHubHostPolicy
): GitHubAppTokenManager | null {
  if (!credentials) {
    return null;
  }
  return new GitHubAppTokenManager(
    credentials.clientId,
    credentials.privateKey,
    hostPolicy
  );
}

export function createTokenManagerFromEnv(
  env: NodeJS.ProcessEnv,
  hostPolicy: IGitHubHostPolicy = createGitHubHostPolicyFromEnv(env)
): GitHubAppTokenManager | null {
  const clientId = env.XFG_GITHUB_CLIENT_ID;
  const privateKey = env.XFG_GITHUB_APP_PRIVATE_KEY;
  return createTokenManager(
    clientId && privateKey ? { clientId, privateKey } : undefined,
    hostPolicy
  );
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
