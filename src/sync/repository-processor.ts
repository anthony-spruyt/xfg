import { RepoConfig } from "../config/index.js";
import {
  RepoInfo,
  getRepoDisplayName,
  isGitHubRepo,
  GitHubRepoInfo,
} from "../shared/repo-detector.js";
import { GitOps, GitOpsOptions } from "../git/git-ops.js";
import {
  AuthenticatedGitOps,
  IAuthenticatedGitOps,
  GitAuthOptions,
} from "../git/authenticated-git-ops.js";
import { createPR, mergePR, PRResult, FileAction } from "../git/pr-creator.js";
import { logger, ILogger } from "../shared/logger.js";
import {
  getCommitStrategy,
  hasGitHubAppCredentials,
} from "../strategies/index.js";
import type { PRMergeConfig, FileChange } from "../strategies/index.js";
import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import { incrementDiffStats, DiffStats } from "./diff-utils.js";
import {
  loadManifest,
  saveManifest,
  updateManifestRulesets,
  MANIFEST_FILENAME,
} from "./manifest.js";
import { GitHubAppTokenManager } from "../git/github-app-token-manager.js";
import {
  FileWriter,
  ManifestManager,
  BranchManager,
  type IFileWriter,
  type IManifestManager,
  type IBranchManager,
} from "./index.js";

export interface IRepositoryProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult>;
  updateManifestOnly(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: ProcessorOptions,
    manifestUpdate: { rulesets: string[] }
  ): Promise<ProcessorResult>;
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
  executor?: ICommandExecutor;
  /** Custom PR body template */
  prTemplate?: string;
  /** Skip deleting orphaned files even if deleteOrphaned is configured */
  noDelete?: boolean;
}

/**
 * Factory function type for creating IAuthenticatedGitOps instances.
 * Allows dependency injection for testing.
 */
export type GitOpsFactory = (
  options: GitOpsOptions,
  auth?: GitAuthOptions
) => IAuthenticatedGitOps;

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

export class RepositoryProcessor implements IRepositoryProcessor {
  private gitOps: IAuthenticatedGitOps | null = null;
  private readonly gitOpsFactory: GitOpsFactory;
  private readonly log: ILogger;
  private retries: number = 3;
  private executor: ICommandExecutor = defaultExecutor;
  private readonly tokenManager: GitHubAppTokenManager | null;
  private readonly fileWriter: IFileWriter;
  private readonly manifestManager: IManifestManager;
  private readonly branchManager: IBranchManager;

  /**
   * Creates a new RepositoryProcessor.
   * @param gitOpsFactory - Optional factory for creating AuthenticatedGitOps instances (for testing)
   * @param log - Optional logger instance (for testing)
   * @param components - Optional component injections (for testing)
   */
  constructor(
    gitOpsFactory?: GitOpsFactory,
    log?: ILogger,
    components?: {
      fileWriter?: IFileWriter;
      manifestManager?: IManifestManager;
      branchManager?: IBranchManager;
    }
  ) {
    this.gitOpsFactory =
      gitOpsFactory ??
      ((opts, auth) => new AuthenticatedGitOps(new GitOps(opts), auth));
    this.log = log ?? logger;
    this.fileWriter = components?.fileWriter ?? new FileWriter();
    this.manifestManager = components?.manifestManager ?? new ManifestManager();
    this.branchManager = components?.branchManager ?? new BranchManager();

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

    // Get installation token if needed
    const token = await this.getInstallationToken(repoInfo);
    if (token === null) {
      return {
        success: true,
        repoName,
        message: `No GitHub App installation found for ${repoInfo.owner}`,
        skipped: true,
      };
    }

    // Build auth options - use installation token OR fall back to GH_TOKEN for PAT flow
    const effectiveToken =
      token ?? (isGitHubRepo(repoInfo) ? process.env.GH_TOKEN : undefined);
    const authOptions: GitAuthOptions | undefined = effectiveToken
      ? {
          token: effectiveToken,
          host: isGitHubRepo(repoInfo)
            ? (repoInfo as GitHubRepoInfo).host
            : "github.com",
          owner: repoInfo.owner,
          repo: repoInfo.repo,
        }
      : undefined;

    this.gitOps = this.gitOpsFactory(
      {
        workDir,
        dryRun,
        retries: this.retries,
      },
      authOptions
    );

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

      // Step 3.5 & 4: Setup branch using BranchManager
      await this.branchManager.setupBranch({
        repoInfo,
        branchName,
        baseBranch,
        workDir,
        isDirectMode,
        dryRun: dryRun ?? false,
        retries: this.retries,
        token,
        gitOps: this.gitOps!,
        log: this.log,
        executor: this.executor,
      });

      // Step 5: Write all config files using FileWriter
      const { fileChanges: fileWriteResults, diffStats } =
        await this.fileWriter.writeFiles(
          repoConfig.files,
          {
            repoInfo,
            baseBranch,
            workDir,
            dryRun: dryRun ?? false,
            noDelete: options.noDelete ?? false,
            configId: options.configId,
          },
          {
            gitOps: this.gitOps!,
            log: this.log,
          }
        );

      // Use FileWriter results directly as the source of truth
      const fileChangesForCommit = fileWriteResults;

      // Step 5c: Handle orphaned file deletion using ManifestManager
      const existingManifest = loadManifest(workDir);

      // Build map of files with their deleteOrphaned setting
      // Include ALL files from config, even skipped ones (createOnly + exists),
      // so they aren't incorrectly treated as orphaned (issue #199)
      const filesWithDeleteOrphaned = new Map<string, boolean | undefined>();
      for (const file of repoConfig.files) {
        filesWithDeleteOrphaned.set(file.fileName, file.deleteOrphaned);
      }

      // Process manifest and get orphans
      const { manifest: newManifest, filesToDelete } =
        this.manifestManager.processOrphans(
          workDir,
          options.configId,
          filesWithDeleteOrphaned
        );

      // Delete orphaned files
      await this.manifestManager.deleteOrphans(
        filesToDelete,
        { dryRun: dryRun ?? false, noDelete: options.noDelete ?? false },
        {
          gitOps: this.gitOps!,
          log: this.log,
          fileChanges: fileChangesForCommit,
        }
      );

      // Increment diff stats for deletions in dry-run mode
      if (dryRun && filesToDelete.length > 0 && !options.noDelete) {
        for (const fileName of filesToDelete) {
          if (this.gitOps!.fileExists(fileName)) {
            incrementDiffStats(diffStats, "DELETED");
          }
        }
      }

      // Save updated manifest
      this.manifestManager.saveUpdatedManifest(
        workDir,
        newManifest,
        existingManifest,
        dryRun ?? false,
        fileChangesForCommit
      );

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
            gitOps: this.gitOps!,
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
   * Gets installation token for GitHub repos when GitHub App is configured.
   * Returns undefined if no token needed or token retrieval fails.
   * Returns null if no installation found (caller should skip repo).
   */
  private async getInstallationToken(
    repoInfo: RepoInfo
  ): Promise<string | null | undefined> {
    if (!this.tokenManager || !isGitHubRepo(repoInfo)) {
      return undefined;
    }

    try {
      return await this.tokenManager.getTokenForRepo(
        repoInfo as GitHubRepoInfo
      );
    } catch (error) {
      this.log.info(
        `Warning: Failed to get GitHub App token: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }

  /**
   * Updates only the manifest file with ruleset tracking.
   * Used by settings command to persist state for deleteOrphaned.
   * Reuses existing clone/commit/PR workflow.
   */
  async updateManifestOnly(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: ProcessorOptions,
    manifestUpdate: { rulesets: string[] }
  ): Promise<ProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { branchName, workDir, dryRun } = options;
    this.retries = options.retries ?? 3;
    this.executor = options.executor ?? defaultExecutor;

    // Get installation token if needed
    const token = await this.getInstallationToken(repoInfo);
    if (token === null) {
      return {
        success: true,
        repoName,
        message: `No GitHub App installation found for ${repoInfo.owner}`,
        skipped: true,
      };
    }

    // Build auth options - use installation token OR fall back to GH_TOKEN for PAT flow
    const effectiveToken =
      token ?? (isGitHubRepo(repoInfo) ? process.env.GH_TOKEN : undefined);
    const authOptions: GitAuthOptions | undefined = effectiveToken
      ? {
          token: effectiveToken,
          host: isGitHubRepo(repoInfo)
            ? (repoInfo as GitHubRepoInfo).host
            : "github.com",
          owner: repoInfo.owner,
          repo: repoInfo.repo,
        }
      : undefined;

    this.gitOps = this.gitOpsFactory(
      {
        workDir,
        dryRun,
        retries: this.retries,
      },
      authOptions
    );

    const mergeMode = repoConfig.prOptions?.merge ?? "auto";
    const isDirectMode = mergeMode === "direct";

    try {
      // Clone repo and get base branch
      this.log.info("Cleaning workspace...");
      this.gitOps.cleanWorkspace();
      this.log.info("Cloning repository...");
      await this.gitOps.clone(repoInfo.gitUrl);
      const { branch: baseBranch } = await this.gitOps.getDefaultBranch();

      // Load and update manifest
      const existingManifest = loadManifest(workDir);
      const rulesetsWithDeleteOrphaned = new Map<string, boolean | undefined>(
        manifestUpdate.rulesets.map((name) => [name, true])
      );
      const { manifest: newManifest } = updateManifestRulesets(
        existingManifest,
        options.configId,
        rulesetsWithDeleteOrphaned
      );

      // Check if manifest changed
      const existingConfigs = existingManifest?.configs ?? {};
      if (
        JSON.stringify(existingConfigs) === JSON.stringify(newManifest.configs)
      ) {
        return {
          success: true,
          repoName,
          message: "No manifest changes detected",
          skipped: true,
        };
      }

      // Dry-run mode: report what would happen
      if (dryRun) {
        this.log.info(`Would update ${MANIFEST_FILENAME} with rulesets`);
        return {
          success: true,
          repoName,
          message: "Would update manifest (dry-run)",
        };
      }

      // Prepare branch for commit using BranchManager
      await this.branchManager.setupBranch({
        repoInfo,
        branchName,
        baseBranch,
        workDir,
        isDirectMode,
        dryRun: false, // Already handled above
        retries: this.retries,
        token,
        gitOps: this.gitOps!,
        log: this.log,
        executor: this.executor,
      });

      // Save manifest and commit
      saveManifest(workDir, newManifest);
      await this.executor.exec("git add -A", workDir);
      if (!(await this.gitOps.hasStagedChanges())) {
        return {
          success: true,
          repoName,
          message: "No changes detected after staging",
          skipped: true,
        };
      }

      const pushBranch = isDirectMode ? baseBranch : branchName;
      const commitStrategy = getCommitStrategy(repoInfo, this.executor);
      try {
        await commitStrategy.commit({
          repoInfo,
          branchName: pushBranch,
          message: "chore: update manifest with ruleset tracking",
          fileChanges: [
            {
              path: MANIFEST_FILENAME,
              content: JSON.stringify(newManifest, null, 2) + "\n",
            },
          ],
          workDir,
          retries: this.retries,
          force: !isDirectMode,
          token,
          gitOps: this.gitOps!,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (
          isDirectMode &&
          (msg.includes("rejected") ||
            msg.includes("protected") ||
            msg.includes("denied"))
        ) {
          return {
            success: false,
            repoName,
            message: `Push to '${baseBranch}' was rejected (likely branch protection).`,
          };
        }
        throw error;
      }

      if (isDirectMode) {
        return {
          success: true,
          repoName,
          message: `Manifest updated directly on ${baseBranch}`,
        };
      }

      // Create PR and handle merge
      const prResult = await createPR({
        repoInfo,
        branchName,
        baseBranch,
        files: [{ fileName: MANIFEST_FILENAME, action: "update" as const }],
        workDir,
        dryRun: false,
        retries: this.retries,
        executor: this.executor,
        token,
      });

      if (prResult.success && prResult.url && mergeMode !== "manual") {
        await mergePR({
          repoInfo,
          prUrl: prResult.url,
          mergeConfig: {
            mode: mergeMode,
            strategy: repoConfig.prOptions?.mergeStrategy ?? "squash",
            deleteBranch: repoConfig.prOptions?.deleteBranch ?? true,
          },
          workDir,
          dryRun: false,
          retries: this.retries,
          executor: this.executor,
          token,
        });
      }

      return {
        success: prResult.success,
        repoName,
        message: prResult.message,
        prUrl: prResult.url,
      };
    } finally {
      if (this.gitOps) {
        try {
          this.gitOps.cleanWorkspace();
        } catch {
          // Ignore cleanup errors
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
