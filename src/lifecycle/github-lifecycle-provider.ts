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
 * GitHub implementation of IRepoLifecycleProvider.
 * Uses gh CLI for all operations.
 */
export class GitHubLifecycleProvider implements IRepoLifecycleProvider {
  readonly platform: LifecyclePlatform = "github";

  constructor(
    private readonly executor: ICommandExecutor = defaultExecutor,
    private readonly retries: number = 3
  ) {}

  /**
   * Check if a GitHub owner is an organization (vs user).
   * Uses gh api to query the user/org endpoint.
   */
  private async isOrganization(
    owner: string,
    repoInfo: GitHubRepoInfo
  ): Promise<boolean> {
    const hostnameFlag = getHostnameFlag(repoInfo);
    const hostnamePart = hostnameFlag ? `${hostnameFlag} ` : "";
    const command = `gh api ${hostnamePart}users/${escapeShellArg(owner)}`;

    try {
      const stdout = await withRetry(
        () => this.executor.exec(command, process.cwd()),
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

  async exists(repoInfo: RepoInfo): Promise<boolean> {
    this.assertGitHub(repoInfo);

    const hostnameFlag = getHostnameFlag(repoInfo);
    const hostnamePart = hostnameFlag ? `${hostnameFlag} ` : "";
    const command = `gh api ${hostnamePart}repos/${escapeShellArg(repoInfo.owner)}/${escapeShellArg(repoInfo.repo)}`;

    try {
      // Note: withRetry already classifies 404/not-found as permanent errors,
      // so retries are aborted immediately for non-existent repos.
      await withRetry(() => this.executor.exec(command, process.cwd()), {
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
    settings?: CreateRepoSettings
  ): Promise<void> {
    this.assertGitHub(repoInfo);

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

    const command = parts.join(" ");

    await withRetry(() => this.executor.exec(command, process.cwd()), {
      retries: this.retries,
    });
  }

  async fork(
    upstream: RepoInfo,
    target: RepoInfo,
    settings?: CreateRepoSettings
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
    const isOrg = await this.isOrganization(target.owner, target);

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

    await withRetry(() => this.executor.exec(forkCommand, process.cwd()), {
      retries: this.retries,
    });

    // Apply settings after fork (visibility, description, etc.)
    if (settings?.visibility || settings?.description) {
      await this.applyRepoSettings(target, settings);
    }
  }

  /**
   * Apply settings to an existing repo using gh repo edit.
   */
  private async applyRepoSettings(
    repoInfo: GitHubRepoInfo,
    settings: CreateRepoSettings
  ): Promise<void> {
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

    await withRetry(() => this.executor.exec(command, process.cwd()), {
      retries: this.retries,
    });
  }

  async receiveMigration(
    repoInfo: RepoInfo,
    sourceDir: string,
    settings?: CreateRepoSettings
  ): Promise<void> {
    this.assertGitHub(repoInfo);

    // Step 1: Create the target repo
    await this.create(repoInfo, settings);

    // Step 2: Push mirror from source directory
    const pushCommand = `git push --mirror ${escapeShellArg(repoInfo.gitUrl)}`;

    await withRetry(() => this.executor.exec(pushCommand, sourceDir), {
      retries: this.retries,
    });
  }
}
