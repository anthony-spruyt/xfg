import { escapeShellArg } from "../shared/shell-utils.js";
import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import { withRetry } from "../shared/retry-utils.js";
import {
  isGitHubRepo,
  type RepoInfo,
  type GitHubRepoInfo,
} from "../shared/repo-detector.js";
import { logger } from "../shared/logger.js";
import type {
  IRepoLifecycleProvider,
  LifecyclePlatform,
  CreateRepoSettings,
} from "./types.js";

/**
 * Error messages that indicate "repo not found" vs actual errors.
 */
const REPO_NOT_FOUND_PATTERNS = [
  "Could not resolve to a Repository",
  "Not Found",
  "404",
];

/**
 * Check if an error indicates repo not found (vs network/auth error).
 */
function isRepoNotFoundError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message + ((error as Error & { stderr?: string }).stderr ?? "")
      : String(error);
  return REPO_NOT_FOUND_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Get the hostname flag for gh commands.
 * Returns "--hostname HOST" for GHE, empty string for github.com.
 */
function getHostnameFlag(repoInfo: GitHubRepoInfo): string {
  if (repoInfo.host && repoInfo.host !== "github.com") {
    return `--hostname ${escapeShellArg(repoInfo.host)}`;
  }
  return "";
}

/**
 * Default timeout for waiting for fork readiness (60 seconds).
 */
const FORK_READY_TIMEOUT_MS = 60_000;

/**
 * Interval between fork readiness checks (2 seconds).
 */
const FORK_POLL_INTERVAL_MS = 2_000;

/**
 * GitHub implementation of IRepoLifecycleProvider.
 * Uses gh CLI for all operations.
 */
export interface GitHubLifecycleProviderOptions {
  executor?: ICommandExecutor;
  retries?: number;
  cwd?: string;
  /** Timeout in ms for waiting for fork readiness (default: 60000) */
  forkReadyTimeoutMs?: number;
  /** Poll interval in ms for fork readiness checks (default: 2000) */
  forkPollIntervalMs?: number;
}

export class GitHubLifecycleProvider implements IRepoLifecycleProvider {
  readonly platform: LifecyclePlatform = "github";
  private readonly executor: ICommandExecutor;
  private readonly retries: number;
  private readonly cwd: string;
  private readonly forkReadyTimeoutMs: number;
  private readonly forkPollIntervalMs: number;

  constructor(options?: GitHubLifecycleProviderOptions) {
    const opts = options ?? {};
    this.executor = opts.executor ?? defaultExecutor;
    this.retries = opts.retries ?? 3;
    this.cwd = opts.cwd ?? process.cwd();
    this.forkReadyTimeoutMs = opts.forkReadyTimeoutMs ?? FORK_READY_TIMEOUT_MS;
    this.forkPollIntervalMs = opts.forkPollIntervalMs ?? FORK_POLL_INTERVAL_MS;
  }

  /**
   * Check if a GitHub owner is an organization (vs user).
   * Uses gh api to query the user/org endpoint.
   */
  private async isOrganization(
    owner: string,
    repoInfo: GitHubRepoInfo,
    token?: string
  ): Promise<boolean> {
    const tokenPrefix = this.buildTokenPrefix(token);
    const hostnameFlag = getHostnameFlag(repoInfo);
    const hostnamePart = hostnameFlag ? `${hostnameFlag} ` : "";
    const command = `${tokenPrefix}gh api ${hostnamePart}users/${escapeShellArg(owner)}`;

    try {
      const stdout = await withRetry(
        () => this.executor.exec(command, this.cwd),
        { retries: this.retries }
      );
      const data = JSON.parse(stdout);
      return data.type === "Organization";
    } catch (error) {
      // If we can't determine, assume it's an org (safer - uses --org flag).
      // This may cause fork to fail with a misleading error for personal accounts.
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.debug(
        `Could not determine if '${owner}' is an organization, defaulting to org behavior: ${errMsg}`
      );
      logger.info(
        `Warning: Could not verify if '${owner}' is an organization or user account. ` +
          `If fork fails, check your authentication (gh auth status) and ensure the ` +
          `target owner is correct.`
      );
      return true;
    }
  }

  private assertGitHub(repoInfo: RepoInfo): asserts repoInfo is GitHubRepoInfo {
    if (!isGitHubRepo(repoInfo)) {
      throw new Error(
        `GitHubLifecycleProvider requires GitHub repo, got: ${repoInfo.type}`
      );
    }
  }

  /**
   * Build GH_TOKEN prefix for gh CLI commands.
   * Returns "GH_TOKEN=<escaped_token> " when token is provided, "" otherwise.
   * Token is escaped via escapeShellArg to prevent injection.
   */
  private buildTokenPrefix(token?: string): string {
    return token ? `GH_TOKEN=${escapeShellArg(token)} ` : "";
  }

  async exists(repoInfo: RepoInfo, token?: string): Promise<boolean> {
    this.assertGitHub(repoInfo);

    const tokenPrefix = this.buildTokenPrefix(token);
    const hostnameFlag = getHostnameFlag(repoInfo);
    const hostnamePart = hostnameFlag ? `${hostnameFlag} ` : "";
    const command = `${tokenPrefix}gh api ${hostnamePart}repos/${escapeShellArg(repoInfo.owner)}/${escapeShellArg(repoInfo.repo)}`;

    try {
      // Note: withRetry already classifies 404/not-found as permanent errors,
      // so retries are aborted immediately for non-existent repos.
      await withRetry(() => this.executor.exec(command, this.cwd), {
        retries: this.retries,
      });
      return true;
    } catch (error) {
      // Distinguish "repo not found" from actual errors
      if (isRepoNotFoundError(error)) {
        return false;
      }
      // Re-throw network/auth errors
      throw error;
    }
  }

  async create(
    repoInfo: RepoInfo,
    settings?: CreateRepoSettings,
    token?: string
  ): Promise<void> {
    this.assertGitHub(repoInfo);

    const tokenPrefix = this.buildTokenPrefix(token);
    const parts: string[] = [
      `${tokenPrefix}gh repo create`,
      escapeShellArg(`${repoInfo.owner}/${repoInfo.repo}`),
    ];

    // Visibility flag (default to private for safety)
    if (settings?.visibility === "public") {
      parts.push("--public");
    } else if (settings?.visibility === "internal") {
      parts.push("--internal");
    } else {
      parts.push("--private");
    }

    // Description
    if (settings?.description) {
      parts.push("--description", escapeShellArg(settings.description));
    }

    // Disable features if specified
    if (settings?.hasIssues === false) {
      parts.push("--disable-issues");
    }
    if (settings?.hasWiki === false) {
      parts.push("--disable-wiki");
    }

    const command = parts.join(" ");

    await withRetry(() => this.executor.exec(command, this.cwd), {
      retries: this.retries,
    });

    // Push an empty initial commit to establish the default branch.
    // Empty repos (no commits/branches) break clone→push workflows
    // because HEAD doesn't resolve.
    await this.initializeDefaultBranch(repoInfo, token);
  }

  async fork(
    upstream: RepoInfo,
    target: RepoInfo,
    settings?: CreateRepoSettings,
    token?: string
  ): Promise<void> {
    this.assertGitHub(upstream);
    this.assertGitHub(target);

    // Guard: cannot fork a repo to the same owner
    if (upstream.owner === target.owner) {
      throw new Error(
        `Cannot fork ${upstream.owner}/${upstream.repo} to the same owner '${target.owner}'. ` +
          `The upstream and target owners must be different.`
      );
    }

    // Determine if target owner is an organization or user
    const isOrg = await this.isOrganization(target.owner, target, token);

    const tokenPrefix = this.buildTokenPrefix(token);

    // Build fork command
    // For orgs: gh repo fork <upstream> --org <target-org> --fork-name <name> --clone=false
    // For users: gh repo fork <upstream> --fork-name <name> --clone=false
    const parts = [
      `${tokenPrefix}gh repo fork`,
      escapeShellArg(`${upstream.owner}/${upstream.repo}`),
    ];

    if (isOrg) {
      parts.push("--org", escapeShellArg(target.owner));
    }

    parts.push("--fork-name", escapeShellArg(target.repo), "--clone=false");

    const forkCommand = parts.join(" ");

    await withRetry(() => this.executor.exec(forkCommand, this.cwd), {
      retries: this.retries,
    });

    // GitHub forks are async - wait for the fork to be ready for git operations
    await this.waitForForkReady(
      target,
      this.forkReadyTimeoutMs,
      this.forkPollIntervalMs,
      token
    );

    // Apply settings after fork (visibility, description, etc.)
    if (settings?.visibility || settings?.description) {
      await this.applyRepoSettings(target, settings, token);
    }
  }

  /**
   * Wait for a forked repo to become available via the GitHub API.
   * GitHub forks are created asynchronously; polls exists() with a timeout.
   */
  private async waitForForkReady(
    repoInfo: GitHubRepoInfo,
    timeoutMs: number = FORK_READY_TIMEOUT_MS,
    intervalMs: number = FORK_POLL_INTERVAL_MS,
    token?: string
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const ready = await this.exists(repoInfo, token);
        if (ready) {
          return;
        }
      } catch {
        // Ignore transient errors during polling
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(intervalMs, remaining))
      );
    }

    throw new Error(
      `Timed out waiting for fork ${repoInfo.owner}/${repoInfo.repo} to become available ` +
        `after ${timeoutMs / 1000}s. The fork may still be processing on GitHub.`
    );
  }

  /**
   * Apply settings to an existing repo using gh repo edit.
   */
  private async applyRepoSettings(
    repoInfo: GitHubRepoInfo,
    settings: CreateRepoSettings,
    token?: string
  ): Promise<void> {
    const tokenPrefix = this.buildTokenPrefix(token);
    const parts = [
      `${tokenPrefix}gh repo edit`,
      escapeShellArg(`${repoInfo.owner}/${repoInfo.repo}`),
    ];

    if (settings.visibility) {
      parts.push(
        "--visibility",
        settings.visibility,
        "--accept-visibility-change-consequences"
      );
    }

    if (settings.description) {
      parts.push("--description", escapeShellArg(settings.description));
    }

    const command = parts.join(" ");

    await withRetry(() => this.executor.exec(command, this.cwd), {
      retries: this.retries,
    });
  }

  async receiveMigration(
    repoInfo: RepoInfo,
    sourceDir: string,
    settings?: CreateRepoSettings,
    token?: string
  ): Promise<void> {
    this.assertGitHub(repoInfo);

    const tokenPrefix = this.buildTokenPrefix(token);

    // Remove existing "origin" remote if present (e.g., from git clone --mirror).
    // gh repo create --source --push needs to set its own origin remote.
    try {
      await this.executor.exec(
        `git -C ${escapeShellArg(sourceDir)} remote remove origin`,
        this.cwd
      );
    } catch {
      // No origin remote — nothing to remove
    }

    // Remove hidden refs (e.g., refs/pull/*) that GitHub rejects on push.
    // Mirror clones include ALL refs from the source, but GitHub only
    // accepts branches and tags, not pull request merge refs.
    try {
      const refs = await this.executor.exec(
        `git -C ${escapeShellArg(sourceDir)} for-each-ref --format='%(refname)' refs/pull/`,
        this.cwd
      );
      for (const ref of refs.split("\n").filter((r) => r.trim())) {
        await this.executor.exec(
          `git -C ${escapeShellArg(sourceDir)} update-ref -d ${escapeShellArg(ref.trim())}`,
          this.cwd
        );
      }
    } catch {
      // No pull refs to remove — ignore
    }

    // Use gh repo create --source --push to create and mirror in one step.
    // For bare repos (from git clone --mirror), --push mirrors all refs.
    // This uses gh CLI authentication, avoiding raw git auth issues with GHE.
    const parts: string[] = [
      `${tokenPrefix}gh repo create`,
      escapeShellArg(`${repoInfo.owner}/${repoInfo.repo}`),
      "--source",
      escapeShellArg(sourceDir),
      "--push",
    ];

    // Visibility flag (default to private for safety)
    if (settings?.visibility === "public") {
      parts.push("--public");
    } else if (settings?.visibility === "internal") {
      parts.push("--internal");
    } else {
      parts.push("--private");
    }

    // Description
    if (settings?.description) {
      parts.push("--description", escapeShellArg(settings.description));
    }

    // Disable features if specified
    if (settings?.hasIssues === false) {
      parts.push("--disable-issues");
    }
    if (settings?.hasWiki === false) {
      parts.push("--disable-wiki");
    }

    const command = parts.join(" ");

    await withRetry(() => this.executor.exec(command, this.cwd), {
      retries: this.retries,
    });
  }

  /**
   * Create an initial commit on the default branch via the GitHub Contents API.
   * This establishes the default branch so subsequent clone→push workflows work
   * (empty repos have no branches, causing HEAD to be unresolvable).
   *
   * Note: GitHub's Git Data API returns 409 on truly empty repos, so we use
   * the Contents API which handles empty repos correctly.
   */
  private async initializeDefaultBranch(
    repoInfo: GitHubRepoInfo,
    token?: string
  ): Promise<void> {
    const tokenPrefix = this.buildTokenPrefix(token);
    const hostnameFlag = getHostnameFlag(repoInfo);
    const hostnamePart = hostnameFlag ? `${hostnameFlag} ` : "";
    const apiPath = `repos/${escapeShellArg(repoInfo.owner)}/${escapeShellArg(repoInfo.repo)}`;

    // Create an empty .gitkeep file to establish the default branch.
    // The Contents API handles empty repos (unlike the Git Data API which returns 409).
    // content="" is base64 for empty file.
    await withRetry(
      () =>
        this.executor.exec(
          `${tokenPrefix}gh api ${hostnamePart}${apiPath}/contents/.gitkeep ` +
            `--method PUT -f message='Initial commit' -f content=''`,
          this.cwd
        ),
      { retries: this.retries }
    );
  }
}
