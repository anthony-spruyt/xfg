import { getPRStrategy } from "../vcs/index.js";
import type { IPRStrategy } from "../vcs/types.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ICommandExecutor } from "../shared/command-executor.js";
import type { IBranchManager, BranchSetupOptions } from "./types.js";

type SyncLog = {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
};

type PRStrategyFactory = (
  repoInfo: RepoInfo,
  executor?: ICommandExecutor,
  log?: SyncLog
) => IPRStrategy;

export class BranchManager implements IBranchManager {
  constructor(
    private readonly log: SyncLog,
    private readonly prStrategyFactory: PRStrategyFactory = getPRStrategy
  ) {}

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

    if (isDirectMode) {
      this.log.debug(`Direct mode: staying on ${baseBranch}`);
      return;
    }

    if (!dryRun) {
      this.log.debug("Checking for existing PR...");
      const strategy = this.prStrategyFactory(repoInfo, executor, this.log);
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

    this.log.debug(`Creating branch: ${branchName}`);
    await gitOps.createBranch(branchName);
  }
}
