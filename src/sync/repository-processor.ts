import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import { GitOps } from "../vcs/git-ops.js";
import { AuthenticatedGitOps } from "../vcs/authenticated-git-ops.js";
import { logger, ILogger } from "../shared/logger.js";
import { hasGitHubAppCredentials } from "../vcs/index.js";
import { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";
import {
  FileWriter,
  ManifestManager,
  BranchManager,
  AuthOptionsBuilder,
  RepositorySession,
  CommitPushManager,
  FileSyncOrchestrator,
  PRMergeHandler,
  FileSyncStrategy,
  ManifestStrategy,
  SyncWorkflow,
  loadManifest,
  updateManifestRulesets,
  MANIFEST_FILENAME,
  type IFileWriter,
  type IManifestManager,
  type IBranchManager,
  type IAuthOptionsBuilder,
  type IRepositorySession,
  type ICommitPushManager,
  type IFileSyncOrchestrator,
  type IPRMergeHandler,
  type ISyncWorkflow,
  type IRepositoryProcessor,
  type GitOpsFactory,
  type ProcessorOptions,
  type ProcessorResult,
  type FileChangeDetail,
} from "./index.js";
import { getRepoDisplayName } from "../shared/repo-detector.js";

/**
 * Thin facade that delegates to SyncWorkflow with appropriate strategy.
 * process() uses FileSyncStrategy, updateManifestOnly() uses ManifestStrategy.
 */
export class RepositoryProcessor implements IRepositoryProcessor {
  private readonly syncWorkflow: ISyncWorkflow;
  private readonly fileSyncOrchestrator: IFileSyncOrchestrator;
  private readonly log: ILogger;

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
      syncWorkflow?: ISyncWorkflow;
    }
  ) {
    const factory =
      gitOpsFactory ??
      ((opts, auth) => new AuthenticatedGitOps(new GitOps(opts), auth));
    const logInstance = log ?? logger;
    this.log = logInstance;

    // Initialize token manager for auth builder
    const tokenManager = hasGitHubAppCredentials()
      ? new GitHubAppTokenManager(
          process.env.XFG_GITHUB_APP_ID!,
          process.env.XFG_GITHUB_APP_PRIVATE_KEY!
        )
      : null;

    const fileWriter = components?.fileWriter ?? new FileWriter();
    const manifestManager =
      components?.manifestManager ?? new ManifestManager();
    const branchManager = components?.branchManager ?? new BranchManager();
    const authOptionsBuilder =
      components?.authOptionsBuilder ??
      new AuthOptionsBuilder(tokenManager, logInstance);
    const repositorySession =
      components?.repositorySession ??
      new RepositorySession(factory, logInstance);
    const commitPushManager =
      components?.commitPushManager ?? new CommitPushManager(logInstance);
    const prMergeHandler =
      components?.prMergeHandler ?? new PRMergeHandler(logInstance);

    this.fileSyncOrchestrator =
      components?.fileSyncOrchestrator ??
      new FileSyncOrchestrator(fileWriter, manifestManager, logInstance);

    this.syncWorkflow =
      components?.syncWorkflow ??
      new SyncWorkflow(
        authOptionsBuilder,
        repositorySession,
        branchManager,
        commitPushManager,
        prMergeHandler,
        logInstance
      );
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult> {
    const strategy = new FileSyncStrategy(this.fileSyncOrchestrator);
    return this.syncWorkflow.execute(repoConfig, repoInfo, options, strategy);
  }

  async updateManifestOnly(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: ProcessorOptions,
    manifestUpdate: { rulesets: string[] }
  ): Promise<ProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { workDir, dryRun } = options;

    // Pre-check manifest changes (preserves original early-return behavior)
    const existingManifest = loadManifest(workDir);
    const rulesetsWithDeleteOrphaned = new Map<string, boolean | undefined>(
      manifestUpdate.rulesets.map((name) => [name, true])
    );
    const { manifest: newManifest } = updateManifestRulesets(
      existingManifest,
      options.configId,
      rulesetsWithDeleteOrphaned
    );

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

    const manifestFileChange: FileChangeDetail[] = [
      { path: MANIFEST_FILENAME, action: "update" },
    ];

    if (dryRun) {
      this.log.info(`Would update ${MANIFEST_FILENAME} with rulesets`);
      return {
        success: true,
        repoName,
        message: "Would update manifest (dry-run)",
        fileChanges: manifestFileChange,
      };
    }

    // Delegate to workflow for actual commit/push/PR
    const strategy = new ManifestStrategy(manifestUpdate, this.log);
    return this.syncWorkflow.execute(repoConfig, repoInfo, options, strategy);
  }
}
