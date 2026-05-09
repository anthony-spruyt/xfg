import type {
  FileContent,
  RepoConfig,
  PRMergeOptions,
} from "../config/index.js";
import type { RepoInfo } from "../repo/index.js";
import type { ActiveAction } from "../settings/index.js";
import type {
  ILocalGitOps,
  IGitOps,
  GitAuthOptions,
  GitOpsOptions,
  FileAction,
  FileActionKind,
} from "../vcs/index.js";
import type { DiffStats } from "./diff-utils.js";
import type { ILogger } from "../shared/logger.js";
import type { XfgManifest } from "./manifest.js";
import type { ICommandExecutor } from "../shared/command-executor.js";

export type GitOpsFactory = (
  options: GitOpsOptions,
  auth?: GitAuthOptions,
  retries?: number
) => IGitOps;

export interface FileWriteResult {
  fileName: string;
  content: string | null;
  action: FileActionKind;
  diffLines?: string[];
  /** Git file mode. Only set for executable files ("100755"). "100644" is included
   *  in the union for type completeness — non-executable files omit this field. */
  mode?: "100755" | "100644";
  modeOnly?: true;
}

export interface FileWriteContext {
  repoInfo: RepoInfo;
  baseBranch: string;
  workDir: string;
  dryRun: boolean;
  noDelete: boolean;
  configId: string;
  /** True when using GraphQL commit strategy (GitHub App) */
  hasAppCredentials?: boolean;
}

export interface FileWriterDeps {
  gitOps: ILocalGitOps;
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
  existingManifest: XfgManifest | null;
  filesToDelete: string[];
}

export interface OrphanDeleteOptions {
  dryRun: boolean;
  noDelete: boolean;
}

export interface OrphanDeleteDeps {
  gitOps: ILocalGitOps;
  log: ILogger;
  fileChanges: Map<string, FileWriteResult>;
}

export interface IManifestManager {
  detectOrphans(
    workDir: string,
    configId: string,
    filesWithDeleteOrphaned: Map<string, boolean | undefined>
  ): OrphanProcessResult;

  deleteOrphans(
    filesToDelete: string[],
    options: OrphanDeleteOptions,
    deps: OrphanDeleteDeps
  ): void;

  saveUpdatedManifest(
    workDir: string,
    manifest: XfgManifest,
    existingManifest: XfgManifest | null,
    dryRun: boolean,
    fileChanges: Map<string, FileWriteResult>
  ): void;
}

/** Common runtime context shared across workflow step options bags. */
export interface RunContext {
  workDir: string;
  dryRun: boolean;
  retries: number;
  token?: string;
  executor: ICommandExecutor;
}

export interface BranchSetupOptions extends RunContext {
  repoInfo: RepoInfo;
  branchName: string;
  baseBranch: string;
  isDirectMode: boolean;
  gitOps: IGitOps;
}

export interface IBranchManager {
  setupBranch(options: BranchSetupOptions): Promise<void>;
}

export type AuthResult =
  | { ok: true; token?: string; authOptions?: GitAuthOptions }
  | { ok: false; skipResult: ProcessorResult };

export interface IAuthOptionsBuilder {
  resolve(
    repoInfo: RepoInfo,
    repoName: string,
    token?: string
  ): Promise<AuthResult>;
}

export interface SessionOptions {
  workDir: string;
  dryRun: boolean;
  retries: number;
  executor: ICommandExecutor;
  authOptions?: GitAuthOptions;
}

export interface SessionContext {
  gitOps: IGitOps;
  baseBranch: string;
  cleanup: () => void;
}

export interface IRepositorySession {
  setup(repoInfo: RepoInfo, options: SessionOptions): Promise<SessionContext>;
}

export interface CommitPushOptions extends RunContext {
  repoInfo: RepoInfo;
  gitOps: IGitOps;
  fileChanges: Map<string, FileWriteResult>;
  commitMessage: string;
  pushBranch: string;
  baseBranch: string;
  isDirectMode: boolean;
  hasAppCredentials?: boolean;
}

export type CommitPushResult =
  | { success: true; skipped?: false }
  | { success: true; skipped: true }
  | { success: false; errorResult: ProcessorResult };

export interface ICommitPushManager {
  commitAndPush(options: CommitPushOptions): Promise<CommitPushResult>;
}

export interface ProcessorOptions {
  branchName: string;
  workDir: string;
  configId: string;
  dryRun?: boolean;
  retries?: number;
  executor: ICommandExecutor;
  prTemplate?: string;
  noDelete?: boolean;
  /** GitHub token for authentication (resolved by caller) */
  token?: string;
  /** True when using GraphQL commit strategy (GitHub App) */
  hasAppCredentials?: boolean;
}

export interface FileChangeDetail {
  path: string;
  action: ActiveAction;
  diffLines?: string[];
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

export interface PRHandlerOptions extends RunContext {
  branchName: string;
  baseBranch: string;
  prTemplate?: string;
}

export interface CreateAndMergeInput {
  repoInfo: RepoInfo;
  prOptions?: PRMergeOptions;
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
