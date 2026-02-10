import type { FileContent, RepoConfig } from "../config/types.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type {
  IAuthenticatedGitOps,
  GitAuthOptions,
} from "../vcs/authenticated-git-ops.js";
import type { GitOpsOptions } from "../vcs/git-ops.js";
import type { DiffStats } from "./diff-utils.js";
import type { ILogger } from "../shared/logger.js";
import type { XfgManifest } from "./manifest.js";
import type { ICommandExecutor } from "../shared/command-executor.js";

/**
 * Factory function type for creating IAuthenticatedGitOps instances.
 * Allows dependency injection for testing.
 */
export type GitOpsFactory = (
  options: GitOpsOptions,
  auth?: GitAuthOptions
) => IAuthenticatedGitOps;

/**
 * Result of processing a single file
 */
export interface FileWriteResult {
  fileName: string;
  content: string | null;
  action: "create" | "update" | "delete" | "skip";
}

/**
 * Context for file writing operations
 */
export interface FileWriteContext {
  repoInfo: RepoInfo;
  baseBranch: string;
  workDir: string;
  dryRun: boolean;
  noDelete: boolean;
  configId: string;
}

/**
 * Dependencies for FileWriter
 */
export interface FileWriterDeps {
  gitOps: IAuthenticatedGitOps;
  log: ILogger;
}

/**
 * Result of writing all files
 */
export interface FileWriteAllResult {
  fileChanges: Map<string, FileWriteResult>;
  diffStats: DiffStats;
}

/**
 * Interface for file writing operations
 */
export interface IFileWriter {
  /**
   * Write all files from config to repository
   */
  writeFiles(
    files: FileContent[],
    ctx: FileWriteContext,
    deps: FileWriterDeps
  ): Promise<FileWriteAllResult>;
}

/**
 * Result of processing orphans
 */
export interface OrphanProcessResult {
  manifest: XfgManifest;
  filesToDelete: string[];
}

/**
 * Options for orphan deletion
 */
export interface OrphanDeleteOptions {
  dryRun: boolean;
  noDelete: boolean;
}

/**
 * Dependencies for orphan deletion
 */
export interface OrphanDeleteDeps {
  gitOps: IAuthenticatedGitOps;
  log: ILogger;
  fileChanges: Map<string, FileWriteResult>;
}

/**
 * Interface for manifest management operations
 */
export interface IManifestManager {
  /**
   * Process manifest to find orphaned files
   */
  processOrphans(
    workDir: string,
    configId: string,
    filesWithDeleteOrphaned: Map<string, boolean | undefined>
  ): OrphanProcessResult;

  /**
   * Delete orphaned files
   */
  deleteOrphans(
    filesToDelete: string[],
    options: OrphanDeleteOptions,
    deps: OrphanDeleteDeps
  ): Promise<void>;

  /**
   * Save updated manifest
   */
  saveUpdatedManifest(
    workDir: string,
    manifest: XfgManifest,
    existingManifest: XfgManifest | null,
    dryRun: boolean,
    fileChanges: Map<string, FileWriteResult>
  ): void;
}

/**
 * Options for branch setup
 */
export interface BranchSetupOptions {
  repoInfo: RepoInfo;
  branchName: string;
  baseBranch: string;
  workDir: string;
  isDirectMode: boolean;
  dryRun: boolean;
  retries: number;
  token?: string;
  gitOps: IAuthenticatedGitOps;
  log: ILogger;
  executor: ICommandExecutor;
}

/**
 * Interface for branch management operations
 */
export interface IBranchManager {
  /**
   * Setup branch for sync (close existing PR, create fresh branch)
   */
  setupBranch(options: BranchSetupOptions): Promise<void>;
}

/**
 * Result of resolving authentication for a repository
 */
export interface AuthResult {
  /** Installation token or PAT */
  token?: string;
  /** Auth options for git operations */
  authOptions?: GitAuthOptions;
  /** If set, caller should return this result (e.g., no installation found) */
  skipResult?: {
    success: boolean;
    repoName: string;
    message: string;
    skipped?: boolean;
  };
}

/**
 * Interface for building authentication options
 */
export interface IAuthOptionsBuilder {
  /**
   * Resolve authentication for a repository.
   * Returns token and auth options, or a skip result if repo should be skipped.
   */
  resolve(repoInfo: RepoInfo, repoName: string): Promise<AuthResult>;
}

/**
 * Options for setting up a repository session
 */
export interface SessionOptions {
  workDir: string;
  dryRun: boolean;
  retries: number;
  authOptions?: GitAuthOptions;
}

/**
 * Context returned from session setup
 */
export interface SessionContext {
  /** Authenticated git operations */
  gitOps: IAuthenticatedGitOps;
  /** Default branch name */
  baseBranch: string;
  /** Cleanup function - call in finally block */
  cleanup: () => void;
}

/**
 * Interface for managing repository workspace lifecycle
 */
export interface IRepositorySession {
  /**
   * Setup repository workspace: clean, clone, detect default branch.
   * Returns context with gitOps and cleanup function.
   */
  setup(repoInfo: RepoInfo, options: SessionOptions): Promise<SessionContext>;
}

/**
 * Options for commit and push operations
 */
export interface CommitPushOptions {
  repoInfo: RepoInfo;
  gitOps: IAuthenticatedGitOps;
  workDir: string;
  fileChanges: Map<string, FileWriteResult>;
  commitMessage: string;
  pushBranch: string;
  isDirectMode: boolean;
  dryRun: boolean;
  retries: number;
  token?: string;
  executor: ICommandExecutor;
}

/**
 * Result of commit and push operation
 */
export interface CommitPushResult {
  /** Whether commit/push succeeded */
  success: boolean;
  /** If failed, contains error result to return */
  errorResult?: {
    success: boolean;
    repoName: string;
    message: string;
  };
  /** If success but no changes, indicates skip */
  skipped?: boolean;
}

/**
 * Interface for commit and push operations
 */
export interface ICommitPushManager {
  /**
   * Stage, commit, and push changes.
   * Handles dry-run mode and branch protection errors.
   */
  commitAndPush(
    options: CommitPushOptions,
    repoName: string
  ): Promise<CommitPushResult>;
}

/**
 * Options for repository processing
 */
export interface ProcessorOptions {
  branchName: string;
  workDir: string;
  configId: string;
  dryRun?: boolean;
  retries?: number;
  executor?: ICommandExecutor;
  prTemplate?: string;
  noDelete?: boolean;
}

/**
 * Result of repository processing
 */
export interface ProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  prUrl?: string;
  skipped?: boolean;
  mergeResult?: {
    merged: boolean;
    autoMergeEnabled?: boolean;
    message: string;
  };
  diffStats?: DiffStats;
}

/**
 * Interface for repository processing operations
 */
export interface IRepositoryProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult>;
  updateManifestOnly(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: ProcessorOptions,
    manifestUpdate: { rulesets: string[] }
  ): Promise<ProcessorResult>;
}
