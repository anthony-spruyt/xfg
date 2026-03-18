import { escapeShellArg } from "../shared/shell-utils.js";
import { ICommandExecutor } from "../shared/command-executor.js";
import {
  withRetry,
  isPermanentError,
  DEFAULT_PERMANENT_ERROR_PATTERNS,
} from "../shared/retry-utils.js";
import {
  assertGitHubRepo,
  type RepoInfo,
  type GitHubRepoInfo,
} from "../shared/repo-detector.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { LifecycleError } from "../shared/errors.js";
import { buildTokenEnv, getHostnameFlag } from "../shared/gh-api-utils.js";
import type { DebugWarnLog } from "../shared/logger.js";
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
    toErrorMessage(error) +
    ((error instanceof Error
      ? (error as Error & { stderr?: string }).stderr
      : undefined) ?? "");
  return REPO_NOT_FOUND_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Default timeout for waiting for fork readiness (60 seconds).
 */
const FORK_READY_TIMEOUT_MS = 60_000;

/**
 * After repo creation, GitHub may return 404 due to eventual consistency.
 * Exclude 404/not-found from permanent errors so withRetry retries them.
 */
const POST_CREATE_PERMANENT_PATTERNS = DEFAULT_PERMANENT_ERROR_PATTERNS.filter(
  (p) => !p.test("404 Not Found")
);

/**
 * Interval between fork readiness checks (2 seconds).
 */
const FORK_POLL_INTERVAL_MS = 2_000;

/**
 * GitHub implementation of IRepoLifecycleProvider.
 * Uses gh CLI for all operations.
 */
interface GitHubLifecycleProviderOptions {
  executor: ICommandExecutor;
  retries?: number;
  cwd: string;
  /** Timeout in ms for waiting for fork readiness (default: 60000) */
  forkReadyTimeoutMs?: number;
  /** Poll interval in ms for fork readiness checks (default: 2000) */
  forkPollIntervalMs?: number;
  log?: DebugWarnLog;
}

export class GitHubLifecycleProvider implements IRepoLifecycleProvider {
  readonly platform: LifecyclePlatform = "github";
  private readonly executor: ICommandExecutor;
  private readonly retries: number;
  private readonly cwd: string;
  private readonly forkReadyTimeoutMs: number;
  private readonly forkPollIntervalMs: number;
  private readonly log?: DebugWarnLog;

  constructor(options: GitHubLifecycleProviderOptions) {
    this.executor = options.executor;
    this.retries = options.retries ?? 3;
    this.cwd = options.cwd;
    this.forkReadyTimeoutMs =
      options.forkReadyTimeoutMs ?? FORK_READY_TIMEOUT_MS;
    this.forkPollIntervalMs =
      options.forkPollIntervalMs ?? FORK_POLL_INTERVAL_MS;
    this.log = options.log;
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
    const { tokenEnv, prefix } = this.buildGhApiPrefix(repoInfo, token);
    const command = `${prefix}users/${escapeShellArg(owner)}`;

    try {
      const stdout = await withRetry(
        () => this.executor.exec(command, this.cwd, { env: tokenEnv }),
        { retries: this.retries }
      );
      const data: { type?: string } = JSON.parse(stdout);
      return data.type === "Organization";
    } catch (error) {
      // Two-tier error handling:
      // 1. Permanent errors (auth failures, 403/401) are rethrown — retrying
      //    or falling through would mask a real credentials problem.
      // 2. Transient errors (network timeouts, 5xx) fall through to assume
      //    the owner is an organization, which is the safer default because
      //    --org is required for org forks but harmless if wrong.
      if (isPermanentError(error)) {
        throw error;
      }
      // This may cause fork to fail with a misleading error for personal accounts.
      const errMsg = toErrorMessage(error);
      this.log?.debug(
        `Could not determine if '${owner}' is an organization, defaulting to org behavior: ${errMsg}`
      );
      this.log?.warn(
        `Could not verify if '${owner}' is an organization or user account. ` +
          `If fork fails, check your authentication (gh auth status) and ensure the ` +
          `target owner is correct.`
      );
      return true;
    }
  }

  private assertGitHub(repoInfo: RepoInfo): asserts repoInfo is GitHubRepoInfo {
    assertGitHubRepo(repoInfo, "GitHubLifecycleProvider");
  }

  /**
   * Builds the common gh API command prefix parts for a given repo.
   * Returns tokenEnv for exec options, and the command prefix string
   * (e.g., "gh api --hostname host repos/owner/repo").
   */
  private buildGhApiPrefix(
    repoInfo: GitHubRepoInfo,
    token?: string
  ): {
    tokenEnv: Record<string, string> | undefined;
    prefix: string;
    apiPath: string;
  } {
    const tokenEnv = buildTokenEnv(token);
    const hostnameFlag = getHostnameFlag(repoInfo);
    const hostnamePart = hostnameFlag ? `${hostnameFlag} ` : "";
    const apiPath = `repos/${escapeShellArg(repoInfo.owner)}/${escapeShellArg(repoInfo.repo)}`;
    return { tokenEnv, prefix: `gh api ${hostnamePart}`, apiPath };
  }

  async exists(repoInfo: RepoInfo, token?: string): Promise<boolean> {
    this.assertGitHub(repoInfo);

    const { tokenEnv, prefix, apiPath } = this.buildGhApiPrefix(
      repoInfo,
      token
    );
    const command = `${prefix}${apiPath}`;

    try {
      // Note: withRetry already classifies 404/not-found as permanent errors,
      // so retries are aborted immediately for non-existent repos.
      await withRetry(
        () => this.executor.exec(command, this.cwd, { env: tokenEnv }),
        {
          retries: this.retries,
        }
      );
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

    const tokenEnv = buildTokenEnv(token);
    const parts: string[] = [
      "gh repo create",
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

    // Add --add-readme to establish the default branch via an initial commit.
    // This avoids empty repos where HEAD doesn't resolve.
    parts.push("--add-readme");

    const command = parts.join(" ");

    await withRetry(
      () => this.executor.exec(command, this.cwd, { env: tokenEnv }),
      {
        retries: this.retries,
      }
    );

    // Rename default branch if requested and it differs from what GitHub created.
    if (settings?.defaultBranch) {
      const {
        tokenEnv: branchTokenEnv,
        prefix,
        apiPath,
      } = this.buildGhApiPrefix(repoInfo, token);

      // Detect the actual default branch name
      const actualBranch = (
        await withRetry(
          () =>
            this.executor.exec(
              `${prefix}${apiPath} --jq '.default_branch'`,
              this.cwd,
              { env: branchTokenEnv }
            ),
          {
            retries: this.retries,
            permanentErrorPatterns: POST_CREATE_PERMANENT_PATTERNS,
          }
        )
      ).trim();

      if (actualBranch !== settings.defaultBranch) {
        await this.renameBranch(
          repoInfo,
          actualBranch,
          settings.defaultBranch,
          token
        );

        // Wait for the rename to propagate — GitHub's API may still report
        // the old default branch for a few seconds after the rename call.
        await this.waitForDefaultBranch(repoInfo, settings.defaultBranch, {
          token,
        });
      }
    }

    // Delete the README so xfg sync starts from a clean state.
    await this.deleteReadme(repoInfo, token);
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
    if (upstream.owner.toLowerCase() === target.owner.toLowerCase()) {
      throw new LifecycleError(
        `Cannot fork ${upstream.owner}/${upstream.repo} to the same owner '${target.owner}'. ` +
          `The upstream and target owners must be different.`
      );
    }

    // Determine if target owner is an organization or user
    const isOrg = await this.isOrganization(target.owner, target, token);

    const tokenEnv = buildTokenEnv(token);

    // Build fork command
    // For orgs: gh repo fork <upstream> --org <target-org> --fork-name <name> --clone=false
    // For users: gh repo fork <upstream> --fork-name <name> --clone=false
    const parts = [
      "gh repo fork",
      escapeShellArg(`${upstream.owner}/${upstream.repo}`),
    ];

    if (isOrg) {
      parts.push("--org", escapeShellArg(target.owner));
    }

    parts.push("--fork-name", escapeShellArg(target.repo), "--clone=false");

    const forkCommand = parts.join(" ");

    await withRetry(
      () => this.executor.exec(forkCommand, this.cwd, { env: tokenEnv }),
      {
        retries: this.retries,
      }
    );

    // GitHub forks are async - wait for the fork to be ready for git operations
    await this.waitForForkReady(target, {
      timeoutMs: this.forkReadyTimeoutMs,
      pollMs: this.forkPollIntervalMs,
      token,
    });

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
    options?: { timeoutMs?: number; pollMs?: number; token?: string }
  ): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? FORK_READY_TIMEOUT_MS;
    const intervalMs = options?.pollMs ?? FORK_POLL_INTERVAL_MS;
    const token = options?.token;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const ready = await this.exists(repoInfo, token);
        if (ready) {
          return;
        }
      } catch (error) {
        this.log?.debug(`Polling fork readiness: ${toErrorMessage(error)}`);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(intervalMs, remaining))
      );
    }

    throw new LifecycleError(
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
    const tokenEnv = buildTokenEnv(token);
    const parts = [
      "gh repo edit",
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

    await withRetry(
      () => this.executor.exec(command, this.cwd, { env: tokenEnv }),
      {
        retries: this.retries,
      }
    );
  }

  async receiveMigration(
    repoInfo: RepoInfo,
    sourceDir: string,
    settings?: CreateRepoSettings,
    token?: string
  ): Promise<void> {
    this.assertGitHub(repoInfo);

    const tokenEnv = buildTokenEnv(token);

    // Remove existing "origin" remote if present (e.g., from git clone --mirror).
    // gh repo create --source --push needs to set its own origin remote.
    try {
      await this.executor.exec(
        `git -C ${escapeShellArg(sourceDir)} remote remove origin`,
        this.cwd
      );
    } catch (error) {
      this.log?.debug(
        `Cleanup: remote remove origin skipped - ${toErrorMessage(error)}`
      );
    }

    // Remove all non-standard refs that GitHub rejects on push.
    // Mirror clones include ALL refs from the source, but GitHub only
    // accepts branches (refs/heads/*) and tags (refs/tags/*).
    // Other refs like refs/pull/* (GitHub), refs/merge-requests/* (GitLab),
    // refs/keep-around/* etc. must be removed.
    try {
      const allRefs = await this.executor.exec(
        `git -C ${escapeShellArg(sourceDir)} for-each-ref --format='%(refname)'`,
        this.cwd
      );
      for (const ref of allRefs.split("\n").filter((r) => r.trim())) {
        const trimmed = ref.trim();
        if (
          !trimmed.startsWith("refs/heads/") &&
          !trimmed.startsWith("refs/tags/")
        ) {
          await this.executor.exec(
            `git -C ${escapeShellArg(sourceDir)} update-ref -d ${escapeShellArg(trimmed)}`,
            this.cwd
          );
        }
      }
    } catch (error) {
      this.log?.debug(
        `Cleanup: ref cleanup skipped - ${toErrorMessage(error)}`
      );
    }

    // Rename default branch in mirror clone if requested.
    if (settings?.defaultBranch) {
      const headRef = (
        await this.executor.exec(
          `git -C ${escapeShellArg(sourceDir)} symbolic-ref HEAD`,
          this.cwd
        )
      ).trim();

      const prefix = "refs/heads/";
      if (!headRef.startsWith(prefix)) {
        throw new LifecycleError(
          `Mirror clone HEAD symbolic-ref is '${headRef}', expected to start with '${prefix}'. ` +
            `Cannot rename default branch.`
        );
      }

      const sourceBranch = headRef.slice(prefix.length);

      if (sourceBranch !== settings.defaultBranch) {
        await this.executor.exec(
          `git -C ${escapeShellArg(sourceDir)} branch -m ${escapeShellArg(sourceBranch)} ${escapeShellArg(settings.defaultBranch)}`,
          this.cwd
        );
        await this.executor.exec(
          `git -C ${escapeShellArg(sourceDir)} symbolic-ref HEAD refs/heads/${escapeShellArg(settings.defaultBranch)}`,
          this.cwd
        );
      }
    }

    // Use gh repo create --source --push to create and mirror in one step.
    // For bare repos (from git clone --mirror), --push mirrors all refs.
    // This uses gh CLI authentication, avoiding raw git auth issues with GHE.
    const parts: string[] = [
      "gh repo create",
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

    await withRetry(
      () => this.executor.exec(command, this.cwd, { env: tokenEnv }),
      {
        retries: this.retries,
      }
    );
  }

  /**
   * Rename a branch via the GitHub branch rename API.
   * GitHub automatically updates the default branch pointer.
   */
  private async renameBranch(
    repoInfo: GitHubRepoInfo,
    current: string,
    desired: string,
    token?: string
  ): Promise<void> {
    const { tokenEnv, prefix, apiPath } = this.buildGhApiPrefix(
      repoInfo,
      token
    );

    await withRetry(
      () =>
        this.executor.exec(
          `${prefix}${apiPath}/branches/${escapeShellArg(current)}/rename ` +
            `--method POST -f new_name=${escapeShellArg(desired)}`,
          this.cwd,
          { env: tokenEnv }
        ),
      {
        retries: this.retries,
      }
    );
  }

  /**
   * Poll until the GitHub API reports the expected default branch.
   * After a branch rename, the API may lag for a few seconds.
   *
   * Note: Uses the same executor.exec pattern as the rest of this class.
   * The command arguments are constructed from trusted RepoInfo values
   * (validated during config parsing), not user input.
   */
  private async waitForDefaultBranch(
    repoInfo: GitHubRepoInfo,
    expectedBranch: string,
    options?: { timeoutMs?: number; pollMs?: number; token?: string }
  ): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? 15000;
    const pollMs = options?.pollMs ?? 1000;
    const { tokenEnv, prefix, apiPath } = this.buildGhApiPrefix(
      repoInfo,
      options?.token
    );
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const branch = (
          await this.executor.exec(
            `${prefix}${apiPath} --jq '.default_branch'`,
            this.cwd,
            { env: tokenEnv }
          )
        ).trim();
        if (branch === expectedBranch) {
          return;
        }
      } catch (error) {
        this.log?.debug(`Polling default branch: ${toErrorMessage(error)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    // Don't throw — rename succeeded, this is just a best-effort wait
  }

  /**
   * Delete the README.md that --add-readme creates.
   * This leaves the repo with a default branch established (from the initial
   * commit) but no files, so xfg sync starts from a clean state.
   */
  private async deleteReadme(
    repoInfo: GitHubRepoInfo,
    token?: string
  ): Promise<void> {
    const { tokenEnv, prefix, apiPath } = this.buildGhApiPrefix(
      repoInfo,
      token
    );

    // Get the SHA of the README.md created by --add-readme
    const fileInfo = await withRetry(
      () =>
        this.executor.exec(
          `${prefix}${apiPath}/contents/README.md --jq '.sha'`,
          this.cwd,
          { env: tokenEnv }
        ),
      {
        retries: this.retries,
        permanentErrorPatterns: POST_CREATE_PERMANENT_PATTERNS,
      }
    );

    const sha = fileInfo.trim();

    // Delete the README.md to leave the repo clean
    await withRetry(
      () =>
        this.executor.exec(
          `${prefix}${apiPath}/contents/README.md ` +
            `--method DELETE -f message='Remove initialization file' -f sha=${escapeShellArg(sha)}`,
          this.cwd,
          { env: tokenEnv }
        ),
      {
        retries: this.retries,
        permanentErrorPatterns: POST_CREATE_PERMANENT_PATTERNS,
      }
    );
  }
}
