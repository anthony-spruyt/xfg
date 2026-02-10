import { RepoConfig } from "../config/index.js";
import { RepoInfo, getRepoDisplayName } from "../shared/repo-detector.js";
import { GitOps } from "../vcs/git-ops.js";
import { AuthenticatedGitOps } from "../vcs/authenticated-git-ops.js";
import { logger, ILogger } from "../shared/logger.js";
import { hasGitHubAppCredentials } from "../vcs/index.js";
import { defaultExecutor } from "../shared/command-executor.js";
import {
  loadManifest,
  saveManifest,
  updateManifestRulesets,
  MANIFEST_FILENAME,
} from "./manifest.js";
import { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";
import { formatCommitMessage } from "./commit-message.js";
import {
  FileWriter,
  ManifestManager,
  BranchManager,
  AuthOptionsBuilder,
  RepositorySession,
  CommitPushManager,
  FileSyncOrchestrator,
  PRMergeHandler,
  type IFileWriter,
  type IManifestManager,
  type IBranchManager,
  type IAuthOptionsBuilder,
  type IRepositorySession,
  type ICommitPushManager,
  type IFileSyncOrchestrator,
  type IPRMergeHandler,
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
  private readonly fileSyncOrchestrator: IFileSyncOrchestrator;
  private readonly prMergeHandler: IPRMergeHandler;

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
      fileSyncOrchestrator?: IFileSyncOrchestrator;
      prMergeHandler?: IPRMergeHandler;
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
    this.fileSyncOrchestrator =
      components?.fileSyncOrchestrator ??
      new FileSyncOrchestrator(
        this.fileWriter,
        this.manifestManager,
        logInstance
      );
    this.prMergeHandler =
      components?.prMergeHandler ?? new PRMergeHandler(logInstance);
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
        await this.fileSyncOrchestrator.sync(
          repoConfig,
          repoInfo,
          session,
          options
        );

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
      const commitMessage = formatCommitMessage(changedFiles);
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
      return await this.prMergeHandler.createAndMerge(
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
      return await this.prMergeHandler.createAndMerge(
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
}
