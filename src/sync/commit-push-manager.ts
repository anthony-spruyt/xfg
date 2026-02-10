import { ILogger } from "../shared/logger.js";
import { getCommitStrategy, type FileChange } from "../vcs/index.js";
import type {
  CommitPushOptions,
  CommitPushResult,
  ICommitPushManager,
} from "./types.js";

export class CommitPushManager implements ICommitPushManager {
  constructor(private readonly log: ILogger) {}

  async commitAndPush(
    options: CommitPushOptions,
    repoName: string
  ): Promise<CommitPushResult> {
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

    // Dry-run mode: just log
    if (dryRun) {
      this.log.info("Staging changes...");
      this.log.info(`Would commit: ${commitMessage}`);
      this.log.info(`Would push to ${pushBranch}...`);
      return { success: true };
    }

    // Build file changes for commit strategy
    const changes: FileChange[] = Array.from(fileChanges.entries())
      .filter(([, info]) => info.action !== "skip")
      .map(([path, info]) => ({ path, content: info.content }));

    // Stage changes using injected executor (existing pattern in codebase)
    this.log.info("Staging changes...");
    await executor.exec("git add -A", workDir);

    // Check for staged changes
    if (!(await gitOps.hasStagedChanges())) {
      this.log.info("No staged changes after git add -A, skipping commit");
      return { success: true, skipped: true };
    }

    // Commit and push
    const commitStrategy = getCommitStrategy(repoInfo, executor);
    this.log.info("Committing and pushing changes...");

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
      return this.handleCommitError(error, isDirectMode, pushBranch, repoName);
    }
  }

  private handleCommitError(
    error: unknown,
    isDirectMode: boolean,
    baseBranch: string,
    repoName: string
  ): CommitPushResult {
    if (!isDirectMode) {
      throw error; // Re-throw for non-direct mode
    }

    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("rejected") ||
      message.includes("protected") ||
      message.includes("denied")
    ) {
      return {
        success: false,
        errorResult: {
          success: false,
          repoName,
          message:
            `Push to '${baseBranch}' was rejected (likely branch protection). ` +
            `To use 'direct' mode, the target branch must allow direct pushes. ` +
            `Use 'merge: force' to create a PR and merge with admin privileges.`,
        },
      };
    }

    throw error;
  }
}
