import type { RepoInfo } from "../repo/detector.js";
import type { ILogger } from "../shared/logger.js";
import { safeCleanup } from "../shared/cleanup-utils.js";
import type {
  GitOpsFactory,
  SessionOptions,
  SessionContext,
  IRepositorySession,
} from "./types.js";

export class RepositorySession implements IRepositorySession {
  constructor(
    private readonly gitOpsFactory: GitOpsFactory,
    private readonly log: ILogger
  ) {}

  async setup(
    repoInfo: RepoInfo,
    options: SessionOptions
  ): Promise<SessionContext> {
    const { workDir, dryRun, retries, authOptions } = options;

    const { executor } = options;
    const gitOps = this.gitOpsFactory(
      { workDir, dryRun, executor },
      authOptions,
      retries
    );

    this.log.debug("Cleaning workspace...");
    gitOps.cleanWorkspace();

    this.log.debug("Cloning repository...");
    await gitOps.clone(repoInfo.gitUrl);

    const { branch: baseBranch, method: detectionMethod } =
      await gitOps.getDefaultBranch();
    this.log.info(
      `Default branch: ${baseBranch} (detected via ${detectionMethod})`
    );

    return {
      gitOps,
      baseBranch,
      cleanup: () => {
        safeCleanup(
          () => gitOps.cleanWorkspace(),
          "workspace removal failed",
          this.log
        );
      },
    };
  }
}
