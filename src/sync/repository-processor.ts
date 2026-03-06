import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import { GitOps } from "../vcs/git-ops.js";
import { AuthenticatedGitOps } from "../vcs/authenticated-git-ops.js";
import { defaultExecutor } from "../shared/command-executor.js";
import { logger, ILogger } from "../shared/logger.js";
import { createTokenManager } from "../vcs/index.js";
import { FileWriter } from "./file-writer.js";
import { ManifestManager } from "./manifest-manager.js";
import { BranchManager } from "./branch-manager.js";
import { AuthOptionsBuilder } from "./auth-options-builder.js";
import { RepositorySession } from "./repository-session.js";
import { CommitPushManager } from "./commit-push-manager.js";
import { FileSyncOrchestrator } from "./file-sync-orchestrator.js";
import { PRMergeHandler } from "./pr-merge-handler.js";
import { FileSyncStrategy } from "./file-sync-strategy.js";
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
    gitOpsFactory?: GitOpsFactory,
    log?: ILogger,
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
    }
  ) {
    const logInstance = log ?? logger;
    const factory: GitOpsFactory =
      gitOpsFactory ??
      ((opts, auth, retries) => {
        const gitOps = new GitOps({ ...opts, log: logInstance });
        return new AuthenticatedGitOps(
          gitOps,
          opts.executor ?? defaultExecutor,
          opts.workDir,
          retries ?? 3,
          auth,
          logInstance
        );
      });

    // Initialize token manager for auth builder (env access at composition root)
    const appId = process.env.XFG_GITHUB_APP_ID;
    const appKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;
    const tokenManager = createTokenManager(
      appId && appKey ? { appId, privateKey: appKey } : undefined
    );

    const fileWriter = components?.fileWriter ?? new FileWriter();
    const manifestManager =
      components?.manifestManager ?? new ManifestManager(logInstance);
    const branchManager =
      components?.branchManager ?? new BranchManager(logInstance);
    const authOptionsBuilder =
      components?.authOptionsBuilder ??
      new AuthOptionsBuilder(tokenManager, logInstance, process.env.GH_TOKEN);
    const repositorySession =
      components?.repositorySession ??
      new RepositorySession(factory, logInstance);
    const commitPushManager =
      components?.commitPushManager ?? new CommitPushManager(logInstance);
    const prMergeHandler =
      components?.prMergeHandler ?? new PRMergeHandler(logInstance);

    this.fileSyncOrchestrator =
      components?.fileSyncOrchestrator ??
      new FileSyncOrchestrator(fileWriter, manifestManager, logInstance);

    this.syncWorkflow =
      components?.syncWorkflow ??
      new SyncWorkflow(
        authOptionsBuilder,
        repositorySession,
        branchManager,
        commitPushManager,
        prMergeHandler,
        logInstance
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
