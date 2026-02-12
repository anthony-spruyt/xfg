import type { RepoConfig } from "../config/types.js";
import { RepoInfo, getRepoDisplayName } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
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
    const { branchName, workDir, dryRun } = options;
    const retries = options.retries ?? 3;
    const executor = options.executor ?? defaultExecutor;

    // Step 1: Resolve auth
    const authResult = await this.authOptionsBuilder.resolve(
      repoInfo,
      repoName
    );
    if (authResult.skipResult) {
      return authResult.skipResult;
    }

    // Step 2: Determine merge mode
    const mergeMode = repoConfig.prOptions?.merge ?? "auto";
    const isDirectMode = mergeMode === "direct";

    // Warn if mergeStrategy is set but ignored in direct mode
    if (isDirectMode && repoConfig.prOptions?.mergeStrategy) {
      this.log.info(
        `Warning: mergeStrategy '${repoConfig.prOptions.mergeStrategy}' is ignored in direct mode`
      );
    }

    let session: SessionContext | null = null;
    try {
      // Step 3: Setup session
      session = await this.repositorySession.setup(repoInfo, {
        workDir,
        dryRun: dryRun ?? false,
        retries,
        authOptions: authResult.authOptions,
      });

      // Step 4: Setup branch
      await this.branchManager.setupBranch({
        repoInfo,
        branchName,
        baseBranch: session.baseBranch,
        workDir,
        isDirectMode,
        dryRun: dryRun ?? false,
        retries,
        token: authResult.token,
        gitOps: session.gitOps,
        log: this.log,
        executor,
      });

      // Step 5: Execute work strategy
      const workResult = await workStrategy.execute(
        repoConfig,
        repoInfo,
        session,
        options
      );

      // Step 6: No changes - skip
      if (!workResult) {
        return {
          success: true,
          repoName,
          message: "No changes detected",
          skipped: true,
        };
      }

      // Step 7: Commit and push
      const pushBranch = isDirectMode ? session.baseBranch : branchName;
      const commitResult = await this.commitPushManager.commitAndPush(
        {
          repoInfo,
          gitOps: session.gitOps,
          workDir,
          fileChanges: workResult.fileChanges,
          commitMessage: workResult.commitMessage,
          pushBranch,
          isDirectMode,
          dryRun: dryRun ?? false,
          retries,
          token: authResult.token,
          executor,
        },
        repoName
      );

      // Step 8: Handle commit errors
      if (!commitResult.success && commitResult.errorResult) {
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

      // Step 9: Direct mode - done
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

      // Step 10: Create and merge PR
      return await this.prMergeHandler.createAndMerge(
        repoInfo,
        repoConfig,
        {
          branchName,
          baseBranch: session.baseBranch,
          workDir,
          dryRun: dryRun ?? false,
          retries,
          prTemplate: options.prTemplate,
          token: authResult.token,
          executor,
        },
        workResult.changedFiles,
        repoName,
        workResult.diffStats,
        workResult.fileChangeDetails
      );
    } finally {
      try {
        session?.cleanup();
      } catch {
        // Ignore cleanup errors - best effort
      }
    }
  }
}
