import { GitOps } from "./git-ops.js";
import { escapeShellArg } from "./shell-utils.js";
import { CommandExecutor, defaultExecutor } from "./command-executor.js";
import { withRetry } from "./retry-utils.js";

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
 * Wrapper around GitOps that adds authentication to network operations.
 *
 * When auth options are provided, network operations (clone, fetch, push,
 * getDefaultBranch) use `-c url.insteadOf` to override credentials per-command.
 * This allows different tokens for different repos without global git config.
 *
 * Local operations (commit, writeFile, etc.) pass through unchanged.
 */
export class AuthenticatedGitOps {
  private gitOps: GitOps;
  private auth?: GitAuthOptions;
  private executor: CommandExecutor;
  private workDir: string;
  private retries: number;

  constructor(gitOps: GitOps, auth?: GitAuthOptions) {
    this.gitOps = gitOps;
    this.auth = auth;
    // Extract executor and workDir from gitOps via reflection
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.executor = (gitOps as any).executor ?? defaultExecutor;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.workDir = (gitOps as any).workDir ?? ".";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.retries = (gitOps as any).retries ?? 3;
  }

  /**
   * Build a git command with optional token authentication override.
   * When a token is provided, uses -c url.insteadOf to override the global
   * git config and authenticate with the provided token instead.
   *
   * Uses a repo-specific URL pattern (including owner/repo) so it has a LONGER
   * prefix match than the global config and takes precedence.
   */
  private buildAuthenticatedCommand(gitArgs: string): string {
    if (!this.auth) {
      return `git ${gitArgs}`;
    }
    const { token, host, owner, repo } = this.auth;
    // Use repo-specific URL pattern for LONGER prefix match to override global config
    // Global config: url."https://x-access-token:PAT@github.com/".insteadOf = "https://github.com/"
    // Our config:    url."https://x-access-token:APP@github.com/owner/repo".insteadOf = "https://github.com/owner/repo"
    // The longer prefix (owner/repo) takes precedence in git's URL matching
    const repoPath = owner && repo ? `${owner}/${repo}` : "";
    const urlOverride = `url."https://x-access-token:${token}@${host}/${repoPath}".insteadOf="https://${host}/${repoPath}"`;
    return `git -c ${escapeShellArg(urlOverride)} ${gitArgs}`;
  }

  private async execWithRetry(command: string): Promise<string> {
    return withRetry(() => this.executor.exec(command, this.workDir), {
      retries: this.retries,
    });
  }

  // ============================================================
  // Network operations - use authenticated command when token provided
  // ============================================================

  async clone(gitUrl: string): Promise<void> {
    if (!this.auth) {
      return this.gitOps.clone(gitUrl);
    }
    const command = this.buildAuthenticatedCommand(
      `clone ${escapeShellArg(gitUrl)} .`
    );
    await this.execWithRetry(command);
  }

  async fetch(options?: { prune?: boolean }): Promise<void> {
    if (!this.auth) {
      return this.gitOps.fetch(options);
    }
    const pruneFlag = options?.prune ? " --prune" : "";
    const command = this.buildAuthenticatedCommand(`fetch origin${pruneFlag}`);
    await this.execWithRetry(command);
  }

  async push(branchName: string, options?: { force?: boolean }): Promise<void> {
    if (!this.auth) {
      return this.gitOps.push(branchName, options);
    }
    const forceFlag = options?.force ? "--force-with-lease " : "";
    const command = this.buildAuthenticatedCommand(
      `push ${forceFlag}-u origin ${escapeShellArg(branchName)}`
    );
    await this.execWithRetry(command);
  }

  async getDefaultBranch(): Promise<{ branch: string; method: string }> {
    if (!this.auth) {
      return this.gitOps.getDefaultBranch();
    }
    // Network operation with auth
    try {
      const command = this.buildAuthenticatedCommand("remote show origin");
      const remoteInfo = await this.execWithRetry(command);
      const match = remoteInfo.match(/HEAD branch: (\S+)/);
      if (match) {
        return { branch: match[1], method: "remote HEAD" };
      }
    } catch {
      // Fall through to local checks
    }

    // Local operations don't need auth
    try {
      await this.executor.exec(
        "git rev-parse --verify origin/main",
        this.workDir
      );
      return { branch: "main", method: "origin/main exists" };
    } catch {
      // Continue
    }

    try {
      await this.executor.exec(
        "git rev-parse --verify origin/master",
        this.workDir
      );
      return { branch: "master", method: "origin/master exists" };
    } catch {
      // Continue
    }

    return { branch: "main", method: "fallback default" };
  }

  /**
   * Execute ls-remote with authentication.
   * Used by GraphQLCommitStrategy to check if branch exists on remote.
   */
  async lsRemote(branchName: string): Promise<string> {
    const command = this.buildAuthenticatedCommand(
      `ls-remote --exit-code --heads origin ${escapeShellArg(branchName)}`
    );
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
    const command = this.buildAuthenticatedCommand(
      `push ${deleteFlag}-u origin ${refspec}`
    );
    await this.execWithRetry(command);
  }

  /**
   * Fetch a specific branch from remote.
   * Used by GraphQLCommitStrategy to update local refs.
   */
  async fetchBranch(branchName: string): Promise<void> {
    const safeBranch = escapeShellArg(branchName);
    const command = this.buildAuthenticatedCommand(
      `fetch origin ${safeBranch}:refs/remotes/origin/${safeBranch}`
    );
    await this.execWithRetry(command);
  }

  // ============================================================
  // Local operations - delegate directly to GitOps
  // ============================================================

  cleanWorkspace(): void {
    return this.gitOps.cleanWorkspace();
  }

  async createBranch(branchName: string): Promise<void> {
    return this.gitOps.createBranch(branchName);
  }

  writeFile(fileName: string, content: string): void {
    return this.gitOps.writeFile(fileName, content);
  }

  async setExecutable(fileName: string): Promise<void> {
    return this.gitOps.setExecutable(fileName);
  }

  getFileContent(fileName: string): string | null {
    return this.gitOps.getFileContent(fileName);
  }

  wouldChange(fileName: string, content: string): boolean {
    return this.gitOps.wouldChange(fileName, content);
  }

  async hasChanges(): Promise<boolean> {
    return this.gitOps.hasChanges();
  }

  async getChangedFiles(): Promise<string[]> {
    return this.gitOps.getChangedFiles();
  }

  async hasStagedChanges(): Promise<boolean> {
    return this.gitOps.hasStagedChanges();
  }

  async fileExistsOnBranch(fileName: string, branch: string): Promise<boolean> {
    return this.gitOps.fileExistsOnBranch(fileName, branch);
  }

  fileExists(fileName: string): boolean {
    return this.gitOps.fileExists(fileName);
  }

  deleteFile(fileName: string): void {
    return this.gitOps.deleteFile(fileName);
  }

  async commit(message: string): Promise<boolean> {
    return this.gitOps.commit(message);
  }
}
