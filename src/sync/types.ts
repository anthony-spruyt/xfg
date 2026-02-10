import type { FileContent } from "../config/types.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { IAuthenticatedGitOps } from "../git/authenticated-git-ops.js";
import type { DiffStats } from "./diff-utils.js";
import type { ILogger } from "../shared/logger.js";
import type { XfgManifest } from "./manifest.js";
import type { ICommandExecutor } from "../shared/command-executor.js";

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
