import {
  RepoInfo,
  isGitHubRepo,
  GitHubRepoInfo,
} from "../shared/repo-detector.js";
import { GitAuthOptions } from "../vcs/authenticated-git-ops.js";
import { ILogger } from "../shared/logger.js";
import { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";
import type { AuthResult, IAuthOptionsBuilder } from "./types.js";

export class AuthOptionsBuilder implements IAuthOptionsBuilder {
  constructor(
    private readonly tokenManager: GitHubAppTokenManager | null,
    private readonly log: ILogger
  ) {}

  async resolve(repoInfo: RepoInfo, repoName: string): Promise<AuthResult> {
    // 1. Get installation token if GitHub App configured
    const installationToken = await this.getInstallationToken(repoInfo);

    // 2. Handle "no installation found" case
    if (installationToken === null) {
      return {
        skipResult: {
          success: true,
          repoName,
          message: `No GitHub App installation found for ${repoInfo.owner}`,
          skipped: true,
        },
      };
    }

    // 3. Build effective token (installation token or PAT fallback)
    const token =
      installationToken ??
      (isGitHubRepo(repoInfo) ? process.env.GH_TOKEN : undefined);

    // 4. Build auth options if we have a token
    const authOptions = token
      ? this.buildAuthOptions(repoInfo, token)
      : undefined;

    return { token, authOptions };
  }

  private async getInstallationToken(
    repoInfo: RepoInfo
  ): Promise<string | null | undefined> {
    if (!this.tokenManager || !isGitHubRepo(repoInfo)) {
      return undefined;
    }

    try {
      return await this.tokenManager.getTokenForRepo(
        repoInfo as GitHubRepoInfo
      );
    } catch (error) {
      this.log.info(
        `Warning: Failed to get GitHub App token: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }

  private buildAuthOptions(repoInfo: RepoInfo, token: string): GitAuthOptions {
    return {
      token,
      host: isGitHubRepo(repoInfo)
        ? (repoInfo as GitHubRepoInfo).host
        : "github.com",
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    };
  }
}
