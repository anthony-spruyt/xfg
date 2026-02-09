import type { ContentValue, FileContent } from "../config/types.js";
import type { RepoInfo } from "../repo-detector.js";
import type { IAuthenticatedGitOps } from "../authenticated-git-ops.js";
import type { DiffStats } from "../diff-utils.js";
import type { ILogger } from "../logger.js";

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
