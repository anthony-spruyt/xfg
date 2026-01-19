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
import type { PRMergeConfig } from "./strategies/index.js";

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

      // Step 5: Write all config files and track changes
      const changedFiles: FileAction[] = [];

      for (const file of repoConfig.files) {
        const filePath = join(workDir, file.fileName);
        const fileExists = existsSync(filePath);

        // Handle createOnly - skip if file already exists
        if (file.createOnly && fileExists) {
          this.log.info(
            `Skipping ${file.fileName} (createOnly: already exists)`,
          );
          changedFiles.push({ fileName: file.fileName, action: "skip" });
          continue;
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
        const action: "create" | "update" = fileExists ? "update" : "create";

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
          // Rebuild the changed files list by checking git status
          // Skip files that were already marked as skipped (createOnly)
          const skippedFiles = new Set(
            changedFiles
              .filter((f) => f.action === "skip")
              .map((f) => f.fileName),
          );
          for (const file of repoConfig.files) {
            if (skippedFiles.has(file.fileName)) {
              continue; // Already tracked as skipped
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
      this.log.info("Committing changes...");
      const commitMessage = this.formatCommitMessage(changedFiles);
      await this.gitOps.commit(commitMessage);

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
