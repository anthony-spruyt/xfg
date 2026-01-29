import {
  CommitStrategy,
  CommitOptions,
  CommitResult,
} from "./commit-strategy.js";
import { CommandExecutor, defaultExecutor } from "../command-executor.js";
import { withRetry } from "../retry-utils.js";
import { escapeShellArg } from "../shell-utils.js";

/**
 * Git-based commit strategy using standard git commands (add, commit, push).
 * Used with PAT authentication. Commits via this strategy are NOT verified
 * by GitHub (no signature).
 */
export class GitCommitStrategy implements CommitStrategy {
  private executor: CommandExecutor;

  constructor(executor?: CommandExecutor) {
    this.executor = executor ?? defaultExecutor;
  }

  /**
   * Create a commit with the given file changes and push to remote.
   * Runs: git add -A, git commit, git push (with optional --force-with-lease)
   *
   * @returns Commit result with SHA and verified: false (no signature)
   */
  async commit(options: CommitOptions): Promise<CommitResult> {
    const { branchName, message, workDir, retries = 3, force = true } = options;

    // Stage all changes
    await this.executor.exec("git add -A", workDir);

    // Commit with the message (--no-verify to skip pre-commit hooks)
    await this.executor.exec(
      `git commit --no-verify -m ${escapeShellArg(message)}`,
      workDir
    );

    // Build push command - use --force-with-lease for PR branches, regular push for direct mode
    const forceFlag = force ? "--force-with-lease " : "";
    const pushCommand = `git push ${forceFlag}-u origin ${escapeShellArg(branchName)}`;

    // Push with retry for transient network failures
    await withRetry(() => this.executor.exec(pushCommand, workDir), {
      retries,
    });

    // Get the commit SHA
    const sha = await this.executor.exec("git rev-parse HEAD", workDir);

    return {
      sha: sha.trim(),
      verified: false, // Git-based commits are not verified
      pushed: true,
    };
  }
}
