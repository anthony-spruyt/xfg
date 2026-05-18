import type { ICommitStrategy, CommitOptions, CommitResult } from "../types.js";
import type { ICommandExecutor } from "../../shared/command-executor.js";
import { withRetry } from "../../shared/retry-utils.js";

/**
 * Git-based commit strategy using standard git commands (add, commit, push).
 * Used with PAT authentication. Commits via this strategy are NOT verified
 * by GitHub (no signature).
 */
export class GitCommitStrategy implements ICommitStrategy {
  private executor: ICommandExecutor;

  constructor(executor: ICommandExecutor) {
    this.executor = executor;
  }

  /**
   * Create a commit with the given file changes and push to remote.
   * Runs: git add -A, git commit, git push (with optional --force-with-lease)
   *
   * @returns Commit result with SHA and verified: false (no signature)
   */
  async commit(options: CommitOptions): Promise<CommitResult> {
    const {
      branchName,
      message,
      workDir,
      retries = 3,
      force = true,
      gitOps,
    } = options;

    // Commit with the message (--no-verify to skip pre-commit hooks)
    // Staging is handled by CommitPushManager before calling commit()
    await this.executor.exec(
      "git",
      ["commit", "--no-verify", "-m", message],
      workDir
    );

    // Push with authentication via gitOps if available
    if (gitOps) {
      await gitOps.push(branchName, { force });
    } else {
      // Fallback for non-authenticated scenarios (shouldn't happen in practice)
      const args = [
        "push",
        ...(force ? ["--force-with-lease"] : []),
        "-u",
        "origin",
        branchName,
      ];
      await withRetry(() => this.executor.exec("git", args, workDir), {
        retries,
      });
    }

    const sha = await this.executor.exec("git", ["rev-parse", "HEAD"], workDir);

    return {
      sha: sha.trim(),
      verified: false, // Git-based commits are not verified
      pushed: true,
    };
  }
}
