import { createCommitStrategy, type FileChange } from "../vcs/index.js";
import type { ICommitStrategy } from "../vcs/index.js";
import type { RepoInfo } from "../repo/index.js";
import { getRepoDisplayName } from "../repo/index.js";
import type { ICommandExecutor } from "../shared/command-executor.js";
import type {
  CommitPushOptions,
  CommitPushResult,
  ICommitPushManager,
} from "./types.js";
import { toErrorMessage } from "../shared/type-guards.js";
import type { DebugInfoLog } from "../shared/logger.js";

type CommitStrategyFactory = (
  repoInfo: RepoInfo,
  executor: ICommandExecutor,
  hasAppCredentials?: boolean
) => ICommitStrategy;

export class CommitPushManager implements ICommitPushManager {
  constructor(
    private readonly log: DebugInfoLog,
    private readonly commitStrategyFactory: CommitStrategyFactory = createCommitStrategy
  ) {}

  async commitAndPush(options: CommitPushOptions): Promise<CommitPushResult> {
    const {
      repoInfo,
      gitOps,
      workDir,
      fileChanges,
      commitMessage,
      pushBranch,
      isDirectMode,
      dryRun,
      retries,
      token,
      executor,
    } = options;

    if (dryRun) {
      this.log.debug("Staging changes...");
      this.log.info(`Would commit: ${commitMessage}`);
      this.log.info(`Would push to ${pushBranch}`);
      return { success: true };
    }

    const changes: FileChange[] = Array.from(fileChanges.entries())
      .filter(([, info]) => info.action !== "skip")
      .map(([path, info]) => ({
        path,
        content: info.content,
        ...(info.mode ? { mode: info.mode } : {}),
      }));

    this.log.info("Staging changes...");
    await gitOps.stageAll();

    if (!(await gitOps.hasStagedChanges())) {
      this.log.info("No staged changes, skipping commit");
      return { success: true, skipped: true };
    }

    const commitStrategy = this.commitStrategyFactory(
      repoInfo,
      executor,
      options.hasAppCredentials
    );
    this.log.debug("Committing and pushing changes...");

    try {
      const result = await commitStrategy.commit({
        repoInfo,
        branchName: pushBranch,
        message: commitMessage,
        fileChanges: changes,
        workDir,
        retries,
        force: !isDirectMode,
        token,
        gitOps,
      });
      this.log.info(`Committed: ${result.sha} (verified: ${result.verified})`);
      return { success: true };
    } catch (error) {
      return this.classifyCommitError(
        error,
        isDirectMode,
        pushBranch,
        repoInfo
      );
    }
  }

  private classifyCommitError(
    error: unknown,
    isDirectMode: boolean,
    pushBranch: string,
    repoInfo: CommitPushOptions["repoInfo"]
  ): CommitPushResult {
    const repoName = getRepoDisplayName(repoInfo);
    const message = toErrorMessage(error);

    if (
      isDirectMode &&
      (message.includes("rejected") ||
        message.includes("protected") ||
        message.includes("denied"))
    ) {
      return {
        success: false,
        errorResult: {
          success: false,
          repoName,
          message:
            `Push to '${pushBranch}' was rejected (likely branch protection). ` +
            `To use 'direct' mode, the target branch must allow direct pushes. ` +
            `Use 'merge: force' to create a PR and merge with admin privileges.`,
        },
      };
    }

    return {
      success: false,
      errorResult: {
        success: false,
        repoName,
        message: `Commit/push failed: ${message}`,
      },
    };
  }
}
