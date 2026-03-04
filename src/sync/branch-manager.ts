import { getPRStrategy } from "../vcs/index.js";
import type { ILogger } from "../shared/logger.js";
import type { IBranchManager, BranchSetupOptions } from "./types.js";

/**
 * Handles branch creation and existing PR cleanup.
 * Receives stable dependencies (logger) via constructor;
 * per-call data (repo, branch, executor) via setupBranch options.
 */
export class BranchManager implements IBranchManager {
  constructor(private readonly log: ILogger) {}

  async setupBranch(options: BranchSetupOptions): Promise<void> {
    const {
      repoInfo,
      branchName,
      baseBranch,
      workDir,
      isDirectMode,
      dryRun,
      retries,
      token,
      gitOps,
      executor,
    } = options;

    // Direct mode: stay on default branch, no PR cleanup needed
    if (isDirectMode) {
      this.log.info(`Direct mode: staying on ${baseBranch}`);
      return;
    }

    // Close existing PR if exists (fresh start approach)
    // Skip for dry-run mode
    if (!dryRun) {
      this.log.info("Checking for existing PR...");
      const strategy = getPRStrategy(repoInfo, executor);
      const closed = await strategy.closeExistingPR({
        repoInfo,
        branchName,
        baseBranch,
        workDir,
        retries,
        token,
      });

      if (closed) {
        this.log.info("Closed existing PR and deleted branch for fresh sync");
        // Prune stale remote tracking refs so --force-with-lease works correctly
        await gitOps.fetch({ prune: true });
      }
    }

    // Create branch (always fresh from base branch)
    this.log.info(`Creating branch: ${branchName}`);
    await gitOps.createBranch(branchName);
  }
}
