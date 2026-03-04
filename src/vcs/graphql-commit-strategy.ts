import type { ICommitStrategy, CommitOptions, CommitResult } from "./types.js";
import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import { isGitHubRepo, GitHubRepoInfo } from "../shared/repo-detector.js";
import { escapeShellArg } from "../shared/shell-utils.js";
import {
  withRetry,
  CORE_PERMANENT_ERROR_PATTERNS,
  DEFAULT_PERMANENT_ERROR_PATTERNS,
} from "../shared/retry-utils.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { parseApiJson } from "../shared/gh-api-utils.js";

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
export function validateSafeBranchName(branchName: string): void {
  if (!SAFE_BRANCH_NAME_PATTERN.test(branchName)) {
    throw new Error(
      `Invalid branch name for GraphQL commit strategy: "${branchName}". ` +
        `Branch names must start with alphanumeric and contain only ` +
        `alphanumeric characters, hyphens, underscores, dots, and forward slashes.`
    );
  }
}

/**
 * OID mismatch error patterns that should NOT be retried by the inner withRetry.
 * The outer retry loop in commit() handles these by fetching a fresh HEAD OID.
 */
const OID_MISMATCH_PATTERNS: RegExp[] = [
  /expected branch to point to/i,
  /expectedheadoid/i,
  /head oid/i,
  /was provided invalid value/i,
];

/**
 * GraphQL-based commit strategy using GitHub's createCommitOnBranch mutation.
 * Used with GitHub App authentication. Commits via this strategy ARE verified
 * by GitHub (signed by the GitHub App).
 *
 * This strategy is GitHub-only and requires the `gh` CLI to be authenticated.
 */
export class GraphQLCommitStrategy implements ICommitStrategy {
  /**
   * GraphQL permanent error patterns for ref operations.
   * Extends CORE_PERMANENT_ERROR_PATTERNS with GraphQL-specific patterns
   * (omits git-CLI patterns like /remote\s*rejected/i).
   */
  private static readonly GRAPHQL_PERMANENT_ERROR_PATTERNS: RegExp[] = [
    ...CORE_PERMANENT_ERROR_PATTERNS,
    /could\s*not\s*resolve/i,
    /already\s*exists/i,
  ];

  private executor: ICommandExecutor;

  constructor(executor?: ICommandExecutor) {
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
      token,
    } = options;

    // Validate this is a GitHub repo
    if (!isGitHubRepo(repoInfo)) {
      throw new Error(
        `GraphQL commit strategy requires GitHub repositories. Got: ${repoInfo.type}`
      );
    }

    // Validate branch name is safe for shell commands
    validateSafeBranchName(branchName);

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

    // Get networkOps for authenticated network operations
    const networkOps = options.networkOps;

    // Ensure the branch exists on remote and is up-to-date with local HEAD
    // createCommitOnBranch requires the branch to already exist
    // For PR branches (force=true), we force-update to ensure fresh start from main
    await this.ensureBranchExistsOnRemote(
      branchName,
      workDir,
      options.force,
      githubInfo,
      token
    );

    // Retry loop for expectedHeadOid mismatch
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Fetch from remote to ensure we have the latest HEAD
        // This is critical for expectedHeadOid to match
        const safeBranch = escapeShellArg(branchName);
        if (networkOps) {
          await networkOps.fetchBranch(branchName);
        } else {
          await this.executor.exec(
            `git fetch origin +${safeBranch}:refs/remotes/origin/${safeBranch}`,
            workDir
          );
        }

        // Get the remote HEAD SHA for this branch (not local HEAD)
        const headSha = await this.executor.exec(
          `git rev-parse origin/${safeBranch}`,
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
          workDir,
          token
        );

        return result;
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error(toErrorMessage(error));

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
    workDir: string,
    token?: string
  ): Promise<CommitResult> {
    const repositoryNameWithOwner = `${repoInfo.owner}/${repoInfo.repo}`;

    const fileAdditions = additions.map((fc) => ({
      path: fc.path,
      contents: Buffer.from(fc.content!).toString("base64"),
    }));

    const fileDeletions = deletions.map((fc) => ({
      path: fc.path,
    }));

    const mutation =
      "mutation CreateCommit($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }";

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

    const requestBody = JSON.stringify({
      query: mutation,
      variables,
    });

    const hostnameArg =
      repoInfo.host !== "github.com"
        ? `--hostname ${escapeShellArg(repoInfo.host)}`
        : "";

    const tokenEnv = token ? { GH_TOKEN: token } : undefined;

    const command = `echo ${escapeShellArg(requestBody)} | gh api graphql ${hostnameArg} --input -`;

    let response: string;
    try {
      response = await withRetry(
        () => this.executor.exec(command, workDir, { env: tokenEnv }),
        {
          permanentErrorPatterns: [
            ...DEFAULT_PERMANENT_ERROR_PATTERNS,
            ...OID_MISMATCH_PATTERNS,
          ],
        }
      );
    } catch (error) {
      throw this.sanitizeCommandError(error, repositoryNameWithOwner);
    }

    // Parse the response
    const parsed = parseApiJson<Record<string, unknown>>(
      response,
      "GraphQL createCommitOnBranch response"
    );

    if (parsed.errors) {
      const errors = parsed.errors as Array<{ message: string }>;
      throw new Error(
        `GraphQL error: ${errors.map((e) => e.message).join(", ")}`
      );
    }

    const data = parsed.data as Record<string, unknown> | undefined;
    const commit = (
      data?.createCommitOnBranch as Record<string, unknown> | undefined
    )?.commit as Record<string, unknown> | undefined;
    const oid = commit?.oid as string | undefined;
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
   * Ensure the branch exists on the remote and matches local HEAD.
   * createCommitOnBranch requires the branch to already exist.
   *
   * Uses GraphQL ref mutations instead of git push to support repos
   * with required_signatures on all branches.
   *
   * For PR branches (force=true): delete existing remote branch and recreate
   * from local HEAD to ensure a fresh start from main.
   *
   * For direct mode (force=false): just ensure branch exists.
   */
  private async ensureBranchExistsOnRemote(
    branchName: string,
    workDir: string,
    force?: boolean,
    repoInfo?: GitHubRepoInfo,
    token?: string
  ): Promise<void> {
    if (!repoInfo) {
      throw new Error("repoInfo is required for GraphQL ref operations");
    }

    const { repositoryId, refId } = await this.queryRemoteRef(
      repoInfo,
      branchName,
      workDir,
      token
    );

    if (refId && force) {
      // Branch exists + force: delete then recreate from local HEAD
      await this.deleteRemoteRef(refId, workDir, repoInfo, token);
      const sha = (
        await this.executor.exec("git rev-parse HEAD", workDir)
      ).trim();
      await this.createRemoteRef(
        repositoryId,
        branchName,
        sha,
        workDir,
        repoInfo,
        token
      );
    } else if (!refId) {
      // Branch doesn't exist: create from local HEAD
      // Race condition: on newly created forks, queryRemoteRef may return null
      // due to eventual consistency, but the branch may exist by the time we
      // try to create it. Treat "already exists" as success.
      const sha = (
        await this.executor.exec("git rev-parse HEAD", workDir)
      ).trim();
      try {
        await this.createRemoteRef(
          repositoryId,
          branchName,
          sha,
          workDir,
          repoInfo,
          token
        );
      } catch (error) {
        const msg = toErrorMessage(error);
        if (/already exists/i.test(msg)) {
          // Branch was created between our query and create — that's fine
          return;
        }
        throw error;
      }
    }
    // refId exists + !force: no-op (branch already exists)
  }

  /**
   * Sanitize command execution errors to remove the GraphQL payload.
   * Node.js execSync errors include "Command failed: <full command>\n<stderr>".
   * The command contains the entire GraphQL mutation payload (potentially megabytes
   * of base64-encoded file contents). This extracts just the meaningful stderr.
   */
  private sanitizeCommandError(error: unknown, repo: string): Error {
    const originalMessage = toErrorMessage(error);

    let cleanMessage: string;

    if (originalMessage.startsWith("Command failed:")) {
      // Extract stderr: everything after the first newline
      const newlineIndex = originalMessage.indexOf("\n");
      cleanMessage =
        newlineIndex >= 0
          ? originalMessage.substring(newlineIndex + 1).trim()
          : "unknown error";
    } else {
      cleanMessage = originalMessage;
    }

    // Safety truncation for any remaining oversized messages
    if (cleanMessage.length > 2000) {
      cleanMessage = cleanMessage.substring(0, 2000) + "... (truncated)";
    }

    return new Error(`GraphQL commit failed for ${repo}: ${cleanMessage}`);
  }

  /**
   * Check if an error is due to expectedHeadOid mismatch (optimistic locking failure).
   * This happens when the branch was updated between getting HEAD and making the commit.
   */
  private isHeadOidMismatchError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return OID_MISMATCH_PATTERNS.some((pattern) => pattern.test(message));
  }

  /**
   * Execute a GraphQL query or mutation for ref operations.
   * Handles command construction, retry, error sanitization, and response parsing.
   * Uses gh CLI's --input flag to pass GraphQL via stdin (same pattern as executeGraphQLMutation).
   */
  private async executeGraphQLRefOp(
    queryOrMutation: string,
    repoInfo: GitHubRepoInfo,
    workDir: string,
    token?: string
  ): Promise<{
    data?: Record<string, unknown>;
    errors?: Array<{ message: string }>;
  }> {
    const requestBody = JSON.stringify({ query: queryOrMutation });

    const hostnameArg =
      repoInfo.host !== "github.com"
        ? `--hostname ${escapeShellArg(repoInfo.host)}`
        : "";
    const tokenEnv = token ? { GH_TOKEN: token } : undefined;
    const command = `echo ${escapeShellArg(requestBody)} | gh api graphql ${hostnameArg} --input -`;

    let response: string;
    try {
      response = await withRetry(
        () => this.executor.exec(command, workDir, { env: tokenEnv }),
        {
          permanentErrorPatterns:
            GraphQLCommitStrategy.GRAPHQL_PERMANENT_ERROR_PATTERNS,
        }
      );
    } catch (error) {
      throw this.sanitizeCommandError(
        error,
        `${repoInfo.owner}/${repoInfo.repo}`
      );
    }

    const parsed = parseApiJson<{
      data?: Record<string, unknown>;
      errors?: Array<{ message: string }>;
    }>(response, "GraphQL API response");
    if (parsed.errors) {
      throw new Error(
        `GraphQL error: ${parsed.errors.map((e) => e.message).join(", ")}`
      );
    }

    return parsed;
  }

  /**
   * Query the remote for a repository's Node ID and a ref's Node ID.
   * Returns repositoryId (always) and refId (null if branch doesn't exist).
   */
  private async queryRemoteRef(
    repoInfo: GitHubRepoInfo,
    branchName: string,
    workDir: string,
    token?: string
  ): Promise<{ repositoryId: string; refId: string | null }> {
    const query = `{ repository(owner: ${JSON.stringify(repoInfo.owner)}, name: ${JSON.stringify(repoInfo.repo)}) { id ref(qualifiedName: ${JSON.stringify(`refs/heads/${branchName}`)}) { id } } }`;

    const parsed = await this.executeGraphQLRefOp(
      query,
      repoInfo,
      workDir,
      token
    );

    const repo = parsed.data?.repository as
      | { id?: string; ref?: { id?: string } }
      | undefined;
    const repositoryId = repo?.id;
    if (!repositoryId) {
      throw new Error(
        `GraphQL response missing repository ID for ${repoInfo.owner}/${repoInfo.repo}`
      );
    }

    return { repositoryId, refId: repo?.ref?.id ?? null };
  }

  /**
   * Create a branch ref on the remote via GraphQL createRef mutation.
   */
  private async createRemoteRef(
    repositoryId: string,
    branchName: string,
    oid: string,
    workDir: string,
    repoInfo: GitHubRepoInfo,
    token?: string
  ): Promise<void> {
    const mutation = `mutation { createRef(input: { repositoryId: ${JSON.stringify(repositoryId)}, name: ${JSON.stringify(`refs/heads/${branchName}`)}, oid: ${JSON.stringify(oid)} }) { clientMutationId } }`;
    await this.executeGraphQLRefOp(mutation, repoInfo, workDir, token);
  }

  /**
   * Delete a branch ref on the remote via GraphQL deleteRef mutation.
   */
  private async deleteRemoteRef(
    refId: string,
    workDir: string,
    repoInfo: GitHubRepoInfo,
    token?: string
  ): Promise<void> {
    const mutation = `mutation { deleteRef(input: { refId: ${JSON.stringify(refId)} }) { clientMutationId } }`;
    await this.executeGraphQLRefOp(mutation, repoInfo, workDir, token);
  }
}
