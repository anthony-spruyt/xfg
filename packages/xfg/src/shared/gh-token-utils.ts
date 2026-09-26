import { toErrorMessage } from "./type-guards.js";

import type { DebugWarnLog } from "./logger.js";
import type { GitHubApiTarget } from "./gh-api-utils.js";

export interface ITokenManager {
  getTokenForRepo(repoInfo: GitHubApiTarget): Promise<string | null>;
}

export interface GitHubTokenResult {
  token: string | undefined;
  skipped: boolean;
}

/** Resolves the token for one GitHub repo; skipped=true means the owner has no App installation. */
export interface IGitHubTokenProvider {
  getToken(
    repoInfo: GitHubApiTarget,
    context: string
  ): Promise<GitHubTokenResult>;
}

export interface ResolveGitHubTokenOptions {
  repoInfo: GitHubApiTarget;
  tokenManager: ITokenManager | null;
  context: string;
  log?: DebugWarnLog;
  envToken?: string;
}

/**
 * Resolve a GitHub token for a repo: GitHub App token → envToken fallback.
 * Returns { token, skipped } where skipped=true means no App installation found
 * for this owner (token will be undefined). Both sync and settings paths use this.
 */
export async function resolveGitHubToken(
  options: ResolveGitHubTokenOptions
): Promise<GitHubTokenResult> {
  const { repoInfo, tokenManager, context, log, envToken } = options;
  try {
    const appToken = await tokenManager?.getTokenForRepo(repoInfo);
    if (appToken === null) {
      return { token: undefined, skipped: true };
    }
    return { token: appToken ?? envToken, skipped: false };
  } catch (error) {
    const errorMsg = `GitHub App token resolution failed for ${context}: ${toErrorMessage(error)}`;
    if (envToken) {
      log?.warn(`${errorMsg}; falling back to the environment token`);
    } else {
      log?.warn(`${errorMsg}; no fallback token available`);
    }
    return { token: envToken, skipped: false };
  }
}

export function noAppInstallationMessage(owner: string): string {
  return `No GitHub App installation found for ${owner}`;
}

export class GitHubTokenProvider implements IGitHubTokenProvider {
  constructor(
    private readonly tokenManager: ITokenManager | null,
    private readonly envToken?: string,
    private readonly log?: DebugWarnLog
  ) {}

  getToken(
    repoInfo: GitHubApiTarget,
    context: string
  ): Promise<GitHubTokenResult> {
    return resolveGitHubToken({
      repoInfo,
      tokenManager: this.tokenManager,
      context,
      log: this.log,
      envToken: this.envToken,
    });
  }
}

/**
 * Check if an error message indicates an HTTP 404 response from the GitHub API.
 */
export function isHttp404Error(error: unknown): boolean {
  return toErrorMessage(error).includes("HTTP 404");
}
