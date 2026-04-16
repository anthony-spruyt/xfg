import type { RepoInfo, RepoPlatform } from "../repo/index.js";
import type { RepoConfig, RepoVisibility } from "../config/index.js";

export type LifecyclePlatform = RepoPlatform;

export interface LifecycleResult {
  repoInfo: RepoInfo;
  action: "existed" | "created" | "forked" | "migrated";
  skipped?: boolean;
}

export type LifecycleActionKind = LifecycleResult["action"];

export interface LifecycleOptions {
  dryRun: boolean;
  workDir: string;
  githubHosts?: string[];
  /** Auth token (GitHub App installation token or PAT) for gh CLI commands */
  token?: string;
}

/**
 * Repo settings to apply when creating a new repo.
 * Subset of GitHubRepoSettings that makes sense for creation.
 */
export interface CreateRepoSettings {
  visibility?: RepoVisibility;
  description?: string;
  hasIssues?: boolean;
  hasWiki?: boolean;
  defaultBranch?: string;
}

export interface LifecycleExistsParams {
  repo: RepoInfo;
  token?: string;
}

export interface LifecycleCreateParams {
  repo: RepoInfo;
  settings?: CreateRepoSettings;
  token?: string;
}

export interface LifecycleForkParams {
  upstream: RepoInfo;
  target: RepoInfo;
  settings?: CreateRepoSettings;
  token?: string;
}

export interface LifecycleReceiveMigrationParams {
  repo: RepoInfo;
  sourceDir: string;
  settings?: CreateRepoSettings;
  token?: string;
}

/**
 * Provider for platform-specific lifecycle operations.
 * Implementations handle create/fork/receive for a specific platform.
 */
export interface IRepoLifecycleProvider {
  readonly platform: LifecyclePlatform;

  /**
   * Check if a repository exists on this platform.
   * @throws LifecycleError on network/auth failures (NOT for "repo not found")
   */
  exists(params: LifecycleExistsParams): Promise<boolean>;

  /**
   * Create an empty repository.
   */
  create(params: LifecycleCreateParams): Promise<void>;

  /**
   * Fork from an upstream repository.
   * Optional - not all platforms support forking.
   */
  fork?(params: LifecycleForkParams): Promise<void>;

  /**
   * Receive migrated content (repo already created, push content).
   */
  receiveMigration(params: LifecycleReceiveMigrationParams): Promise<void>;
}

/**
 * Source for migration operations.
 * Implementations handle cloning from a source platform.
 */
export interface IMigrationSource {
  readonly platform: LifecyclePlatform;

  /**
   * Clone repository with all refs for migration.
   * Uses --mirror to get all branches/tags.
   */
  cloneForMigration(repoInfo: RepoInfo, workDir: string): Promise<void>;
}

export interface IRepoLifecycleFactory {
  /**
   * Get lifecycle provider for a platform.
   * @throws LifecycleError if platform not supported as target
   */
  getProvider(platform: LifecyclePlatform): IRepoLifecycleProvider;

  /**
   * Get migration source for a platform.
   * @throws LifecycleError if platform not supported as source
   */
  getMigrationSource(platform: LifecyclePlatform): IMigrationSource;
}

export interface IRepoLifecycleManager {
  /**
   * Ensure repository exists, creating/forking/migrating if needed.
   * Call this before sync/settings operations.
   */
  ensureRepo(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: LifecycleOptions,
    settings?: CreateRepoSettings
  ): Promise<LifecycleResult>;
}
