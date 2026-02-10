import type { PRResult } from "./pr-creator.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { MergeMode, MergeStrategy } from "../config/index.js";
import type { IAuthenticatedGitOps } from "./authenticated-git-ops.js";

// =============================================================================
// PR Strategy Types
// =============================================================================

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
  /** GitHub App installation token for authentication */
  token?: string;
}

export interface MergeOptions {
  prUrl: string;
  config: PRMergeConfig;
  workDir: string;
  retries?: number;
  /** GitHub App installation token for authentication */
  token?: string;
}

/**
 * Options for closing an existing PR.
 */
export interface CloseExistingPROptions {
  repoInfo: RepoInfo;
  branchName: string;
  baseBranch: string;
  workDir: string;
  retries?: number;
  /** GitHub App installation token for authentication */
  token?: string;
}

/**
 * Interface for PR creation strategies (platform-specific implementations).
 * Strategies focus on platform-specific logic (checkExistingPR, create, merge).
 * Use PRWorkflowExecutor for full workflow orchestration with error handling.
 */
export interface IPRStrategy {
  /**
   * Check if a PR already exists for the given branch
   * @returns PR URL if exists, null otherwise
   */
  checkExistingPR(options: PRStrategyOptions): Promise<string | null>;

  /**
   * Close an existing PR and delete its branch.
   * Used for fresh start approach - always create new PR from clean state.
   * @returns true if PR was closed, false if no PR existed
   */
  closeExistingPR(options: CloseExistingPROptions): Promise<boolean>;

  /**
   * Create a new PR
   * @returns Result with URL and status
   */
  create(options: PRStrategyOptions): Promise<PRResult>;

  /**
   * Merge or enable auto-merge for a PR
   * @returns Result with merge status
   */
  merge(options: MergeOptions): Promise<MergeResult>;

  /**
   * Execute the full PR creation workflow
   * @deprecated Use PRWorkflowExecutor.execute() for better SRP
   */
  execute(options: PRStrategyOptions): Promise<PRResult>;
}

// =============================================================================
// Commit Strategy Types
// =============================================================================

export interface FileChange {
  path: string;
  content: string | null; // null = deletion
}

export interface CommitOptions {
  repoInfo: RepoInfo;
  branchName: string;
  message: string;
  fileChanges: FileChange[];
  workDir: string;
  retries?: number;
  /** Use force push (--force-with-lease). Default: true for PR branches, false for direct push to main. */
  force?: boolean;
  /** GitHub App installation token for authentication (used by GraphQLCommitStrategy) */
  token?: string;
  /** Authenticated git operations wrapper (used by GraphQLCommitStrategy for network ops) */
  gitOps?: IAuthenticatedGitOps;
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
