import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import { GitOps } from "../vcs/git-ops.js";
import { AuthenticatedGitOps } from "../vcs/authenticated-git-ops.js";
import { logger, ILogger } from "../shared/logger.js";
import { hasGitHubAppCredentials } from "../vcs/index.js";
import { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";
import {
  FileWriter,
  ManifestManager,
  BranchManager,
  AuthOptionsBuilder,
  RepositorySession,
  CommitPushManager,
  FileSyncOrchestrator,
  PRMergeHandler,
  FileSyncStrategy,
  SyncWorkflow,
  type IFileWriter,
  type IManifestManager,
  type IBranchManager,
  type IAuthOptionsBuilder,
  type IRepositorySession,
  type ICommitPushManager,
  type IFileSyncOrchestrator,
  type IPRMergeHandler,
  type ISyncWorkflow,
  type IRepositoryProcessor,
  type GitOpsFactory,
  type ProcessorOptions,
  type ProcessorResult,
} from "./index.js";

/**
 * Thin facade that delegates to SyncWorkflow with FileSyncStrategy.
 */
export class RepositoryProcessor implements IRepositoryProcessor {
  private readonly syncWorkflow: ISyncWorkflow;
  private readonly fileSyncOrchestrator: IFileSyncOrchestrator;
  private readonly log: ILogger;

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
    const factory =
      gitOpsFactory ??
      ((opts, auth) => new AuthenticatedGitOps(new GitOps(opts), auth));
    const logInstance = log ?? logger;
    this.log = logInstance;

    // Initialize token manager for auth builder
    const tokenManager = hasGitHubAppCredentials()
      ? new GitHubAppTokenManager(
          process.env.XFG_GITHUB_APP_ID!,
          process.env.XFG_GITHUB_APP_PRIVATE_KEY!
        )
      : null;

    const fileWriter = components?.fileWriter ?? new FileWriter();
    const manifestManager =
      components?.manifestManager ?? new ManifestManager();
    const branchManager = components?.branchManager ?? new BranchManager();
    const authOptionsBuilder =
      components?.authOptionsBuilder ??
      new AuthOptionsBuilder(tokenManager, logInstance);
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
