import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../repo/index.js";
import type { ILogger } from "../shared/logger.js";
import {
  GitOps,
  AuthenticatedGitOps,
  type GitHubAppTokenManager,
} from "../vcs/index.js";
import { FileWriter } from "./file-writer.js";
import { ManifestManager } from "./manifest-manager.js";
import { BranchManager } from "./branch-manager.js";
import { AuthOptionsBuilder } from "./auth-options-builder.js";
import { RepositorySession } from "./repository-session.js";
import { CommitPushManager } from "./commit-push-manager.js";
import { FileSyncOrchestrator } from "./file-sync-orchestrator.js";
import { RenderWriter } from "./render-writer.js";
import { PRMergeHandler } from "./pr-merge-handler.js";
import { FileSyncStrategy } from "./file-sync-strategy.js";
import { SyncWorkflow } from "./sync-workflow.js";
import {
  AiChangeDescriber,
  createAiClient,
  type FetchFn,
  type IChangeDescriber,
} from "../ai/index.js";
import type {
  IFileWriter,
  IManifestManager,
  IRenderWriter,
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
      renderWriter?: IRenderWriter;
      branchManager?: IBranchManager;
      authOptionsBuilder?: IAuthOptionsBuilder;
      repositorySession?: IRepositorySession;
      commitPushManager?: ICommitPushManager;
      fileSyncOrchestrator?: IFileSyncOrchestrator;
      prMergeHandler?: IPRMergeHandler;
      syncWorkflow?: ISyncWorkflow;
      changeDescriber?: IChangeDescriber;
      tokenManager?: GitHubAppTokenManager | null;
      envToken?: string;
      /** Environment the AI client reads API keys from */
      aiEnv?: Record<string, string | undefined>;
      fetch?: FetchFn;
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

    const changeDescriber =
      components?.changeDescriber ??
      new AiChangeDescriber(
        (opts) =>
          createAiClient(
            opts,
            components?.aiEnv ?? {},
            components?.fetch ?? globalThis.fetch
          ),
        log
      );

    this.fileSyncOrchestrator =
      components?.fileSyncOrchestrator ??
      new FileSyncOrchestrator(
        fileWriter,
        manifestManager,
        log,
        components?.renderWriter ?? new RenderWriter()
      );

    this.syncWorkflow =
      components?.syncWorkflow ??
      new SyncWorkflow(
        authOptionsBuilder,
        repositorySession,
        branchManager,
        commitPushManager,
        prMergeHandler,
        changeDescriber,
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
