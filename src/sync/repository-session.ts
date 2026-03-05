import { RepoInfo } from "../shared/repo-detector.js";
import { ILogger } from "../shared/logger.js";
import { safeCleanup } from "../shared/type-guards.js";
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

    const { localOps, networkOps } = this.gitOpsFactory(
      { workDir, dryRun, retries },
      authOptions
    );

    this.log.debug("Cleaning workspace...");
    localOps.cleanWorkspace();

    this.log.debug("Cloning repository...");
    await networkOps.clone(repoInfo.gitUrl);

    const { branch: baseBranch, method: detectionMethod } =
      await networkOps.getDefaultBranch();
    this.log.info(
      `Default branch: ${baseBranch} (detected via ${detectionMethod})`
    );

    return {
      localOps,
      networkOps,
      baseBranch,
      cleanup: () => {
        safeCleanup(
          () => localOps.cleanWorkspace(),
          "workspace removal failed",
          this.log
        );
      },
    };
  }
}
