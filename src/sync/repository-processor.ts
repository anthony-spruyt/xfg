import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../repo/index.js";
import type { ILogger } from "../shared/logger.js";
import {
  GitOps,
  AuthenticatedGitOps,
  type GitHubAppTokenManager,
} from "../vcs/index.js";
import {
  FileWriter,
  FileSyncOrchestrator,
  FileSyncStrategy,
} from "./file/index.js";
import { ManifestManager } from "./manifest/index.js";
import { BranchManager } from "./branch-manager.js";
import { AuthOptionsBuilder } from "./auth-options-builder.js";
import { RepositorySession } from "./repository-session.js";
import { CommitPushManager } from "./commit-push-manager.js";
import { PRMergeHandler } from "./pr-merge-handler.js";
import { SyncWorkflow } from "./sync-workflow.js";
import type {
  IFileWriter,
  IManifestManager,
  IBranchManager,
  IAuthOptionsBuilder,
  IRepositorySession,
  ICommitPushManager,
  IFileSyncOrchestrator,
  IPRMergeHandler,
  ISyncWorkflow,
  IRepositoryProcessor,
  GitOpsFactory,
  ProcessorOptions,
  ProcessorResult,
} from "./types.js";

/**
 * Thin facade that delegates to SyncWorkflow with FileSyncStrategy.
 */
export class RepositoryProcessor implements IRepositoryProcessor {
  private readonly syncWorkflow: ISyncWorkflow;
  private readonly fileSyncOrchestrator: IFileSyncOrchestrator;

  constructor(
    gitOpsFactory: GitOpsFactory | undefined,
    log: ILogger,
    components?: {
      fileWriter?: IFileWriter;
      manifestManager?: IManifestManager;
      branchManager?: IBranchManager;
      authOptionsBuilder?: IAuthOptionsBuilder;
      repositorySession?: IRepositorySession;
      commitPushManager?: ICommitPushManager;
      fileSyncOrchestrator?: IFileSyncOrchestrator;
      prMergeHandler?: IPRMergeHandler;
      syncWorkflow?: ISyncWorkflow;
      tokenManager?: GitHubAppTokenManager | null;
      envToken?: string;
    }
  ) {
    const factory: GitOpsFactory =
      gitOpsFactory ??
      ((opts, auth, retries) => {
        const gitOps = new GitOps({ ...opts, log: log });
        return new AuthenticatedGitOps({
          localOps: gitOps,
          executor: opts.executor,
          workDir: opts.workDir,
          retries: retries ?? 3,
          auth,
          log,
        });
      });

    const tokenManager = components?.tokenManager ?? null;

    const fileWriter = components?.fileWriter ?? new FileWriter();
    const manifestManager =
      components?.manifestManager ?? new ManifestManager(log);
    const branchManager = components?.branchManager ?? new BranchManager(log);
    const authOptionsBuilder =
      components?.authOptionsBuilder ??
      new AuthOptionsBuilder(tokenManager, log, components?.envToken);
    const repositorySession =
      components?.repositorySession ?? new RepositorySession(factory, log);
    const commitPushManager =
      components?.commitPushManager ?? new CommitPushManager(log);
    const prMergeHandler =
      components?.prMergeHandler ?? new PRMergeHandler(log);

    this.fileSyncOrchestrator =
      components?.fileSyncOrchestrator ??
      new FileSyncOrchestrator(fileWriter, manifestManager, log);

    this.syncWorkflow =
      components?.syncWorkflow ??
      new SyncWorkflow(
        authOptionsBuilder,
        repositorySession,
        branchManager,
        commitPushManager,
        prMergeHandler,
        log
      );
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult> {
    const strategy = new FileSyncStrategy(this.fileSyncOrchestrator);
    return this.syncWorkflow.execute(repoConfig, repoInfo, options, strategy);
  }
}
