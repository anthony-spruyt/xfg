import type { PRResult } from "./pr-creator.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { MergeMode, MergeStrategy } from "../config/index.js";
import type { INetworkGitOps } from "./authenticated-git-ops.js";

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

/**
 * Options for closing an existing PR.
 */
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
 * Strategies focus on platform-specific logic (checkExistingPR, create, merge).
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
  checkExistingPR(options: CloseExistingPROptions): Promise<string | null>;

  /**
   * Close an existing PR and delete its branch.
   * @returns true if PR was closed, false if no PR existed
   */
  closeExistingPR(options: CloseExistingPROptions): Promise<boolean>;

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
  /** GitHub App installation token (GitHub-only; used by GraphQLCommitStrategy) */
  token?: string;
  /** Network git operations (used by GraphQLCommitStrategy for fetchBranch() during OID mismatch retries) */
  networkOps?: INetworkGitOps;
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
