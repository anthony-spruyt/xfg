import { RepoInfo, isGitHubRepo } from "../shared/repo-detector.js";
import type { GitHubRepoInfo } from "../shared/repo-detector.js";
import type { GitAuthOptions } from "../vcs/types.js";
import { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";
import type { AuthResult, IAuthOptionsBuilder } from "./types.js";
import type { ILogger } from "../shared/logger.js";
import { resolveGitHubToken } from "../shared/gh-api-utils.js";

export class AuthOptionsBuilder implements IAuthOptionsBuilder {
  constructor(
    private readonly tokenManager: GitHubAppTokenManager | null,
    private readonly log?: ILogger
  ) {}

  async resolve(
    repoInfo: RepoInfo,
    repoName: string,
    preResolvedToken?: string
  ): Promise<AuthResult> {
    if (!isGitHubRepo(repoInfo)) {
      return { ok: true, token: undefined, authOptions: undefined };
    }

    if (preResolvedToken !== undefined) {
      const authOptions = this.buildAuthOptions(repoInfo, preResolvedToken);
      return { ok: true, token: preResolvedToken, authOptions };
    }

    const { token, skipped } = await resolveGitHubToken(
      repoInfo,
      this.tokenManager,
      repoName,
      this.log,
      process.env.GH_TOKEN
    );

    if (skipped) {
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

    const authOptions = token
      ? this.buildAuthOptions(repoInfo, token)
      : undefined;

    return { ok: true, token, authOptions };
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
