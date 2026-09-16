import type { RepoInfo } from "../repo/index.js";
import type { MergeMode, MergeStrategy } from "../config/index.js";

export type ClosePRResult =
  | { status: "no_pr" }
  | { status: "closed" }
  | { status: "close_failed"; message: string };

export interface GitAuthOptions {
  token: string;
  /** e.g., "github.com", "github.mycompany.com" */
  host: string;
  owner: string;
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
  clearExecutable(fileName: string): Promise<void>;
  getFileMode(fileName: string): Promise<"100755" | "100644" | null>;
  getFileContent(fileName: string): string | null;
  wouldChange(fileName: string, content: string): boolean;
  hasChanges(): Promise<boolean>;
  getChangedFiles(): Promise<string[]>;
  stageAll(): Promise<void>;
  hasStagedChanges(): Promise<boolean>;
  fileExistsOnBranch(fileName: string, branch: string): Promise<boolean>;
  fileExists(fileName: string): boolean;
  deleteFile(fileName: string): void;
  commit(message: string): Promise<boolean>;
  getDefaultBranchLocal(): Promise<{ branch: string; method: string }>;
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

/** Unified git operations interface for consumers that need both local and network ops. */
export interface IGitOps extends ILocalGitOps, INetworkGitOps {}

export interface PRResult {
  url?: string;
  success: boolean;
  message: string;
}

export interface PRMergeConfig {
  mode: MergeMode;
  strategy?: MergeStrategy;
  deleteBranch?: boolean;
  bypassReason?: string;
}

export interface MergeResult {
  success: boolean;
  message: string;
  merged?: boolean;
  autoMergeEnabled?: boolean;
}

export interface PRStrategyOptions {
  repoInfo: RepoInfo;
  title: string;
  body: string;
  branchName: string;
  baseBranch: string;
  workDir: string;
  /** Number of retries for API operations (default: 3) */
  retries?: number;
  /** GitHub App installation token (GitHub-only; ignored by GitLab/Azure strategies which use their own CLI auth) */
  token?: string;
  /** Labels to apply to the created PR */
  labels?: string[];
}

export interface MergeOptions {
  prUrl: string;
  repoInfo: RepoInfo;
  config: PRMergeConfig;
  workDir: string;
  retries?: number;
  /** GitHub App installation token (GitHub-only; ignored by GitLab/Azure strategies which use their own CLI auth) */
  token?: string;
}

export interface CloseExistingPROptions {
  repoInfo: RepoInfo;
  branchName: string;
  baseBranch: string;
  workDir: string;
  retries?: number;
  /** GitHub App installation token (GitHub-only; ignored by GitLab/Azure strategies which use their own CLI auth) */
  token?: string;
}

/**
 * Interface for PR creation strategies (platform-specific implementations).
 * Strategies focus on platform-specific logic (findExistingPRUrl, create, merge).
 * Use PRWorkflowExecutor for full workflow orchestration with error handling.
 *
 * Error contract: create() and merge() may throw on infrastructure failures
 * (network errors, API failures). PRWorkflowExecutor wraps all calls in
 * try-catch, converting throws into PRResult with success:false.
 * Callers should not rely on throw-vs-return for control flow.
 */
export interface IPRStrategy {
  /**
   * Check if a PR already exists for the given branch.
   * @returns PR URL if exists, null if not found or on error
   */
  findExistingPRUrl(options: CloseExistingPROptions): Promise<string | null>;

  closeExistingPR(options: CloseExistingPROptions): Promise<ClosePRResult>;

  /**
   * Create a new PR. Throws on infrastructure failures; PRWorkflowExecutor
   * catches and converts to PRResult.
   */
  create(options: PRStrategyOptions): Promise<PRResult>;

  /**
   * Merge or enable auto-merge for a PR. Returns MergeResult for all outcomes
   * including failures. May throw on unexpected infrastructure errors.
   */
  merge(options: MergeOptions): Promise<MergeResult>;
}

export interface FileAction {
  fileName: string;
  action: "create" | "update" | "skip" | "delete";
}

export type FileActionKind = FileAction["action"];

export interface FileChange {
  path: string;
  content: string | null;
  /** Git file mode. Only set for executable files ("100755"). "100644" is included
   *  in the union for type completeness — non-executable files omit this field. */
  mode?: "100755" | "100644";
  /** True when this entry represents a mode change only (no content diff).
   *  GraphQL strategies should skip these; FileModeFixupCommitStrategy handles them. */
  modeOnly?: true;
}

export interface CommitOptions {
  repoInfo: RepoInfo;
  branchName: string;
  baseBranch?: string;
  message: string;
  fileChanges: FileChange[];
  workDir: string;
  retries?: number;
  /** Use force push (--force-with-lease). Default: true for PR branches, false for direct push to main. */
  force?: boolean;
  /** GitHub App installation token (GitHub-only; used by GraphQLCommitStrategy) */
  token?: string;
  /** Git operations for network commands (push, fetchBranch) during commit strategies */
  gitOps?: INetworkGitOps;
}

export interface CommitResult {
  sha: string;
  verified: boolean;
  pushed: boolean;
}

/**
 * Strategy interface for creating commits.
 * Implementations handle platform-specific commit mechanisms.
 */
export interface ICommitStrategy {
  /**
   * Create a commit with the given file changes and push to remote.
   * @returns Commit result with SHA and verification status
   */
  commit(options: CommitOptions): Promise<CommitResult>;
}
