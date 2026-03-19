import { RepoInfo, isGitHubRepo } from "../shared/repo-detector.js";
import type { GitHubRepoInfo } from "../shared/repo-detector.js";
import type { GitAuthOptions } from "../vcs/index.js";
import { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";
import type { AuthResult, IAuthOptionsBuilder } from "./types.js";
import type { ILogger } from "../shared/logger.js";
import { resolveGitHubToken } from "../shared/gh-api-utils.js";

export class AuthOptionsBuilder implements IAuthOptionsBuilder {
  constructor(
    private readonly tokenManager: GitHubAppTokenManager | null,
    private readonly log?: ILogger,
    private readonly envToken?: string
  ) {}

  async resolve(
    repoInfo: RepoInfo,
    repoName: string,
    token?: string
  ): Promise<AuthResult> {
    if (!isGitHubRepo(repoInfo)) {
      return { ok: true, token: undefined, authOptions: undefined };
    }

    // If caller already resolved a token, use it directly
    if (token !== undefined) {
      const authOptions = this.buildAuthOptions(repoInfo, token);
      return { ok: true, token, authOptions };
    }

    // Otherwise resolve via token manager / env fallback
    const resolved = await resolveGitHubToken(
      repoInfo,
      this.tokenManager,
      repoName,
      this.log,
      this.envToken
    );

    if (resolved.skipped) {
      return {
        ok: false,
        skipResult: {
          success: true,
          repoName,
          message: `No GitHub App installation found for ${repoInfo.owner}`,
          skipped: true,
        },
      };
    }

    const authOptions = resolved.token
      ? this.buildAuthOptions(repoInfo, resolved.token)
      : undefined;

    return { ok: true, token: resolved.token, authOptions };
  }

  private buildAuthOptions(
    repoInfo: GitHubRepoInfo,
    token: string
  ): GitAuthOptions {
    return {
      token,
      host: repoInfo.host,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    };
  }
}
