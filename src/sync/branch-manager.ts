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
      localOps,
      networkOps,
      executor,
    } = options;

    if (isDirectMode) {
      this.log.debug(`Direct mode: staying on ${baseBranch}`);
      return;
    }

    if (!dryRun) {
      this.log.debug("Checking for existing PR...");
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
        await networkOps.fetch({ prune: true });
      }
    }

    this.log.debug(`Creating branch: ${branchName}`);
    await localOps.createBranch(branchName);
  }
}
