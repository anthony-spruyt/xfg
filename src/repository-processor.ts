import { existsSync } from "node:fs";
import { join } from "node:path";
import { RepoConfig, convertContentToString } from "./config.js";
import { RepoInfo, getRepoDisplayName } from "./repo-detector.js";
import { GitOps, GitOpsOptions } from "./git-ops.js";
import { createPR, PRResult } from "./pr-creator.js";
import { logger, ILogger } from "./logger.js";

export interface ProcessorOptions {
  fileName: string;
  branchName: string;
  workDir: string;
  dryRun?: boolean;
  /** Number of retries for network operations (default: 3) */
  retries?: number;
}

/**
 * Factory function type for creating GitOps instances.
 * Allows dependency injection for testing.
 */
export type GitOpsFactory = (options: GitOpsOptions) => GitOps;

export interface ProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  prUrl?: string;
  skipped?: boolean;
}

export class RepositoryProcessor {
  private gitOps: GitOps | null = null;
  private readonly gitOpsFactory: GitOpsFactory;
  private readonly log: ILogger;

  /**
   * Creates a new RepositoryProcessor.
   * @param gitOpsFactory - Optional factory for creating GitOps instances (for testing)
   * @param log - Optional logger instance (for testing)
   */
  constructor(gitOpsFactory?: GitOpsFactory, log?: ILogger) {
    this.gitOpsFactory = gitOpsFactory ?? ((opts) => new GitOps(opts));
    this.log = log ?? logger;
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions,
  ): Promise<ProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { fileName, branchName, workDir, dryRun, retries } = options;

    this.gitOps = this.gitOpsFactory({ workDir, dryRun, retries });

    try {
      // Step 1: Clean workspace
      this.log.info("Cleaning workspace...");
      this.gitOps.cleanWorkspace();

      // Step 2: Clone repo
      this.log.info("Cloning repository...");
      await this.gitOps.clone(repoInfo.gitUrl);

      // Step 3: Get default branch for PR base
      const { branch: baseBranch, method: detectionMethod } =
        await this.gitOps.getDefaultBranch();
      this.log.info(
        `Default branch: ${baseBranch} (detected via ${detectionMethod})`,
      );

      // Step 4: Create/checkout branch
      this.log.info(`Switching to branch: ${branchName}`);
      await this.gitOps.createBranch(branchName);

      // Step 5: Write config file
      this.log.info(`Writing ${fileName}...`);
      const fileContent = convertContentToString(repoConfig.content, fileName);

      // Step 6: Check for changes and determine action
      // NOTE: This is NOT a race condition. We intentionally:
      // 1. Capture action type (create/update) BEFORE writing - for PR title
      // 2. Check git status AFTER writing - to detect actual content changes
      // The action type is cosmetic for the PR; hasChanges() determines whether to proceed.
      // If file exists with identical content: action="update", hasChanges=false -> skip (correct)
      // If file doesn't exist: action="create", hasChanges=true -> proceed (correct)
      const filePath = join(workDir, fileName);
      let action: "create" | "update";
      let wouldHaveChanges: boolean;

      if (dryRun) {
        action = existsSync(filePath) ? "update" : "create";
        wouldHaveChanges = this.gitOps.wouldChange(fileName, fileContent);
      } else {
        // Capture action and write atomically (in same sync block)
        action = existsSync(filePath) ? "update" : "create";
        this.gitOps!.writeFile(fileName, fileContent);
        wouldHaveChanges = await this.gitOps!.hasChanges();
      }

      if (!wouldHaveChanges) {
        return {
          success: true,
          repoName,
          message: "No changes detected",
          skipped: true,
        };
      }

      // Step 7: Commit
      this.log.info("Committing changes...");
      await this.gitOps.commit(`chore: sync ${fileName}`);

      // Step 8: Push
      this.log.info("Pushing to remote...");
      await this.gitOps.push(branchName);

      // Step 9: Create PR
      this.log.info("Creating pull request...");
      const prResult: PRResult = await createPR({
        repoInfo,
        branchName,
        baseBranch,
        fileName,
        action,
        workDir,
        dryRun,
        retries,
      });

      return {
        success: prResult.success,
        repoName,
        message: prResult.message,
        prUrl: prResult.url,
      };
    } finally {
      // Always cleanup workspace on completion or failure (Improvement 3)
      if (this.gitOps) {
        try {
          this.gitOps.cleanWorkspace();
        } catch {
          // Ignore cleanup errors - best effort
        }
      }
    }
  }
}
