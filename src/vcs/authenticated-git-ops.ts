import { escapeShellArg } from "../shared/shell-utils.js";
import { withRetry } from "../shared/retry-utils.js";
import { toErrorMessage } from "../shared/type-guards.js";
import type { ICommandExecutor } from "../shared/command-executor.js";
import type { GitAuthOptions, ILocalGitOps, IGitOps } from "./types.js";

/**
 * Adds authentication to network git operations and delegates local ops.
 *
 * When auth options are provided, clone uses an embedded token URL which sets
 * the remote origin. Subsequent operations (fetch, push, getDefaultBranch)
 * reuse that authenticated remote URL — no extra auth setup per operation.
 */
export class AuthenticatedGitOps implements IGitOps {
  constructor(
    private readonly localOps: ILocalGitOps,
    private readonly executor: ICommandExecutor,
    private readonly workDir: string,
    private readonly retries: number,
    private readonly auth?: GitAuthOptions,
    private readonly log?: { debug(msg: string): void }
  ) {}

  private async execWithRetry(command: string): Promise<string> {
    return withRetry(() => this.executor.exec(command, this.workDir), {
      retries: this.retries,
    });
  }

  /**
   * Build the authenticated remote URL.
   */
  private getAuthenticatedUrl(): string {
    if (!this.auth) {
      throw new Error("getAuthenticatedUrl() called without auth options");
    }
    const { token, host, owner, repo } = this.auth;
    return `https://x-access-token:${token}@${host}/${owner}/${repo}`;
  }

  // --- ILocalGitOps delegation ---

  cleanWorkspace(): void {
    return this.localOps.cleanWorkspace();
  }

  createBranch(branchName: string): Promise<void> {
    return this.localOps.createBranch(branchName);
  }

  writeFile(fileName: string, content: string): void {
    return this.localOps.writeFile(fileName, content);
  }

  setExecutable(fileName: string): Promise<void> {
    return this.localOps.setExecutable(fileName);
  }

  getFileContent(fileName: string): string | null {
    return this.localOps.getFileContent(fileName);
  }

  wouldChange(fileName: string, content: string): boolean {
    return this.localOps.wouldChange(fileName, content);
  }

  hasChanges(): Promise<boolean> {
    return this.localOps.hasChanges();
  }

  getChangedFiles(): Promise<string[]> {
    return this.localOps.getChangedFiles();
  }

  hasStagedChanges(): Promise<boolean> {
    return this.localOps.hasStagedChanges();
  }

  fileExistsOnBranch(fileName: string, branch: string): Promise<boolean> {
    return this.localOps.fileExistsOnBranch(fileName, branch);
  }

  fileExists(fileName: string): boolean {
    return this.localOps.fileExists(fileName);
  }

  deleteFile(fileName: string): void {
    return this.localOps.deleteFile(fileName);
  }

  commit(message: string): Promise<boolean> {
    return this.localOps.commit(message);
  }

  getDefaultBranchLocal(): Promise<{ branch: string; method: string }> {
    return this.localOps.getDefaultBranchLocal();
  }

  // --- INetworkGitOps with auth wrapping ---
  // Note: exec() usage here is safe — all user inputs are escaped via escapeShellArg()

  async clone(gitUrl: string): Promise<void> {
    if (!this.auth) {
      const command = `git clone ${escapeShellArg(gitUrl)} .`;
      await this.execWithRetry(command);
      return;
    }
    const authUrl = escapeShellArg(this.getAuthenticatedUrl());
    await this.execWithRetry(`git clone ${authUrl} .`);
  }

  async fetch(options?: { prune?: boolean }): Promise<void> {
    const pruneFlag = options?.prune ? " --prune" : "";
    await this.execWithRetry(`git fetch origin${pruneFlag}`);
  }

  async push(branchName: string, options?: { force?: boolean }): Promise<void> {
    const forceFlag = options?.force ? "--force-with-lease " : "";
    const safeBranch = escapeShellArg(branchName);
    await this.execWithRetry(`git push ${forceFlag}-u origin ${safeBranch}`);
  }

  async getDefaultBranch(): Promise<{ branch: string; method: string }> {
    try {
      const remoteInfo = await this.execWithRetry(`git remote show origin`);
      const match = remoteInfo.match(/HEAD branch: (\S+)/);
      if (match && match[1] !== "(unknown)") {
        return { branch: match[1], method: "remote HEAD" };
      }
    } catch (error) {
      const msg = toErrorMessage(error);
      this.log?.debug(`git remote show origin failed - ${msg}`);
    }

    // Local fallback operations don't need auth — delegate to localOps
    return this.localOps.getDefaultBranchLocal();
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
