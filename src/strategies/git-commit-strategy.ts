import {
  ICommitStrategy,
  CommitOptions,
  CommitResult,
} from "./commit-strategy.js";
import { ICommandExecutor, defaultExecutor } from "../command-executor.js";
import { withRetry } from "../retry-utils.js";
import { escapeShellArg } from "../shell-utils.js";

/**
 * Git-based commit strategy using standard git commands (add, commit, push).
 * Used with PAT authentication. Commits via this strategy are NOT verified
 * by GitHub (no signature).
 */
export class GitCommitStrategy implements ICommitStrategy {
  private executor: ICommandExecutor;

  constructor(executor?: ICommandExecutor) {
    this.executor = executor ?? defaultExecutor;
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

    // Stage all changes
    await this.executor.exec("git add -A", workDir);

    // Commit with the message (--no-verify to skip pre-commit hooks)
    await this.executor.exec(
      `git commit --no-verify -m ${escapeShellArg(message)}`,
      workDir
    );

    // Push with authentication via gitOps if available
    if (gitOps) {
      await gitOps.push(branchName, { force });
    } else {
      // Fallback for non-authenticated scenarios (shouldn't happen in practice)
      const forceFlag = force ? "--force-with-lease " : "";
      const pushCommand = `git push ${forceFlag}-u origin ${escapeShellArg(branchName)}`;
      await withRetry(() => this.executor.exec(pushCommand, workDir), {
        retries,
      });
    }

    // Get the commit SHA
    const sha = await this.executor.exec("git rev-parse HEAD", workDir);

    return {
      sha: sha.trim(),
      verified: false, // Git-based commits are not verified
      pushed: true,
    };
  }
}
