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
      // Use cwd of current directory (doesn't matter for gh api)
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

    // Visibility flag
    if (settings?.visibility === "private") {
      parts.push("--private");
    } else if (settings?.visibility === "internal") {
      parts.push("--internal");
    } else {
      parts.push("--public");
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
    _settings?: CreateRepoSettings
  ): Promise<void> {
    this.assertGitHub(upstream);
    this.assertGitHub(target);

    // gh repo fork <upstream> --org <target-org> --fork-name <name> --clone=false
    const command = [
      "gh repo fork",
      escapeShellArg(`${upstream.owner}/${upstream.repo}`),
      "--org",
      escapeShellArg(target.owner),
      "--fork-name",
      escapeShellArg(target.repo),
      "--clone=false",
    ].join(" ");

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
