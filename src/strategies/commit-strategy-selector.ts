import { RepoInfo, isGitHubRepo } from "../repo-detector.js";
import { CommitStrategy } from "./commit-strategy.js";
import { GitCommitStrategy } from "./git-commit-strategy.js";
import { GraphQLCommitStrategy } from "./graphql-commit-strategy.js";
import { CommandExecutor } from "../command-executor.js";

/**
 * Factory function to get the appropriate commit strategy for a repository.
 *
 * For GitHub repositories with GH_INSTALLATION_TOKEN set, returns GraphQLCommitStrategy
 * which creates verified commits via the GitHub GraphQL API.
 *
 * For all other cases (GitHub with PAT, Azure DevOps, GitLab), returns GitCommitStrategy
 * which uses standard git commands.
 *
 * @param repoInfo - Repository information
 * @param executor - Optional command executor for shell commands
 */
export function getCommitStrategy(
  repoInfo: RepoInfo,
  executor?: CommandExecutor
): CommitStrategy {
  if (isGitHubRepo(repoInfo) && process.env.GH_INSTALLATION_TOKEN) {
    return new GraphQLCommitStrategy(executor);
  }
  return new GitCommitStrategy(executor);
}
