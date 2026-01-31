import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  RepoConfig,
  FileContent,
  ContentValue,
  convertContentToString,
} from "./config.js";
import {
  RepoInfo,
  getRepoDisplayName,
  isGitHubRepo,
  GitHubRepoInfo,
} from "./repo-detector.js";
import { interpolateXfgContent } from "./xfg-template.js";
import { GitOps, GitOpsOptions } from "./git-ops.js";
import { createPR, mergePR, PRResult, FileAction } from "./pr-creator.js";
import { logger, ILogger } from "./logger.js";
import {
  getPRStrategy,
  getCommitStrategy,
  hasGitHubAppCredentials,
} from "./strategies/index.js";
import type { PRMergeConfig, FileChange } from "./strategies/index.js";
import { CommandExecutor, defaultExecutor } from "./command-executor.js";
import {
  getFileStatus,
  generateDiff,
  createDiffStats,
  incrementDiffStats,
  DiffStats,
} from "./diff-utils.js";
import {
  loadManifest,
  saveManifest,
  updateManifest,
  MANIFEST_FILENAME,
} from "./manifest.js";
import { GitHubAppTokenManager } from "./github-app-token-manager.js";

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
  /** Config ID for manifest namespacing */
  configId: string;
  dryRun?: boolean;
  /** Number of retries for network operations (default: 3) */
  retries?: number;
  /** Command executor for shell commands (for testing) */
  executor?: CommandExecutor;
  /** Custom PR body template */
  prTemplate?: string;
  /** Skip deleting orphaned files even if deleteOrphaned is configured */
  noDelete?: boolean;
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
  diffStats?: DiffStats;
}

export class RepositoryProcessor {
  private gitOps: GitOps | null = null;
  private readonly gitOpsFactory: GitOpsFactory;
  private readonly log: ILogger;
  private retries: number = 3;
  private executor: CommandExecutor = defaultExecutor;
  private readonly tokenManager: GitHubAppTokenManager | null;

  /**
   * Creates a new RepositoryProcessor.
   * @param gitOpsFactory - Optional factory for creating GitOps instances (for testing)
   * @param log - Optional logger instance (for testing)
   */
  constructor(gitOpsFactory?: GitOpsFactory, log?: ILogger) {
    this.gitOpsFactory = gitOpsFactory ?? ((opts) => new GitOps(opts));
    this.log = log ?? logger;

    // Initialize GitHub App token manager if credentials are configured
    if (hasGitHubAppCredentials()) {
      this.tokenManager = new GitHubAppTokenManager(
        process.env.XFG_GITHUB_APP_ID!,
        process.env.XFG_GITHUB_APP_PRIVATE_KEY!
      );
    } else {
      this.tokenManager = null;
    }
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { branchName, workDir, dryRun, prTemplate } = options;
    this.retries = options.retries ?? 3;
    this.executor = options.executor ?? defaultExecutor;

    // For GitHub repos with token manager, get installation token
    let token: string | undefined;
    if (this.tokenManager && isGitHubRepo(repoInfo)) {
      try {
        const tokenResult = await this.tokenManager.getTokenForRepo(
          repoInfo as GitHubRepoInfo
        );
        if (tokenResult === null) {
          // No installation found for this owner - skip the repo
          return {
            success: true,
            repoName,
            message: `No GitHub App installation found for ${repoInfo.owner}`,
            skipped: true,
          };
        }
        token = tokenResult;
      } catch (error) {
        // Token retrieval failed - continue without token and let auth fail naturally
        this.log.info(
          `Warning: Failed to get GitHub App token: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    this.gitOps = this.gitOpsFactory({
      workDir,
      dryRun,
      retries: this.retries,
    });

    // Determine merge mode early - affects workflow steps
    const mergeMode = repoConfig.prOptions?.merge ?? "auto";
    const isDirectMode = mergeMode === "direct";

    // Warn if mergeStrategy is set with direct mode (irrelevant)
    if (isDirectMode && repoConfig.prOptions?.mergeStrategy) {
      this.log.info(
        `Warning: mergeStrategy '${repoConfig.prOptions.mergeStrategy}' is ignored in direct mode (no PR created)`
      );
    }

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
        `Default branch: ${baseBranch} (detected via ${detectionMethod})`
      );

      // Step 3.5: Close existing PR if exists (fresh start approach)
      // This ensures isolated sync attempts - each run starts from clean state
      // Skip for direct mode - no PR involved
      if (!dryRun && !isDirectMode) {
        this.log.info("Checking for existing PR...");
        const strategy = getPRStrategy(repoInfo, this.executor);
        const closed = await strategy.closeExistingPR({
          repoInfo,
          branchName,
          baseBranch,
          workDir,
          retries: this.retries,
          token,
        });
        if (closed) {
          this.log.info("Closed existing PR and deleted branch for fresh sync");
          // Prune stale remote tracking refs so --force-with-lease works correctly
          // The remote branch was deleted but local git still has tracking info
          await this.gitOps.fetch({ prune: true });
        }
      }

      // Step 4: Create branch (always fresh from base branch)
      // Skip for direct mode - stay on default branch
      if (!isDirectMode) {
        this.log.info(`Creating branch: ${branchName}`);
        await this.gitOps.createBranch(branchName);
      } else {
        this.log.info(`Direct mode: staying on ${baseBranch}`);
      }

      // Step 5: Write all config files and track changes
      //
      // DESIGN NOTE: Change detection differs between dry-run and normal mode:
      // - Dry-run: Uses wouldChange() for read-only content comparison (no side effects)
      // - Normal: Uses git status after writing (source of truth for what git will commit)
      //
      // Track all file changes with content and action - single source of truth
      // Used for both commit message generation and actual commit
      const fileChangesForCommit = new Map<
        string,
        {
          content: string | null;
          action: "create" | "update" | "delete" | "skip";
        }
      >();
      const diffStats: DiffStats = createDiffStats();

      for (const file of repoConfig.files) {
        const filePath = join(workDir, file.fileName);
        const fileExistsLocal = existsSync(filePath);

        // Handle createOnly - check against BASE branch, not current working directory
        // This ensures consistent behavior: createOnly means "only create if doesn't exist on main"
        if (file.createOnly) {
          const existsOnBase = await this.gitOps.fileExistsOnBranch(
            file.fileName,
            baseBranch
          );
          if (existsOnBase) {
            this.log.info(
              `Skipping ${file.fileName} (createOnly: exists on ${baseBranch})`
            );
            fileChangesForCommit.set(file.fileName, {
              content: null,
              action: "skip",
            });
            continue;
          }
        }

        this.log.info(`Writing ${file.fileName}...`);

        // Apply xfg templating if enabled
        let contentToWrite: ContentValue | null = file.content;
        if (file.template && contentToWrite !== null) {
          contentToWrite = interpolateXfgContent(
            contentToWrite,
            {
              repoInfo,
              fileName: file.fileName,
              vars: file.vars,
            },
            { strict: true }
          );
        }

        const fileContent = convertContentToString(
          contentToWrite,
          file.fileName,
          {
            header: file.header,
            schemaUrl: file.schemaUrl,
          }
        );

        // Determine action type (create vs update) BEFORE writing
        const action: "create" | "update" = fileExistsLocal
          ? "update"
          : "create";

        // Check if file would change (needed for both modes)
        const existingContent = this.gitOps.getFileContent(file.fileName);
        const changed = this.gitOps.wouldChange(file.fileName, fileContent);

        if (changed) {
          // Track in single source of truth
          fileChangesForCommit.set(file.fileName, {
            content: fileContent,
            action,
          });
        }

        if (dryRun) {
          // In dry-run, show diff but don't write
          const status = getFileStatus(existingContent !== null, changed);
          incrementDiffStats(diffStats, status);

          const diffLines = generateDiff(
            existingContent,
            fileContent,
            file.fileName
          );
          this.log.fileDiff(file.fileName, status, diffLines);
        } else {
          // Write the file
          this.gitOps.writeFile(file.fileName, fileContent);
        }
      }

      // Step 5b: Set executable permission for files that need it
      for (const file of repoConfig.files) {
        // Skip files that were excluded (createOnly + exists)
        const tracked = fileChangesForCommit.get(file.fileName);
        if (tracked?.action === "skip") {
          continue;
        }

        if (shouldBeExecutable(file)) {
          this.log.info(`Setting executable: ${file.fileName}`);
          await this.gitOps!.setExecutable(file.fileName);
        }
      }

      // Step 5c: Handle orphaned file deletion (manifest-based tracking)
      const existingManifest = loadManifest(workDir);

      // Build map of files with their deleteOrphaned setting
      // Include ALL files from config, even skipped ones (createOnly + exists),
      // so they aren't incorrectly treated as orphaned (issue #199)
      const filesWithDeleteOrphaned = new Map<string, boolean | undefined>();
      for (const file of repoConfig.files) {
        filesWithDeleteOrphaned.set(file.fileName, file.deleteOrphaned);
      }

      // Update manifest and get list of files to delete
      const { manifest: newManifest, filesToDelete } = updateManifest(
        existingManifest,
        options.configId,
        filesWithDeleteOrphaned
      );

      // Delete orphaned files (unless --no-delete flag is set)
      if (filesToDelete.length > 0 && !options.noDelete) {
        for (const fileName of filesToDelete) {
          // Only delete if file actually exists in the working directory
          if (this.gitOps!.fileExists(fileName)) {
            // Track deletion in single source of truth
            fileChangesForCommit.set(fileName, {
              content: null,
              action: "delete",
            });

            if (dryRun) {
              // In dry-run, show what would be deleted
              this.log.fileDiff(fileName, "DELETED", []);
              incrementDiffStats(diffStats, "DELETED");
            } else {
              this.log.info(`Deleting orphaned file: ${fileName}`);
              this.gitOps!.deleteFile(fileName);
            }
          }
        }
      } else if (filesToDelete.length > 0 && options.noDelete) {
        this.log.info(
          `Skipping deletion of ${filesToDelete.length} orphaned file(s) (--no-delete flag)`
        );
      }

      // Save updated manifest (tracks files with deleteOrphaned: true)
      // Only save if there are managed files for any config, or if we had a previous manifest
      const hasAnyManagedFiles = Object.keys(newManifest.configs).length > 0;
      if (hasAnyManagedFiles || existingManifest !== null) {
        // Track manifest file as changed if it would be different
        const existingConfigs = existingManifest?.configs ?? {};
        const manifestChanged =
          JSON.stringify(existingConfigs) !==
          JSON.stringify(newManifest.configs);
        if (manifestChanged) {
          const manifestExisted = existsSync(join(workDir, MANIFEST_FILENAME));
          const manifestContent = JSON.stringify(newManifest, null, 2) + "\n";
          fileChangesForCommit.set(MANIFEST_FILENAME, {
            content: manifestContent,
            action: manifestExisted ? "update" : "create",
          });
        }

        if (!dryRun) {
          saveManifest(workDir, newManifest);
        }
      }

      // Show diff summary in dry-run mode
      if (dryRun) {
        this.log.diffSummary(
          diffStats.newCount,
          diffStats.modifiedCount,
          diffStats.unchangedCount,
          diffStats.deletedCount
        );
      }

      // Step 6: Derive changedFiles from single source of truth
      // This ensures dry-run and non-dry-run modes use identical logic
      const changedFiles: FileAction[] = Array.from(
        fileChangesForCommit.entries()
      ).map(([fileName, info]) => ({ fileName, action: info.action }));

      // Calculate diff stats for non-dry-run mode (dry-run already calculated above)
      if (!dryRun) {
        for (const [, info] of fileChangesForCommit) {
          if (info.action === "create") incrementDiffStats(diffStats, "NEW");
          else if (info.action === "update")
            incrementDiffStats(diffStats, "MODIFIED");
          else if (info.action === "delete")
            incrementDiffStats(diffStats, "DELETED");
        }
      }

      const hasChanges =
        changedFiles.filter((f) => f.action !== "skip").length > 0;

      if (!hasChanges) {
        return {
          success: true,
          repoName,
          message: "No changes detected",
          skipped: true,
          diffStats,
        };
      }

      // Step 7: Commit and Push using commit strategy
      const commitMessage = this.formatCommitMessage(changedFiles);
      const pushBranch = isDirectMode ? baseBranch : branchName;

      if (dryRun) {
        // In dry-run mode, just log what would happen
        this.log.info("Staging changes...");
        this.log.info(`Would commit: ${commitMessage}`);
        this.log.info(`Would push to ${pushBranch}...`);
      } else {
        // Build file changes for commit strategy (filter out skipped files)
        const fileChanges: FileChange[] = Array.from(
          fileChangesForCommit.entries()
        )
          .filter(([, info]) => info.action !== "skip")
          .map(([path, info]) => ({ path, content: info.content }));

        // Check if there are actually staged changes (edge case handling)
        // This handles scenarios where git status shows changes but git add doesn't stage anything
        // (e.g., due to .gitattributes normalization)
        this.log.info("Staging changes...");
        await this.executor.exec("git add -A", workDir);
        if (!(await this.gitOps.hasStagedChanges())) {
          this.log.info("No staged changes after git add -A, skipping commit");
          return {
            success: true,
            repoName,
            message: "No changes detected after staging",
            skipped: true,
            diffStats,
          };
        }

        // Use commit strategy (GitCommitStrategy or GraphQLCommitStrategy)
        const commitStrategy = getCommitStrategy(repoInfo, this.executor);
        this.log.info("Committing and pushing changes...");
        try {
          const commitResult = await commitStrategy.commit({
            repoInfo,
            branchName: pushBranch,
            message: commitMessage,
            fileChanges,
            workDir,
            retries: this.retries,
            // Use force push (--force-with-lease) for PR branches, not for direct mode
            force: !isDirectMode,
            token,
          });
          this.log.info(
            `Committed: ${commitResult.sha} (verified: ${commitResult.verified})`
          );
        } catch (error) {
          // Handle branch protection errors in direct mode
          if (isDirectMode) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            if (
              errorMessage.includes("rejected") ||
              errorMessage.includes("protected") ||
              errorMessage.includes("denied")
            ) {
              return {
                success: false,
                repoName,
                message: `Push to '${baseBranch}' was rejected (likely branch protection). To use 'direct' mode, the target branch must allow direct pushes. Use 'merge: force' to create a PR and merge with admin privileges.`,
              };
            }
          }
          throw error;
        }
      }

      // Direct mode: no PR creation, return success
      if (isDirectMode) {
        this.log.info(`Changes pushed directly to ${baseBranch}`);
        return {
          success: true,
          repoName,
          message: `Pushed directly to ${baseBranch}`,
          diffStats,
        };
      }

      // Step 9: Create PR (non-direct modes only)
      this.log.info("Creating pull request...");
      const prResult: PRResult = await createPR({
        repoInfo,
        branchName,
        baseBranch,
        files: changedFiles,
        workDir,
        dryRun,
        retries: this.retries,
        prTemplate,
        executor: this.executor,
        token,
      });

      // Step 10: Handle merge options if configured
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
          retries: this.retries,
          executor: this.executor,
          token,
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
        diffStats,
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
    const deletedFiles = changedFiles.filter((f) => f.action === "delete");
    const syncedFiles = changedFiles.filter((f) => f.action !== "delete");

    // If only deletions, use "remove" prefix
    if (syncedFiles.length === 0 && deletedFiles.length > 0) {
      if (deletedFiles.length === 1) {
        return `chore: remove ${deletedFiles[0].fileName}`;
      }
      return `chore: remove ${deletedFiles.length} orphaned config files`;
    }

    // Mixed or only syncs
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
