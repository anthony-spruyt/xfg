import type { RepoConfig } from "../config/types.js";
import { RepoInfo, getRepoDisplayName } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
import { safeCleanup } from "../shared/type-guards.js";
import { defaultExecutor } from "../shared/command-executor.js";
import type {
  ISyncWorkflow,
  IWorkStrategy,
  IAuthOptionsBuilder,
  IRepositorySession,
  IBranchManager,
  ICommitPushManager,
  IPRMergeHandler,
  ProcessorOptions,
  ProcessorResult,
  SessionContext,
} from "./types.js";

/**
 * Orchestrates the common sync workflow steps.
 * Used by RepositoryProcessor with different strategies for file sync vs manifest.
 */
export class SyncWorkflow implements ISyncWorkflow {
  constructor(
    private readonly authOptionsBuilder: IAuthOptionsBuilder,
    private readonly repositorySession: IRepositorySession,
    private readonly branchManager: IBranchManager,
    private readonly commitPushManager: ICommitPushManager,
    private readonly prMergeHandler: IPRMergeHandler,
    private readonly log: ILogger
  ) {}

  async execute(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions,
    workStrategy: IWorkStrategy
  ): Promise<ProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { branchName, workDir } = options;
    const dryRun = options.dryRun ?? false;
    const retries = options.retries ?? 3;
    const executor = options.executor ?? defaultExecutor;

    const authResult = await this.authOptionsBuilder.resolve(
      repoInfo,
      repoName,
      options.token
    );
    if (!authResult.ok) {
      return authResult.skipResult;
    }

    const mergeMode = repoConfig.prOptions?.merge ?? "auto";
    const isDirectMode = mergeMode === "direct";

    let session: SessionContext | null = null;
    try {
      session = await this.repositorySession.setup(repoInfo, {
        workDir,
        dryRun,
        retries,
        authOptions: authResult.authOptions,
      });

      await this.branchManager.setupBranch({
        repoInfo,
        branchName,
        baseBranch: session.baseBranch,
        workDir,
        isDirectMode,
        dryRun,
        retries,
        token: authResult.token,
        localOps: session.localOps,
        networkOps: session.networkOps,
        executor,
      });

      const workResult = await workStrategy.execute(
        repoConfig,
        repoInfo,
        session,
        options
      );

      if (!workResult) {
        return {
          success: true,
          repoName,
          message: "No changes detected",
          skipped: true,
        };
      }

      const pushBranch = isDirectMode ? session.baseBranch : branchName;
      const commitResult = await this.commitPushManager.commitAndPush({
        repoInfo,
        localOps: session.localOps,
        networkOps: session.networkOps,
        workDir,
        fileChanges: workResult.fileChanges,
        commitMessage: workResult.commitMessage,
        pushBranch,
        isDirectMode,
        dryRun,
        retries,
        token: authResult.token,
        executor,
      });

      if (!commitResult.success) {
        return commitResult.errorResult;
      }

      if (commitResult.skipped) {
        return {
          success: true,
          repoName,
          message: "No changes detected after staging",
          skipped: true,
          diffStats: workResult.diffStats,
          fileChanges: workResult.fileChangeDetails,
        };
      }

      if (isDirectMode) {
        this.log.info(`Changes pushed directly to ${session.baseBranch}`);
        return {
          success: true,
          repoName,
          message: `Pushed directly to ${session.baseBranch}`,
          diffStats: workResult.diffStats,
          fileChanges: workResult.fileChangeDetails,
        };
      }

      return await this.prMergeHandler.createAndMerge({
        repoInfo,
        repoConfig,
        options: {
          branchName,
          baseBranch: session.baseBranch,
          workDir,
          dryRun,
          retries,
          prTemplate: options.prTemplate,
          token: authResult.token,
          executor,
        },
        changedFiles: workResult.changedFiles,
        repoName,
        diffStats: workResult.diffStats,
        fileChanges: workResult.fileChangeDetails,
      });
    } finally {
      if (session) {
        const s = session;
        safeCleanup(() => s.cleanup(), "session teardown failed", this.log);
      }
    }
  }
}
