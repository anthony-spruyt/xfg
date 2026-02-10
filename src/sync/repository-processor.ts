import { RepoConfig } from "../config/index.js";
import { RepoInfo, getRepoDisplayName } from "../shared/repo-detector.js";
import { GitOps } from "../vcs/git-ops.js";
import { AuthenticatedGitOps } from "../vcs/authenticated-git-ops.js";
import { createPR, mergePR, PRResult, FileAction } from "../vcs/pr-creator.js";
import { logger, ILogger } from "../shared/logger.js";
import { hasGitHubAppCredentials } from "../vcs/index.js";
import type { PRMergeConfig } from "../vcs/index.js";
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
import { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";
import {
  FileWriter,
  ManifestManager,
  BranchManager,
  AuthOptionsBuilder,
  RepositorySession,
  CommitPushManager,
  type IFileWriter,
  type IManifestManager,
  type IBranchManager,
  type IAuthOptionsBuilder,
  type IRepositorySession,
  type ICommitPushManager,
  type IRepositoryProcessor,
  type FileWriteResult,
  type SessionContext,
  type GitOpsFactory,
  type ProcessorOptions,
  type ProcessorResult,
} from "./index.js";

export class RepositoryProcessor implements IRepositoryProcessor {
  private readonly gitOpsFactory: GitOpsFactory;
  private readonly log: ILogger;
  private readonly authOptionsBuilder: IAuthOptionsBuilder;
  private readonly repositorySession: IRepositorySession;
  private readonly commitPushManager: ICommitPushManager;
  private readonly fileWriter: IFileWriter;
  private readonly manifestManager: IManifestManager;
  private readonly branchManager: IBranchManager;

  constructor(
    gitOpsFactory?: GitOpsFactory,
    log?: ILogger,
    components?: {
      fileWriter?: IFileWriter;
      manifestManager?: IManifestManager;
      branchManager?: IBranchManager;
      authOptionsBuilder?: IAuthOptionsBuilder;
      repositorySession?: IRepositorySession;
      commitPushManager?: ICommitPushManager;
    }
  ) {
    const factory =
      gitOpsFactory ??
      ((opts, auth) => new AuthenticatedGitOps(new GitOps(opts), auth));
    const logInstance = log ?? logger;

    this.gitOpsFactory = factory;
    this.log = logInstance;
    this.fileWriter = components?.fileWriter ?? new FileWriter();
    this.manifestManager = components?.manifestManager ?? new ManifestManager();
    this.branchManager = components?.branchManager ?? new BranchManager();

    // Initialize token manager for auth builder
    const tokenManager = hasGitHubAppCredentials()
      ? new GitHubAppTokenManager(
          process.env.XFG_GITHUB_APP_ID!,
          process.env.XFG_GITHUB_APP_PRIVATE_KEY!
        )
      : null;

    this.authOptionsBuilder =
      components?.authOptionsBuilder ??
      new AuthOptionsBuilder(tokenManager, logInstance);
    this.repositorySession =
      components?.repositorySession ??
      new RepositorySession(factory, logInstance);
    this.commitPushManager =
      components?.commitPushManager ?? new CommitPushManager(logInstance);
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { branchName, workDir, dryRun, prTemplate } = options;
    const retries = options.retries ?? 3;
    const executor = options.executor ?? defaultExecutor;

    // Resolve auth
    const authResult = await this.authOptionsBuilder.resolve(
      repoInfo,
      repoName
    );
    if (authResult.skipResult) {
      return authResult.skipResult;
    }

    // Determine merge mode
    const mergeMode = repoConfig.prOptions?.merge ?? "auto";
    const isDirectMode = mergeMode === "direct";

    if (isDirectMode && repoConfig.prOptions?.mergeStrategy) {
      this.log.info(
        `Warning: mergeStrategy '${repoConfig.prOptions.mergeStrategy}' is ignored in direct mode`
      );
    }

    let session: SessionContext | null = null;
    try {
      // Setup workspace
      session = await this.repositorySession.setup(repoInfo, {
        workDir,
        dryRun: dryRun ?? false,
        retries,
        authOptions: authResult.authOptions,
      });

      // Setup branch
      await this.branchManager.setupBranch({
        repoInfo,
        branchName,
        baseBranch: session.baseBranch,
        workDir,
        isDirectMode,
        dryRun: dryRun ?? false,
        retries,
        token: authResult.token,
        gitOps: session.gitOps,
        log: this.log,
        executor,
      });

      // Process files and manifest
      const { fileChanges, diffStats, changedFiles, hasChanges } =
        await this.processFiles(repoConfig, repoInfo, session, options);

      if (!hasChanges) {
        return {
          success: true,
          repoName,
          message: "No changes detected",
          skipped: true,
          diffStats,
        };
      }

      // Commit and push
      const commitMessage = this.formatCommitMessage(changedFiles);
      const pushBranch = isDirectMode ? session.baseBranch : branchName;

      const commitResult = await this.commitPushManager.commitAndPush(
        {
          repoInfo,
          gitOps: session.gitOps,
          workDir,
          fileChanges,
          commitMessage,
          pushBranch,
          isDirectMode,
          dryRun: dryRun ?? false,
          retries,
          token: authResult.token,
          executor,
        },
        repoName
      );

      if (!commitResult.success && commitResult.errorResult) {
        return commitResult.errorResult;
      }

      if (commitResult.skipped) {
        return {
          success: true,
          repoName,
          message: "No changes detected after staging",
          skipped: true,
          diffStats,
        };
      }

      // Direct mode: no PR
      if (isDirectMode) {
        this.log.info(`Changes pushed directly to ${session.baseBranch}`);
        return {
          success: true,
          repoName,
          message: `Pushed directly to ${session.baseBranch}`,
          diffStats,
        };
      }

      // Create and merge PR
      return await this.createAndMergePR(
        repoInfo,
        repoConfig,
        {
          branchName,
          baseBranch: session.baseBranch,
          workDir,
          dryRun: dryRun ?? false,
          retries,
          prTemplate,
          token: authResult.token,
          executor,
        },
        changedFiles,
        repoName,
        diffStats
      );
    } finally {
      try {
        session?.cleanup();
      } catch {
        // Ignore cleanup errors - best effort
      }
    }
  }

  async updateManifestOnly(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: ProcessorOptions,
    manifestUpdate: { rulesets: string[] }
  ): Promise<ProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { branchName, workDir, dryRun } = options;
    const retries = options.retries ?? 3;
    const executor = options.executor ?? defaultExecutor;

    // Resolve auth
    const authResult = await this.authOptionsBuilder.resolve(
      repoInfo,
      repoName
    );
    if (authResult.skipResult) {
      return authResult.skipResult;
    }

    const mergeMode = repoConfig.prOptions?.merge ?? "auto";
    const isDirectMode = mergeMode === "direct";

    let session: SessionContext | null = null;
    try {
      // Setup workspace
      session = await this.repositorySession.setup(repoInfo, {
        workDir,
        dryRun: dryRun ?? false,
        retries,
        authOptions: authResult.authOptions,
      });

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

      // Check if changed
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

      if (dryRun) {
        this.log.info(`Would update ${MANIFEST_FILENAME} with rulesets`);
        return {
          success: true,
          repoName,
          message: "Would update manifest (dry-run)",
        };
      }

      // Setup branch and commit
      await this.branchManager.setupBranch({
        repoInfo,
        branchName,
        baseBranch: session.baseBranch,
        workDir,
        isDirectMode,
        dryRun: false,
        retries,
        token: authResult.token,
        gitOps: session.gitOps,
        log: this.log,
        executor,
      });

      saveManifest(workDir, newManifest);

      const fileChanges = new Map<string, FileWriteResult>([
        [
          MANIFEST_FILENAME,
          {
            fileName: MANIFEST_FILENAME,
            content: JSON.stringify(newManifest, null, 2) + "\n",
            action: "update",
          },
        ],
      ]);

      const pushBranch = isDirectMode ? session.baseBranch : branchName;
      const commitResult = await this.commitPushManager.commitAndPush(
        {
          repoInfo,
          gitOps: session.gitOps,
          workDir,
          fileChanges,
          commitMessage: "chore: update manifest with ruleset tracking",
          pushBranch,
          isDirectMode,
          dryRun: false,
          retries,
          token: authResult.token,
          executor,
        },
        repoName
      );

      if (!commitResult.success && commitResult.errorResult) {
        return commitResult.errorResult;
      }

      if (commitResult.skipped) {
        return {
          success: true,
          repoName,
          message: "No changes detected after staging",
          skipped: true,
        };
      }

      if (isDirectMode) {
        return {
          success: true,
          repoName,
          message: `Manifest updated directly on ${session.baseBranch}`,
        };
      }

      // Create and merge PR
      return await this.createAndMergePR(
        repoInfo,
        repoConfig,
        {
          branchName,
          baseBranch: session.baseBranch,
          workDir,
          dryRun: false,
          retries,
          token: authResult.token,
          executor,
        },
        [{ fileName: MANIFEST_FILENAME, action: "update" as const }],
        repoName
      );
    } finally {
      try {
        session?.cleanup();
      } catch {
        // Ignore cleanup errors - best effort
      }
    }
  }

  private async processFiles(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    session: SessionContext,
    options: ProcessorOptions
  ): Promise<{
    fileChanges: Map<string, FileWriteResult>;
    diffStats: DiffStats;
    changedFiles: FileAction[];
    hasChanges: boolean;
  }> {
    const { workDir, dryRun, noDelete, configId } = options;

    // Write files
    const { fileChanges, diffStats } = await this.fileWriter.writeFiles(
      repoConfig.files,
      {
        repoInfo,
        baseBranch: session.baseBranch,
        workDir,
        dryRun: dryRun ?? false,
        noDelete: noDelete ?? false,
        configId,
      },
      { gitOps: session.gitOps, log: this.log }
    );

    // Handle orphans
    const existingManifest = loadManifest(workDir);
    const filesWithDeleteOrphaned = new Map<string, boolean | undefined>(
      repoConfig.files.map((f) => [f.fileName, f.deleteOrphaned])
    );

    const { manifest: newManifest, filesToDelete } =
      this.manifestManager.processOrphans(
        workDir,
        configId,
        filesWithDeleteOrphaned
      );

    await this.manifestManager.deleteOrphans(
      filesToDelete,
      { dryRun: dryRun ?? false, noDelete: noDelete ?? false },
      { gitOps: session.gitOps, log: this.log, fileChanges }
    );

    // Update diff stats for deletions in dry-run
    if (dryRun && filesToDelete.length > 0 && !noDelete) {
      for (const fileName of filesToDelete) {
        if (session.gitOps.fileExists(fileName)) {
          incrementDiffStats(diffStats, "DELETED");
        }
      }
    }

    // Save manifest
    this.manifestManager.saveUpdatedManifest(
      workDir,
      newManifest,
      existingManifest,
      dryRun ?? false,
      fileChanges
    );

    // Show diff summary in dry-run
    if (dryRun) {
      this.log.diffSummary(
        diffStats.newCount,
        diffStats.modifiedCount,
        diffStats.unchangedCount,
        diffStats.deletedCount
      );
    }

    // Build changed files list
    const changedFiles: FileAction[] = Array.from(fileChanges.entries()).map(
      ([fileName, info]) => ({ fileName, action: info.action })
    );

    // Calculate diff stats for non-dry-run
    if (!dryRun) {
      for (const [, info] of fileChanges) {
        if (info.action === "create") incrementDiffStats(diffStats, "NEW");
        else if (info.action === "update")
          incrementDiffStats(diffStats, "MODIFIED");
        else if (info.action === "delete")
          incrementDiffStats(diffStats, "DELETED");
      }
    }

    const hasChanges = changedFiles.some((f) => f.action !== "skip");

    return { fileChanges, diffStats, changedFiles, hasChanges };
  }

  private async createAndMergePR(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: {
      branchName: string;
      baseBranch: string;
      workDir: string;
      dryRun: boolean;
      retries: number;
      prTemplate?: string;
      token?: string;
      executor: ICommandExecutor;
    },
    changedFiles: FileAction[],
    repoName: string,
    diffStats?: DiffStats
  ): Promise<ProcessorResult> {
    this.log.info("Creating pull request...");
    const prResult: PRResult = await createPR({
      repoInfo,
      branchName: options.branchName,
      baseBranch: options.baseBranch,
      files: changedFiles,
      workDir: options.workDir,
      dryRun: options.dryRun,
      retries: options.retries,
      prTemplate: options.prTemplate,
      executor: options.executor,
      token: options.token,
    });

    const mergeMode = repoConfig.prOptions?.merge ?? "auto";
    let mergeResult: ProcessorResult["mergeResult"];

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
        workDir: options.workDir,
        dryRun: options.dryRun,
        retries: options.retries,
        executor: options.executor,
        token: options.token,
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
  }

  private formatCommitMessage(files: FileAction[]): string {
    const changedFiles = files.filter((f) => f.action !== "skip");
    const deletedFiles = changedFiles.filter((f) => f.action === "delete");
    const syncedFiles = changedFiles.filter((f) => f.action !== "delete");

    if (syncedFiles.length === 0 && deletedFiles.length > 0) {
      if (deletedFiles.length === 1) {
        return `chore: remove ${deletedFiles[0].fileName}`;
      }
      return `chore: remove ${deletedFiles.length} orphaned config files`;
    }

    if (changedFiles.length === 1) {
      return `chore: sync ${changedFiles[0].fileName}`;
    }

    if (changedFiles.length <= 3) {
      return `chore: sync ${changedFiles.map((f) => f.fileName).join(", ")}`;
    }

    return `chore: sync ${changedFiles.length} config files`;
  }
}
