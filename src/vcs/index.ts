// Types
export type {
  PRMergeConfig,
  MergeResult,
  PRStrategyOptions,
  MergeOptions,
  CloseExistingPROptions,
  IPRStrategy,
  FileChange,
  CommitOptions,
  CommitResult,
  ICommitStrategy,
} from "./types.js";

// Core git operations
export {
  GitOps,
  sanitizeBranchName,
  validateBranchName,
  type IGitOps,
  type GitOpsOptions,
} from "./git-ops.js";

// Authenticated git operations (with per-command auth)
export {
  AuthenticatedGitOps,
  type IAuthenticatedGitOps,
  type GitAuthOptions,
} from "./authenticated-git-ops.js";

// GitHub App token management
export { GitHubAppTokenManager } from "./github-app-token-manager.js";

// PR creation utilities
export {
  createPR,
  mergePR,
  formatPRBody,
  formatPRTitle,
  escapeShellArg,
  type PROptions,
  type PRResult,
  type FileAction,
  type MergePROptions,
} from "./pr-creator.js";

// PR strategies
export { BasePRStrategy, PRWorkflowExecutor } from "./pr-strategy.js";
export { GitHubPRStrategy } from "./github-pr-strategy.js";
export { AzurePRStrategy } from "./azure-pr-strategy.js";
export { GitLabPRStrategy } from "./gitlab-pr-strategy.js";

// Commit strategies
export { GitCommitStrategy } from "./git-commit-strategy.js";
export {
  GraphQLCommitStrategy,
  MAX_PAYLOAD_SIZE,
} from "./graphql-commit-strategy.js";
export {
  getCommitStrategy,
  hasGitHubAppCredentials,
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
