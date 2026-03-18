import type { RepoConfig } from "../config/types.js";
import { RepoInfo, getRepoDisplayName } from "../shared/repo-detector.js";
import { safeCleanup } from "../shared/type-guards.js";
import type { DebugInfoLog } from "../shared/logger.js";
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
  RunContext,
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
    private readonly log: DebugInfoLog
  ) {}

  async execute(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions,
    workStrategy: IWorkStrategy
  ): Promise<ProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { branchName } = options;

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

    const runCtx: RunContext = {
      workDir: options.workDir,
      dryRun: options.dryRun ?? false,
      retries: options.retries ?? 3,
      token: authResult.token,
      executor: options.executor,
    };

    let session: SessionContext | null = null;
    try {
      session = await this.repositorySession.setup(repoInfo, {
        workDir: runCtx.workDir,
        dryRun: runCtx.dryRun,
        retries: runCtx.retries,
        executor: runCtx.executor,
        authOptions: authResult.authOptions,
      });

      await this.branchManager.setupBranch({
        ...runCtx,
        repoInfo,
        branchName,
        baseBranch: session.baseBranch,
        isDirectMode,
        gitOps: session.gitOps,
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
        ...runCtx,
        repoInfo,
        gitOps: session.gitOps,
        fileChanges: workResult.fileChanges,
        commitMessage: workResult.commitMessage,
        pushBranch,
        isDirectMode,
        hasAppCredentials: options.hasAppCredentials,
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
          ...runCtx,
          branchName,
          baseBranch: session.baseBranch,
          prTemplate: options.prTemplate,
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
