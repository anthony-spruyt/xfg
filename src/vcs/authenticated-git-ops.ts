import { GitOps } from "./git-ops.js";
import { escapeShellArg } from "../shared/shell-utils.js";
import { ICommandExecutor } from "../shared/command-executor.js";
import { withRetry } from "../shared/retry-utils.js";
import { logger } from "../shared/logger.js";
import { toErrorMessage } from "../shared/type-guards.js";

/**
 * Options for authenticated git operations.
 */
export interface GitAuthOptions {
  /** Access token for authentication */
  token: string;
  /** Git host (e.g., "github.com", "github.mycompany.com") */
  host: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
}

/**
 * Local filesystem and git operations that don't require authentication.
 * Implemented by GitOps directly — no wrapping needed.
 */
export interface ILocalGitOps {
  cleanWorkspace(): void;
  createBranch(branchName: string): Promise<void>;
  writeFile(fileName: string, content: string): void;
  setExecutable(fileName: string): Promise<void>;
  getFileContent(fileName: string): string | null;
  wouldChange(fileName: string, content: string): boolean;
  hasChanges(): Promise<boolean>;
  getChangedFiles(): Promise<string[]>;
  hasStagedChanges(): Promise<boolean>;
  fileExistsOnBranch(fileName: string, branch: string): Promise<boolean>;
  fileExists(fileName: string): boolean;
  deleteFile(fileName: string): void;
  commit(message: string): Promise<boolean>;
}

/**
 * Network git operations that may require authentication.
 * Implemented by AuthenticatedGitOps which adds token-based auth.
 */
export interface INetworkGitOps {
  clone(gitUrl: string): Promise<void>;
  fetch(options?: { prune?: boolean }): Promise<void>;
  push(branchName: string, options?: { force?: boolean }): Promise<void>;
  getDefaultBranch(): Promise<{ branch: string; method: string }>;
  lsRemote(
    branchName: string,
    options?: { skipRetry?: boolean }
  ): Promise<string>;
  pushRefspec(refspec: string, options?: { delete?: boolean }): Promise<void>;
  fetchBranch(branchName: string): Promise<void>;
}

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
  private gitOps: GitOps;
  private auth?: GitAuthOptions;
  private executor: ICommandExecutor;
  private workDir: string;
  private retries: number;

  constructor(gitOps: GitOps, auth?: GitAuthOptions) {
    this.gitOps = gitOps;
    this.auth = auth;
    this.executor = gitOps.executor;
    this.workDir = gitOps.workDir;
    this.retries = gitOps.retries;
  }
  private async execWithRetry(command: string): Promise<string> {
    return withRetry(() => this.executor.exec(command, this.workDir), {
      retries: this.retries,
    });
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
      return this.executor.exec(command, this.workDir);
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
