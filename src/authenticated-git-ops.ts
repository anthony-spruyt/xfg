import { GitOps } from "./git-ops.js";
import { escapeShellArg } from "./shell-utils.js";
import { CommandExecutor, defaultExecutor } from "./command-executor.js";
import { withRetry } from "./retry-utils.js";

/**
 * Internal interface for accessing GitOps private properties.
 * Used for extracting executor/workDir/retries via reflection.
 */
interface GitOpsInternal {
  executor?: CommandExecutor;
  workDir?: string;
  retries?: number;
}

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
 * Interface for authenticated git operations.
 * Enables proper mocking in tests without relying on class inheritance.
 */
export interface IAuthenticatedGitOps {
  // Network operations
  clone(gitUrl: string): Promise<void>;
  fetch(options?: { prune?: boolean }): Promise<void>;
  push(branchName: string, options?: { force?: boolean }): Promise<void>;
  getDefaultBranch(): Promise<{ branch: string; method: string }>;
  lsRemote(branchName: string): Promise<string>;
  pushRefspec(refspec: string, options?: { delete?: boolean }): Promise<void>;
  fetchBranch(branchName: string): Promise<void>;

  // Local operations
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
 * Wrapper around GitOps that adds authentication to network operations.
 *
 * When auth options are provided, network operations (clone, fetch, push,
 * getDefaultBranch) use `-c url.insteadOf` to override credentials per-command.
 * This allows different tokens for different repos without global git config.
 *
 * Local operations (commit, writeFile, etc.) pass through unchanged.
 */
export class AuthenticatedGitOps implements IAuthenticatedGitOps {
  private gitOps: GitOps;
  private auth?: GitAuthOptions;
  private executor: CommandExecutor;
  private workDir: string;
  private retries: number;

  constructor(gitOps: GitOps, auth?: GitAuthOptions) {
    this.gitOps = gitOps;
    this.auth = auth;
    // Extract executor and workDir from gitOps via reflection
    const internal = gitOps as unknown as GitOpsInternal;
    this.executor = internal.executor ?? defaultExecutor;
    this.workDir = internal.workDir ?? ".";
    this.retries = internal.retries ?? 3;
  }

  /**
   * Build the git command prefix with optional authentication.
   * When auth is provided, includes -c url.insteadOf to override credentials.
   *
   * Uses a repo-specific URL pattern (including owner/repo) so it has a LONGER
   * prefix match than any global config and takes precedence.
   *
   * Handles both HTTPS and SSH URL formats since the remote origin may be either:
   * - HTTPS: https://github.com/owner/repo
   * - SSH: git@github.com:owner/repo
   */
  private getGitPrefix(): string {
    if (!this.auth) {
      return "git";
    }
    const { token, host, owner, repo } = this.auth;
    // Use repo-specific URL pattern for LONGER prefix match to override global config
    // Global config: url."https://x-access-token:PAT@github.com/".insteadOf = "https://github.com/"
    // Our config:    url."https://x-access-token:APP@github.com/owner/repo".insteadOf = "https://github.com/owner/repo"
    // The longer prefix (owner/repo) takes precedence in git's URL matching
    const repoPath = owner && repo ? `${owner}/${repo}` : "";
    const authUrl = `https://x-access-token:${token}@${host}/${repoPath}`;

    // Rewrite HTTPS URLs
    const httpsOverride = `url."${authUrl}".insteadOf="https://${host}/${repoPath}"`;
    // Rewrite SSH URLs (git@host:owner/repo format)
    const sshOverride = `url."${authUrl}".insteadOf="git@${host}:${repoPath}"`;

    return `git -c ${escapeShellArg(httpsOverride)} -c ${escapeShellArg(sshOverride)}`;
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
    const prefix = this.getGitPrefix();
    const safeUrl = escapeShellArg(gitUrl);
    await this.execWithRetry(`${prefix} clone ${safeUrl} .`);
  }

  async fetch(options?: { prune?: boolean }): Promise<void> {
    if (!this.auth) {
      return this.gitOps.fetch(options);
    }
    const prefix = this.getGitPrefix();
    const pruneFlag = options?.prune ? " --prune" : "";
    await this.execWithRetry(`${prefix} fetch origin${pruneFlag}`);
  }

  async push(branchName: string, options?: { force?: boolean }): Promise<void> {
    if (!this.auth) {
      return this.gitOps.push(branchName, options);
    }
    const prefix = this.getGitPrefix();
    const forceFlag = options?.force ? "--force-with-lease " : "";
    const safeBranch = escapeShellArg(branchName);
    await this.execWithRetry(
      `${prefix} push ${forceFlag}-u origin ${safeBranch}`
    );
  }

  async getDefaultBranch(): Promise<{ branch: string; method: string }> {
    if (!this.auth) {
      return this.gitOps.getDefaultBranch();
    }
    // Network operation with auth
    try {
      const prefix = this.getGitPrefix();
      const remoteInfo = await this.execWithRetry(
        `${prefix} remote show origin`
      );
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
    const prefix = this.getGitPrefix();
    const safeBranch = escapeShellArg(branchName);
    return this.execWithRetry(
      `${prefix} ls-remote --exit-code --heads origin ${safeBranch}`
    );
  }

  /**
   * Execute push with custom refspec (e.g., HEAD:branchName).
   * Used by GraphQLCommitStrategy for creating/deleting remote branches.
   */
  async pushRefspec(
    refspec: string,
    options?: { delete?: boolean }
  ): Promise<void> {
    const prefix = this.getGitPrefix();
    const deleteFlag = options?.delete ? "--delete " : "";
    const safeRefspec = escapeShellArg(refspec);
    await this.execWithRetry(
      `${prefix} push ${deleteFlag}-u origin ${safeRefspec}`
    );
  }

  /**
   * Fetch a specific branch from remote.
   * Used by GraphQLCommitStrategy to update local refs.
   */
  async fetchBranch(branchName: string): Promise<void> {
    const prefix = this.getGitPrefix();
    const safeBranch = escapeShellArg(branchName);
    await this.execWithRetry(
      `${prefix} fetch origin ${safeBranch}:refs/remotes/origin/${safeBranch}`
    );
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
