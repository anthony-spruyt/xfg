import { join } from "node:path";
import { rm } from "node:fs/promises";
import { parseGitUrl, type RepoInfo } from "../shared/repo-detector.js";
import { logger } from "../shared/logger.js";
import type { RepoConfig } from "../config/types.js";
import type {
  IRepoLifecycleManager,
  IRepoLifecycleProvider,
  IRepoLifecycleFactory,
  LifecycleResult,
  LifecycleOptions,
  CreateRepoSettings,
} from "./types.js";
import { RepoLifecycleFactory } from "./repo-lifecycle-factory.js";

/**
 * Orchestrates repo lifecycle operations before sync.
 */
export class RepoLifecycleManager implements IRepoLifecycleManager {
  private readonly factory: IRepoLifecycleFactory;

  constructor(factory?: IRepoLifecycleFactory, retries?: number) {
    this.factory = factory ?? new RepoLifecycleFactory(undefined, retries);
  }

  async ensureRepo(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: LifecycleOptions,
    settings?: CreateRepoSettings
  ): Promise<LifecycleResult> {
    let provider: IRepoLifecycleProvider;
    try {
      provider = this.factory.getProvider(repoInfo.type);
    } catch (error) {
      // If user explicitly configured lifecycle (upstream/source), propagate the error
      if (repoConfig.upstream || repoConfig.source) {
        throw error;
      }
      // Platform doesn't support lifecycle operations yet - skip silently
      return { repoInfo, action: "existed" };
    }

    const { token } = options;

    // Check if repo exists
    const exists = await provider.exists(repoInfo, token);

    if (exists) {
      // Repo exists - nothing to do (ignore upstream/source)
      return {
        repoInfo,
        action: "existed",
      };
    }

    // Repo doesn't exist - determine what action to take
    if (repoConfig.source) {
      // Migration mode
      return this.migrate(repoConfig, repoInfo, options, settings);
    }

    if (repoConfig.upstream) {
      // Fork mode
      return this.fork(repoConfig, repoInfo, provider, options, settings);
    }

    // Create mode (no upstream or source)
    return this.create(repoInfo, provider, options, settings);
  }

  private async create(
    repoInfo: RepoInfo,
    provider: IRepoLifecycleProvider,
    options: LifecycleOptions,
    settings?: CreateRepoSettings
  ): Promise<LifecycleResult> {
    if (options.dryRun) {
      return {
        repoInfo,
        action: "created",
        skipped: true,
      };
    }

    await provider.create(repoInfo, settings, options.token);
    await this.waitForRepoReady(provider, repoInfo, options.token);

    return {
      repoInfo,
      action: "created",
    };
  }

  private async fork(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    provider: IRepoLifecycleProvider,
    options: LifecycleOptions,
    settings?: CreateRepoSettings
  ): Promise<LifecycleResult> {
    if (options.dryRun) {
      return {
        repoInfo,
        action: "forked",
        skipped: true,
      };
    }

    if (!provider.fork) {
      throw new Error(`Platform '${repoInfo.type}' does not support forking`);
    }

    // Parse upstream URL to get repo info
    const upstreamInfo = parseGitUrl(repoConfig.upstream!, {
      githubHosts: options.githubHosts,
    });
    await provider.fork(upstreamInfo, repoInfo, settings, options.token);
    await this.waitForRepoReady(provider, repoInfo, options.token);

    return {
      repoInfo,
      action: "forked",
    };
  }

  private async migrate(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: LifecycleOptions,
    settings?: CreateRepoSettings
  ): Promise<LifecycleResult> {
    if (options.dryRun) {
      return {
        repoInfo,
        action: "migrated",
        skipped: true,
      };
    }

    // Parse source URL to get platform and repo info
    const sourceInfo = parseGitUrl(repoConfig.source!, {
      githubHosts: options.githubHosts,
    });
    const source = this.factory.getMigrationSource(sourceInfo.type);

    // Clone source repo to temp directory
    const sourceDir = join(options.workDir, "migration-source");

    try {
      await source.cloneForMigration(sourceInfo, sourceDir);

      // Create target and push content
      const provider = this.factory.getProvider(repoInfo.type);
      await provider.receiveMigration(
        repoInfo,
        sourceDir,
        settings,
        options.token
      );
      await this.waitForRepoReady(provider, repoInfo, options.token);

      return {
        repoInfo,
        action: "migrated",
      };
    } finally {
      // Clean up migration source directory
      try {
        await rm(sourceDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Log cleanup errors at debug level for troubleshooting
        logger.debug(
          `Failed to clean up migration source directory ${sourceDir}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        );
      }
    }
  }

  /**
   * Polls provider.exists() until the repo is visible, with timeout.
   * GitHub's API may return success from create/fork before the git
   * backend has fully propagated, causing subsequent clone to 403.
   */
  private async waitForRepoReady(
    provider: IRepoLifecycleProvider,
    repoInfo: RepoInfo,
    token?: string,
    timeoutMs = 15000,
    pollMs = 1000
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await provider.exists(repoInfo, token)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    // Timed out — proceed anyway and let downstream operations handle it
    logger.info(
      `Repo ${repoInfo.owner}/${repoInfo.repo} not yet visible after ${timeoutMs}ms, proceeding`
    );
  }
}
