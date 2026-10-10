import type { RepoConfig } from "../config/index.js";
import { type RepoInfo, getRepoDisplayName } from "../repo/index.js";
import { safeCleanup } from "../shared/cleanup-utils.js";
import type { DebugInfoLog } from "../shared/logger.js";
import type { ChangeDescription, IChangeDescriber } from "../ai/index.js";
import type { FileAction } from "../vcs/index.js";
import type {
  ISyncWorkflow,
  IWorkStrategy,
  IAuthOptionsBuilder,
  IRepositorySession,
  IBranchManager,
  ICommitPushManager,
  IPRMergeHandler,
  ProcessorOptions,
  CommitMessage,
  WorkResult,
  ProcessorResult,
  SessionContext,
  RunContext,
} from "./types.js";

function formatFileList(files: FileAction[]): string {
  const changed = files.filter((f) => f.action !== "skip");
  if (changed.length < 2) return "";
  const lines = changed.map((f) => `- ${f.action} ${f.fileName}`);
  return ["Changed files:", ...lines].join("\n");
}

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
    private readonly changeDescriber: IChangeDescriber,
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

      let description: ChangeDescription | null | undefined;
      const commitMessage = async (): Promise<CommitMessage> => {
        description = await this.describeChanges(
          repoConfig,
          options,
          runCtx,
          workResult
        );
        if (!description) return { message: workResult.commitMessage };
        const { subject } = description;
        const body = [description.body, formatFileList(workResult.changedFiles)]
          .filter(Boolean)
          .join("\n\n");
        return body ? { message: subject, body } : { message: subject };
      };

      const pushBranch = isDirectMode ? session.baseBranch : branchName;
      const commitResult = await this.commitPushManager.commitAndPush({
        ...runCtx,
        repoInfo,
        gitOps: session.gitOps,
        fileChanges: workResult.fileChanges,
        commitMessage,
        pushBranch,
        baseBranch: session.baseBranch,
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
        prOptions: repoConfig.prOptions,
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
        prTitle: description?.subject,
        prSummary: description?.prSummary,
      });
    } finally {
      if (session) {
        const s = session;
        safeCleanup(() => s.cleanup(), "session teardown failed", this.log);
      }
    }
  }

  private async describeChanges(
    repoConfig: RepoConfig,
    options: ProcessorOptions,
    runCtx: RunContext,
    workResult: WorkResult
  ): Promise<ChangeDescription | null> {
    const aiOptions = repoConfig.prOptions?.ai;
    if (!aiOptions || options.noAi) return null;
    if (runCtx.dryRun) {
      this.log.info(`Would generate AI commit message (${aiOptions.provider})`);
      return null;
    }
    this.log.info("Generating AI commit message...");
    return this.changeDescriber.describe({
      files: workResult.fileChangeDetails,
      options: aiOptions,
      retries: runCtx.retries,
    });
  }
}
