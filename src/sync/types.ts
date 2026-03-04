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
import type { FileAction } from "../vcs/pr-creator.js";

export type GitOpsFactory = (
  options: GitOpsOptions,
  auth?: GitAuthOptions
) => IAuthenticatedGitOps;

export interface FileWriteResult {
  fileName: string;
  content: string | null;
  action: "create" | "update" | "delete" | "skip";
}

export interface FileWriteContext {
  repoInfo: RepoInfo;
  baseBranch: string;
  workDir: string;
  dryRun: boolean;
  noDelete: boolean;
  configId: string;
}

export interface FileWriterDeps {
  gitOps: IAuthenticatedGitOps;
  log: ILogger;
}

export interface FileWriteAllResult {
  fileChanges: Map<string, FileWriteResult>;
  diffStats: DiffStats;
}

export interface IFileWriter {
  writeFiles(
    files: FileContent[],
    ctx: FileWriteContext,
    deps: FileWriterDeps
  ): Promise<FileWriteAllResult>;
}

export interface OrphanProcessResult {
  manifest: XfgManifest;
  filesToDelete: string[];
}

export interface OrphanDeleteOptions {
  dryRun: boolean;
  noDelete: boolean;
}

export interface OrphanDeleteDeps {
  gitOps: IAuthenticatedGitOps;
  log: ILogger;
  fileChanges: Map<string, FileWriteResult>;
}

export interface IManifestManager {
  processOrphans(
    workDir: string,
    configId: string,
    filesWithDeleteOrphaned: Map<string, boolean | undefined>
  ): OrphanProcessResult;

  deleteOrphans(
    filesToDelete: string[],
    options: OrphanDeleteOptions,
    deps: OrphanDeleteDeps
  ): Promise<void>;

  saveUpdatedManifest(
    workDir: string,
    manifest: XfgManifest,
    existingManifest: XfgManifest | null,
    dryRun: boolean,
    fileChanges: Map<string, FileWriteResult>
  ): void;
}

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

export interface IBranchManager {
  setupBranch(options: BranchSetupOptions): Promise<void>;
}

export interface AuthResult {
  token?: string;
  authOptions?: GitAuthOptions;
  /** If set, caller should return this result (e.g., no installation found) */
  skipResult?: {
    success: boolean;
    repoName: string;
    message: string;
    skipped?: boolean;
  };
}

export interface IAuthOptionsBuilder {
  resolve(repoInfo: RepoInfo, repoName: string): Promise<AuthResult>;
}

export interface SessionOptions {
  workDir: string;
  dryRun: boolean;
  retries: number;
  authOptions?: GitAuthOptions;
}

export interface SessionContext {
  gitOps: IAuthenticatedGitOps;
  baseBranch: string;
  cleanup: () => void;
}

export interface IRepositorySession {
  setup(repoInfo: RepoInfo, options: SessionOptions): Promise<SessionContext>;
}

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

export interface CommitPushResult {
  success: boolean;
  errorResult?: {
    success: boolean;
    repoName: string;
    message: string;
  };
  skipped?: boolean;
}

export interface ICommitPushManager {
  commitAndPush(options: CommitPushOptions): Promise<CommitPushResult>;
}

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

export interface FileChangeDetail {
  path: string;
  action: "create" | "update" | "delete";
}

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
  fileChanges?: FileChangeDetail[];
}

export interface IRepositoryProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult>;
}

export interface FileSyncResult {
  fileChanges: Map<string, FileWriteResult>;
  diffStats: DiffStats;
  changedFiles: FileAction[];
  hasChanges: boolean;
}

export interface IFileSyncOrchestrator {
  sync(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    session: SessionContext,
    options: ProcessorOptions
  ): Promise<FileSyncResult>;
}

export interface PRHandlerOptions {
  branchName: string;
  baseBranch: string;
  workDir: string;
  dryRun: boolean;
  retries: number;
  prTemplate?: string;
  token?: string;
  executor: ICommandExecutor;
}

export interface CreateAndMergeInput {
  repoInfo: RepoInfo;
  repoConfig: RepoConfig;
  options: PRHandlerOptions;
  changedFiles: FileAction[];
  repoName: string;
  diffStats?: DiffStats;
  fileChanges?: FileChangeDetail[];
}

export interface IPRMergeHandler {
  createAndMerge(input: CreateAndMergeInput): Promise<ProcessorResult>;
}

export interface WorkResult {
  fileChanges: Map<string, FileWriteResult>;
  changedFiles: FileAction[];
  diffStats?: DiffStats;
  commitMessage: string;
  fileChangeDetails: FileChangeDetail[];
}

/** Defines what changes to make within the sync workflow. Return null if no changes. */
export interface IWorkStrategy {
  execute(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    session: SessionContext,
    options: ProcessorOptions
  ): Promise<WorkResult | null>;
}

/** Orchestrates: auth → session → branch → work → commit → PR */
export interface ISyncWorkflow {
  execute(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions,
    workStrategy: IWorkStrategy
  ): Promise<ProcessorResult>;
}
