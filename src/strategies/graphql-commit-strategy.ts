import {
  CommitStrategy,
  CommitOptions,
  CommitResult,
} from "./commit-strategy.js";
import { CommandExecutor, defaultExecutor } from "../command-executor.js";
import { isGitHubRepo, GitHubRepoInfo } from "../repo-detector.js";
import { escapeShellArg } from "../shell-utils.js";

/**
 * Maximum payload size for GitHub GraphQL API (50MB).
 * Base64 encoding adds ~33% overhead, so raw content should be checked.
 */
export const MAX_PAYLOAD_SIZE = 50 * 1024 * 1024;

/**
 * GraphQL-based commit strategy using GitHub's createCommitOnBranch mutation.
 * Used with GitHub App authentication. Commits via this strategy ARE verified
 * by GitHub (signed by the GitHub App).
 *
 * This strategy is GitHub-only and requires the `gh` CLI to be authenticated.
 */
export class GraphQLCommitStrategy implements CommitStrategy {
  private executor: CommandExecutor;

  constructor(executor?: CommandExecutor) {
    this.executor = executor ?? defaultExecutor;
  }

  /**
   * Create a commit with the given file changes using GitHub's GraphQL API.
   * Uses the createCommitOnBranch mutation for verified commits.
   *
   * @returns Commit result with SHA and verified: true
   * @throws Error if repo is not GitHub, payload exceeds 50MB, or API fails
   */
  async commit(options: CommitOptions): Promise<CommitResult> {
    const {
      repoInfo,
      branchName,
      message,
      fileChanges,
      workDir,
      retries = 3,
    } = options;

    // Validate this is a GitHub repo
    if (!isGitHubRepo(repoInfo)) {
      throw new Error(
        `GraphQL commit strategy requires GitHub repositories. Got: ${repoInfo.type}`
      );
    }

    const githubInfo = repoInfo as GitHubRepoInfo;

    // Separate additions from deletions
    const additions = fileChanges.filter((fc) => fc.content !== null);
    const deletions = fileChanges.filter((fc) => fc.content === null);

    // Calculate payload size (base64 adds ~33% overhead)
    const totalSize = additions.reduce((sum, fc) => {
      const base64Size = Math.ceil((fc.content!.length * 4) / 3);
      return sum + base64Size;
    }, 0);

    if (totalSize > MAX_PAYLOAD_SIZE) {
      throw new Error(
        `GraphQL payload exceeds 50 MB limit (${Math.round(totalSize / (1024 * 1024))} MB). ` +
          `Consider using smaller files or the git commit strategy.`
      );
    }

    // Retry loop for expectedHeadOid mismatch
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Get current HEAD SHA for optimistic locking
        const headSha = await this.executor.exec("git rev-parse HEAD", workDir);

        // Build and execute the GraphQL mutation
        const result = await this.executeGraphQLMutation(
          githubInfo,
          branchName,
          message,
          headSha.trim(),
          additions,
          deletions,
          workDir
        );

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is an expectedHeadOid mismatch error (retryable)
        if (this.isHeadOidMismatchError(lastError) && attempt < retries) {
          // Retry - the next iteration will get the fresh HEAD SHA
          continue;
        }

        // For other errors, throw immediately
        throw lastError;
      }
    }

    // Should not reach here, but just in case
    throw lastError ?? new Error("Unexpected error in GraphQL commit");
  }

  /**
   * Execute the createCommitOnBranch GraphQL mutation.
   */
  private async executeGraphQLMutation(
    repoInfo: GitHubRepoInfo,
    branchName: string,
    message: string,
    expectedHeadOid: string,
    additions: Array<{ path: string; content: string | null }>,
    deletions: Array<{ path: string; content: string | null }>,
    workDir: string
  ): Promise<CommitResult> {
    const repositoryNameWithOwner = `${repoInfo.owner}/${repoInfo.repo}`;

    // Build file additions with base64 encoding
    const fileAdditions = additions.map((fc) => ({
      path: fc.path,
      contents: Buffer.from(fc.content!).toString("base64"),
    }));

    // Build file deletions (path only)
    const fileDeletions = deletions.map((fc) => ({
      path: fc.path,
    }));

    // Build the mutation
    const mutation = `
      mutation CreateCommit($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) {
          commit {
            oid
          }
        }
      }
    `;

    // Build the input variables
    // Note: GitHub API doesn't accept empty arrays, so only include fields when non-empty
    const fileChanges: {
      additions?: Array<{ path: string; contents: string }>;
      deletions?: Array<{ path: string }>;
    } = {};
    if (fileAdditions.length > 0) {
      fileChanges.additions = fileAdditions;
    }
    if (fileDeletions.length > 0) {
      fileChanges.deletions = fileDeletions;
    }

    const variables = {
      input: {
        branch: {
          repositoryNameWithOwner,
          branchName,
        },
        expectedHeadOid,
        message: {
          headline: message,
        },
        fileChanges,
      },
    };

    // Build the gh api graphql command
    const hostnameArg =
      repoInfo.host !== "github.com"
        ? `--hostname ${escapeShellArg(repoInfo.host)}`
        : "";

    const command = `gh api graphql ${hostnameArg} -f query=${escapeShellArg(mutation)} -f variables=${escapeShellArg(JSON.stringify(variables))}`;

    const response = await this.executor.exec(command, workDir);

    // Parse the response
    const parsed = JSON.parse(response);

    if (parsed.errors) {
      throw new Error(
        `GraphQL error: ${parsed.errors.map((e: { message: string }) => e.message).join(", ")}`
      );
    }

    const oid = parsed.data?.createCommitOnBranch?.commit?.oid;
    if (!oid) {
      throw new Error("GraphQL response missing commit OID");
    }

    return {
      sha: oid,
      verified: true, // GraphQL commits via GitHub App are verified
      pushed: true, // GraphQL commits are pushed directly
    };
  }

  /**
   * Check if an error is due to expectedHeadOid mismatch (optimistic locking failure).
   * This happens when the branch was updated between getting HEAD and making the commit.
   */
  private isHeadOidMismatchError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("expected branch to point to") ||
      message.includes("expectedheadoid") ||
      message.includes("head oid")
    );
  }
}
