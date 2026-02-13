import type { RepoInfo } from "../shared/repo-detector.js";
import type { RepoConfig } from "../config/types.js";

/**
 * Supported platforms for lifecycle operations.
 */
export type LifecyclePlatform = "github" | "azure-devops" | "gitlab";

/**
 * Result of a lifecycle operation.
 */
export interface LifecycleResult {
  /** The repo info (may be updated) */
  repoInfo: RepoInfo;
  /** What action was taken */
  action: "existed" | "created" | "forked" | "migrated";
  /** True if skipped due to dry-run */
  skipped?: boolean;
}

/**
 * Options for lifecycle operations.
 */
export interface LifecycleOptions {
  /** Dry-run mode - don't make changes */
  dryRun: boolean;
  /** Working directory for git operations */
  workDir: string;
  /** GitHub Enterprise hostnames for URL detection */
  githubHosts?: string[];
  /** Auth token (GitHub App installation token or PAT) for gh CLI commands */
  token?: string;
}

/**
 * Repo settings to apply when creating a new repo.
 * Subset of GitHubRepoSettings that makes sense for creation.
 */
export interface CreateRepoSettings {
  visibility?: "public" | "private" | "internal";
  description?: string;
  hasIssues?: boolean;
  hasWiki?: boolean;
}

/**
 * Provider for platform-specific lifecycle operations.
 * Implementations handle create/fork/receive for a specific platform.
 */
export interface IRepoLifecycleProvider {
  /** Platform this provider handles */
  readonly platform: LifecyclePlatform;

  /**
   * Check if a repository exists on this platform.
   * @throws Error on network/auth failures (NOT for "repo not found")
   */
  exists(repoInfo: RepoInfo, token?: string): Promise<boolean>;

  /**
   * Create an empty repository.
   */
  create(
    repoInfo: RepoInfo,
    settings?: CreateRepoSettings,
    token?: string
  ): Promise<void>;

  /**
   * Fork from an upstream repository.
   * Optional - not all platforms support forking.
   */
  fork?(
    upstream: RepoInfo,
    target: RepoInfo,
    settings?: CreateRepoSettings,
    token?: string
  ): Promise<void>;

  /**
   * Receive migrated content (repo already created, push content).
   */
  receiveMigration(
    repoInfo: RepoInfo,
    sourceDir: string,
    settings?: CreateRepoSettings,
    token?: string
  ): Promise<void>;
}

/**
 * Source for migration operations.
 * Implementations handle cloning from a source platform.
 */
export interface IMigrationSource {
  /** Platform this source handles */
  readonly platform: LifecyclePlatform;

  /**
   * Clone repository with all refs for migration.
   * Uses --mirror to get all branches/tags.
   */
  cloneForMigration(repoInfo: RepoInfo, workDir: string): Promise<void>;
}

/**
 * Factory for getting providers by platform.
 */
export interface IRepoLifecycleFactory {
  /**
   * Get lifecycle provider for a platform.
   * @throws Error if platform not supported as target
   */
  getProvider(platform: LifecyclePlatform): IRepoLifecycleProvider;

  /**
   * Get migration source for a platform.
   * @throws Error if platform not supported as source
   */
  getMigrationSource(platform: LifecyclePlatform): IMigrationSource;
}

/**
 * Manager that orchestrates lifecycle operations before sync.
 */
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
