import { GitOps } from "./git-ops.js";
import { escapeShellArg } from "../shared/shell-utils.js";
import { withRetry } from "../shared/retry-utils.js";
import { logger } from "../shared/logger.js";
import { toErrorMessage } from "../shared/type-guards.js";
import type { GitAuthOptions, INetworkGitOps } from "./git-ops-types.js";

export type {
  GitAuthOptions,
  ILocalGitOps,
  INetworkGitOps,
} from "./git-ops-types.js";

/**
 * Adds authentication to network git operations.
 *
 * When auth options are provided, clone uses an embedded token URL which sets
 * the remote origin. Subsequent operations (fetch, push, getDefaultBranch)
 * reuse that authenticated remote URL — no extra auth setup per operation.
 *
 * Local operations live on GitOps (ILocalGitOps) — no wrapping needed.
 */
export class AuthenticatedGitOps implements INetworkGitOps {
  private readonly gitOps: GitOps;
  private readonly auth?: GitAuthOptions;

  constructor(gitOps: GitOps, auth?: GitAuthOptions) {
    this.gitOps = gitOps;
    this.auth = auth;
  }

  private async execWithRetry(command: string): Promise<string> {
    return withRetry(
      () => this.gitOps.executor.exec(command, this.gitOps.workDir),
      { retries: this.gitOps.retries }
    );
  }

  /**
   * Build the authenticated remote URL.
   */
  private getAuthenticatedUrl(): string {
    const { token, host, owner, repo } = this.auth!;
    return `https://x-access-token:${token}@${host}/${owner}/${repo}`;
  }

  async clone(gitUrl: string): Promise<void> {
    if (!this.auth) {
      return this.gitOps.clone(gitUrl);
    }
    const authUrl = escapeShellArg(this.getAuthenticatedUrl());
    await this.execWithRetry(`git clone ${authUrl} .`);
  }

  async fetch(options?: { prune?: boolean }): Promise<void> {
    if (!this.auth) {
      return this.gitOps.fetch(options);
    }
    const pruneFlag = options?.prune ? " --prune" : "";
    await this.execWithRetry(`git fetch origin${pruneFlag}`);
  }

  async push(branchName: string, options?: { force?: boolean }): Promise<void> {
    if (!this.auth) {
      return this.gitOps.push(branchName, options);
    }
    const forceFlag = options?.force ? "--force-with-lease " : "";
    const safeBranch = escapeShellArg(branchName);
    await this.execWithRetry(`git push ${forceFlag}-u origin ${safeBranch}`);
  }

  async getDefaultBranch(): Promise<{ branch: string; method: string }> {
    if (!this.auth) {
      return this.gitOps.getDefaultBranch();
    }
    try {
      const remoteInfo = await this.execWithRetry(`git remote show origin`);
      const match = remoteInfo.match(/HEAD branch: (\S+)/);
      if (match && match[1] !== "(unknown)") {
        return { branch: match[1], method: "remote HEAD" };
      }
    } catch (error) {
      const msg = toErrorMessage(error);
      logger.debug(`git remote show origin failed - ${msg}`);
    }

    // Local fallback operations don't need auth — delegate to GitOps
    return this.gitOps.getDefaultBranchLocal();
  }

  /**
   * Execute ls-remote with authentication.
   * Used by GraphQLCommitStrategy to check if branch exists on remote.
   *
   * @param options.skipRetry - If true, don't retry on failure. Use when checking
   *   branch existence where failure is expected for new branches.
   */
  async lsRemote(
    branchName: string,
    options?: { skipRetry?: boolean }
  ): Promise<string> {
    const safeBranch = escapeShellArg(branchName);
    const command = `git ls-remote --exit-code --heads origin ${safeBranch}`;

    if (options?.skipRetry) {
      return this.gitOps.executor.exec(command, this.gitOps.workDir);
    }
    return this.execWithRetry(command);
  }

  /**
   * Execute push with custom refspec (e.g., HEAD:branchName).
   * Used by GraphQLCommitStrategy for creating/deleting remote branches.
   */
  async pushRefspec(
    refspec: string,
    options?: { delete?: boolean }
  ): Promise<void> {
    const deleteFlag = options?.delete ? "--delete " : "";
    const safeRefspec = escapeShellArg(refspec);
    await this.execWithRetry(`git push ${deleteFlag}-u origin ${safeRefspec}`);
  }

  /**
   * Fetch a specific branch from remote.
   * Used by GraphQLCommitStrategy to update local refs.
   */
  async fetchBranch(branchName: string): Promise<void> {
    const safeBranch = escapeShellArg(branchName);
    await this.execWithRetry(
      `git fetch origin +${safeBranch}:refs/remotes/origin/${safeBranch}`
    );
  }
}
