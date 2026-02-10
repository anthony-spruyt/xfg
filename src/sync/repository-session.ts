import { RepoInfo } from "../shared/repo-detector.js";
import { ILogger } from "../shared/logger.js";
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

    // Create gitOps instance
    const gitOps = this.gitOpsFactory(
      { workDir, dryRun, retries },
      authOptions
    );

    // Clean workspace
    this.log.info("Cleaning workspace...");
    gitOps.cleanWorkspace();

    // Clone repository
    this.log.info("Cloning repository...");
    await gitOps.clone(repoInfo.gitUrl);

    // Detect default branch
    const { branch: baseBranch, method: detectionMethod } =
      await gitOps.getDefaultBranch();
    this.log.info(
      `Default branch: ${baseBranch} (detected via ${detectionMethod})`
    );

    // Return context with cleanup function
    return {
      gitOps,
      baseBranch,
      cleanup: () => {
        try {
          gitOps.cleanWorkspace();
        } catch {
          // Ignore cleanup errors - best effort
        }
      },
    };
  }
}
