import { toErrorMessage } from "./type-guards.js";

import type { DebugWarnLog } from "./logger.js";
import type { GitHubApiTarget } from "./gh-api-utils.js";
import {
  GitHubHostNotAllowedError,
  GitHubHostPolicy,
  type IGitHubHostPolicy,
} from "./github-host-policy.js";

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
  /** Hosts allowed to receive any token. Defaults to github.com only. */
  hostPolicy?: IGitHubHostPolicy;
}

const DEFAULT_HOST_POLICY = new GitHubHostPolicy();

/**
 * Resolve a GitHub token for a repo: GitHub App token → envToken fallback.
 * Returns { token, skipped } where skipped=true means no App installation found
 * for this owner (token will be undefined). Both sync and settings paths use this.
 */
export async function resolveGitHubToken(
  options: ResolveGitHubTokenOptions
): Promise<GitHubTokenResult> {
  const { repoInfo, tokenManager, context, log, envToken } = options;
  const hostPolicy = options.hostPolicy ?? DEFAULT_HOST_POLICY;
  if (!hostPolicy.isAllowed(repoInfo.host)) {
    log?.warn(
      `${new GitHubHostNotAllowedError(repoInfo.host).message} Continuing ${context} without a token.`
    );
    return { token: undefined, skipped: false };
  }
  try {
    const appToken = await tokenManager?.getTokenForRepo(repoInfo);
    if (appToken === null) {
      return { token: undefined, skipped: true };
    }
    return { token: appToken ?? envToken, skipped: false };
  } catch (error) {
    if (error instanceof GitHubHostNotAllowedError) {
      log?.warn(`${error.message} Continuing ${context} without a token.`);
      return { token: undefined, skipped: false };
    }
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
    private readonly log?: DebugWarnLog,
    private readonly hostPolicy?: IGitHubHostPolicy
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
      hostPolicy: this.hostPolicy,
    });
  }
}

/**
 * Check if an error message indicates an HTTP 404 response from the GitHub API.
 */
export function isHttp404Error(error: unknown): boolean {
  return toErrorMessage(error).includes("HTTP 404");
}
