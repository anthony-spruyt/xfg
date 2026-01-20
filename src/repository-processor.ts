import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  RepoConfig,
  FileContent,
  convertContentToString,
  PRMergeOptions,
} from "./config.js";
import { RepoInfo, getRepoDisplayName } from "./repo-detector.js";
import { GitOps, GitOpsOptions } from "./git-ops.js";
import { createPR, mergePR, PRResult, FileAction } from "./pr-creator.js";
import { logger, ILogger } from "./logger.js";
import { getPRStrategy } from "./strategies/index.js";
import type { PRMergeConfig } from "./strategies/index.js";
import { CommandExecutor, defaultExecutor } from "./command-executor.js";

/**
 * Determines if a file should be marked as executable.
 * .sh files are auto-executable unless explicit executable: false is set.
 * Non-.sh files are executable only if executable: true is explicitly set.
 */
function shouldBeExecutable(file: FileContent): boolean {
  const isShellScript = file.fileName.endsWith(".sh");

  if (file.executable !== undefined) {
    // Explicit setting takes precedence
    return file.executable;
  }

  // Default: .sh files are executable, others are not
  return isShellScript;
}

export interface ProcessorOptions {
  branchName: string;
  workDir: string;
  dryRun?: boolean;
  /** Number of retries for network operations (default: 3) */
  retries?: number;
  /** Command executor for shell commands (for testing) */
  executor?: CommandExecutor;
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
  mergeResult?: {
    merged: boolean;
    autoMergeEnabled?: boolean;
    message: string;
  };
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
    const { branchName, workDir, dryRun, retries } = options;
    const executor = options.executor ?? defaultExecutor;

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

      // Step 3.5: Close existing PR if exists (fresh start approach)
      // This ensures isolated sync attempts - each run starts from clean state
      if (!dryRun) {
        this.log.info("Checking for existing PR...");
        const strategy = getPRStrategy(repoInfo, executor);
        const closed = await strategy.closeExistingPR({
          repoInfo,
          branchName,
          baseBranch,
          workDir,
          retries,
        });
        if (closed) {
          this.log.info("Closed existing PR and deleted branch for fresh sync");
        }
      }

      // Step 4: Create branch (always fresh from base branch)
      this.log.info(`Creating branch: ${branchName}`);
      await this.gitOps.createBranch(branchName);

      // Step 5: Write all config files and track changes
      const changedFiles: FileAction[] = [];

      for (const file of repoConfig.files) {
        const filePath = join(workDir, file.fileName);
        const fileExistsLocal = existsSync(filePath);

        // Handle createOnly - check against BASE branch, not current working directory
        // This ensures consistent behavior: createOnly means "only create if doesn't exist on main"
        if (file.createOnly) {
          const existsOnBase = await this.gitOps.fileExistsOnBranch(
            file.fileName,
            baseBranch,
          );
          if (existsOnBase) {
            this.log.info(
              `Skipping ${file.fileName} (createOnly: exists on ${baseBranch})`,
            );
            changedFiles.push({ fileName: file.fileName, action: "skip" });
            continue;
          }
        }

        this.log.info(`Writing ${file.fileName}...`);
        const fileContent = convertContentToString(
          file.content,
          file.fileName,
          {
            header: file.header,
            schemaUrl: file.schemaUrl,
          },
        );

        // Determine action type (create vs update)
        const action: "create" | "update" = fileExistsLocal
          ? "update"
          : "create";

        if (dryRun) {
          // In dry-run, check if file would change without writing
          if (this.gitOps.wouldChange(file.fileName, fileContent)) {
            changedFiles.push({ fileName: file.fileName, action });
          }
        } else {
          // Write the file
          this.gitOps.writeFile(file.fileName, fileContent);
        }
      }

      // Step 5b: Set executable permission for files that need it
      const skippedFileNames = new Set(
        changedFiles.filter((f) => f.action === "skip").map((f) => f.fileName),
      );
      for (const file of repoConfig.files) {
        // Skip files that were excluded (createOnly + exists)
        if (skippedFileNames.has(file.fileName)) {
          continue;
        }

        if (shouldBeExecutable(file)) {
          this.log.info(`Setting executable: ${file.fileName}`);
          await this.gitOps!.setExecutable(file.fileName);
        }
      }

      // Step 6: Check for changes (exclude skipped files)
      let hasChanges: boolean;
      if (dryRun) {
        hasChanges = changedFiles.filter((f) => f.action !== "skip").length > 0;
      } else {
        hasChanges = await this.gitOps.hasChanges();
        // If there are changes, determine which files changed
        if (hasChanges) {
          // Get the actual list of changed files from git status
          const gitChangedFiles = new Set(await this.gitOps.getChangedFiles());

          // Preserve skipped files (createOnly)
          const skippedFiles = new Set(
            changedFiles
              .filter((f) => f.action === "skip")
              .map((f) => f.fileName),
          );

          // Only add files that actually changed according to git
          for (const file of repoConfig.files) {
            if (skippedFiles.has(file.fileName)) {
              continue; // Already tracked as skipped
            }
            // Only include files that git reports as changed
            if (!gitChangedFiles.has(file.fileName)) {
              continue; // File didn't actually change
            }
            const filePath = join(workDir, file.fileName);
            const action: "create" | "update" = existsSync(filePath)
              ? "update"
              : "create";
            changedFiles.push({ fileName: file.fileName, action });
          }
        }
      }

      if (!hasChanges) {
        return {
          success: true,
          repoName,
          message: "No changes detected",
          skipped: true,
        };
      }

      // Step 7: Commit
      this.log.info("Staging changes...");
      const commitMessage = this.formatCommitMessage(changedFiles);
      const committed = await this.gitOps.commit(commitMessage);

      if (!committed) {
        this.log.info("No staged changes after git add -A, skipping commit");
        return {
          success: true,
          repoName,
          message: "No changes detected after staging",
          skipped: true,
        };
      }

      this.log.info(`Committed: ${commitMessage}`);

      // Step 8: Push
      this.log.info("Pushing to remote...");
      await this.gitOps.push(branchName);

      // Step 9: Create PR
      this.log.info("Creating pull request...");
      const prResult: PRResult = await createPR({
        repoInfo,
        branchName,
        baseBranch,
        files: changedFiles,
        workDir,
        dryRun,
        retries,
      });

      // Step 10: Handle merge options if configured
      const mergeMode = repoConfig.prOptions?.merge ?? "auto";
      let mergeResult: ProcessorResult["mergeResult"] | undefined;

      if (prResult.success && prResult.url && mergeMode !== "manual") {
        this.log.info(`Handling merge (mode: ${mergeMode})...`);

        const mergeConfig: PRMergeConfig = {
          mode: mergeMode,
          strategy: repoConfig.prOptions?.mergeStrategy ?? "squash",
          deleteBranch: repoConfig.prOptions?.deleteBranch ?? true,
          bypassReason: repoConfig.prOptions?.bypassReason,
        };

        const result = await mergePR({
          repoInfo,
          prUrl: prResult.url,
          mergeConfig,
          workDir,
          dryRun,
          retries,
        });

        mergeResult = {
          merged: result.merged ?? false,
          autoMergeEnabled: result.autoMergeEnabled,
          message: result.message,
        };

        if (!result.success) {
          this.log.info(`Warning: Merge operation failed - ${result.message}`);
        } else {
          this.log.info(result.message);
        }
      }

      return {
        success: prResult.success,
        repoName,
        message: prResult.message,
        prUrl: prResult.url,
        mergeResult,
      };
    } finally {
      // Always cleanup workspace on completion or failure
      if (this.gitOps) {
        try {
          this.gitOps.cleanWorkspace();
        } catch {
          // Ignore cleanup errors - best effort
        }
      }
    }
  }

  /**
   * Format commit message based on files changed (excludes skipped files)
   */
  private formatCommitMessage(files: FileAction[]): string {
    const changedFiles = files.filter((f) => f.action !== "skip");

    if (changedFiles.length === 1) {
      return `chore: sync ${changedFiles[0].fileName}`;
    }

    if (changedFiles.length <= 3) {
      const fileNames = changedFiles.map((f) => f.fileName).join(", ");
      return `chore: sync ${fileNames}`;
    }

    return `chore: sync ${changedFiles.length} config files`;
  }
}
