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
 * Pattern for valid git branch names that are also safe for shell commands.
 * Git branch names have strict rules:
 * - Cannot contain: space, ~, ^, :, ?, *, [, \, .., @{
 * - Cannot start with: - or .
 * - Cannot end with: / or .lock
 * - Cannot contain consecutive slashes
 *
 * This pattern allows only alphanumeric chars, hyphens, underscores, dots, and slashes
 * which covers all practical branch names and is shell-safe.
 */
export const SAFE_BRANCH_NAME_PATTERN = /^[a-zA-Z0-9][-a-zA-Z0-9_./]*$/;

/**
 * Validates that a branch name is safe for use in shell commands.
 * Throws an error if the branch name contains potentially dangerous characters.
 */
export function validateBranchName(branchName: string): void {
  if (!SAFE_BRANCH_NAME_PATTERN.test(branchName)) {
    throw new Error(
      `Invalid branch name for GraphQL commit strategy: "${branchName}". ` +
        `Branch names must start with alphanumeric and contain only ` +
        `alphanumeric characters, hyphens, underscores, dots, and forward slashes.`
    );
  }
}

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

    // Validate branch name is safe for shell commands
    validateBranchName(branchName);

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

    // Ensure the branch exists on remote before making GraphQL commit
    // createCommitOnBranch requires the branch to already exist
    await this.ensureBranchExistsOnRemote(branchName, workDir);

    // Retry loop for expectedHeadOid mismatch
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Fetch from remote to ensure we have the latest HEAD
        // This is critical for expectedHeadOid to match
        // Branch name was validated above, safe for shell use
        await this.executor.exec(
          `git fetch origin ${branchName}:refs/remotes/origin/${branchName}`,
          workDir
        );

        // Get the remote HEAD SHA for this branch (not local HEAD)
        const headSha = await this.executor.exec(
          `git rev-parse origin/${branchName}`,
          workDir
        );

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
          // Retry - the next iteration will fetch and get fresh HEAD SHA
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

    // Build the mutation (minified to avoid shell escaping issues with newlines)
    const mutation =
      "mutation CreateCommit($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }";

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

    // Build the GraphQL request body
    const requestBody = JSON.stringify({
      query: mutation,
      variables,
    });

    // Build the gh api graphql command
    // Use --input - to pass the JSON body via stdin (more reliable for complex nested JSON)
    // Use --hostname for GitHub Enterprise
    const hostnameArg =
      repoInfo.host !== "github.com"
        ? `--hostname ${escapeShellArg(repoInfo.host)}`
        : "";

    const command = `echo ${escapeShellArg(requestBody)} | gh api graphql ${hostnameArg} --input -`;

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
   * Ensure the branch exists on the remote.
   * createCommitOnBranch requires the branch to already exist.
   * If the branch doesn't exist, push it to create it.
   */
  private async ensureBranchExistsOnRemote(
    branchName: string,
    workDir: string
  ): Promise<void> {
    // Branch name was validated in commit(), safe for shell use
    try {
      // Check if the branch exists on remote
      await this.executor.exec(
        `git ls-remote --exit-code --heads origin ${branchName}`,
        workDir
      );
      // Branch exists, nothing to do
    } catch {
      // Branch doesn't exist on remote, push it
      // This pushes the current local branch to create it on remote
      await this.executor.exec(
        `git push -u origin HEAD:${branchName}`,
        workDir
      );
    }
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
      message.includes("head oid") ||
      // GitHub may return this generic error for OID mismatches
      message.includes("was provided invalid value")
    );
  }
}
