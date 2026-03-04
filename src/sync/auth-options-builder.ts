import { RepoInfo, isGitHubRepo } from "../shared/repo-detector.js";
import { GitAuthOptions } from "../vcs/authenticated-git-ops.js";
import { ILogger } from "../shared/logger.js";
import { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";
import type { AuthResult, IAuthOptionsBuilder } from "./types.js";
import { toErrorMessage } from "../shared/type-guards.js";

export class AuthOptionsBuilder implements IAuthOptionsBuilder {
  constructor(
    private readonly tokenManager: GitHubAppTokenManager | null,
    private readonly log: ILogger
  ) {}

  async resolve(repoInfo: RepoInfo, repoName: string): Promise<AuthResult> {
    const installationToken = await this.getInstallationToken(repoInfo);

    if (installationToken === null) {
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

    // string → GitHub App token; undefined → fall back to GH_TOKEN env var
    const token =
      installationToken ??
      (isGitHubRepo(repoInfo) ? process.env.GH_TOKEN : undefined);

    const authOptions = token
      ? this.buildAuthOptions(repoInfo, token)
      : undefined;

    return { ok: true, token, authOptions };
  }

  private async getInstallationToken(
    repoInfo: RepoInfo
  ): Promise<string | null | undefined> {
    if (!this.tokenManager || !isGitHubRepo(repoInfo)) {
      return undefined;
    }

    try {
      return await this.tokenManager.getTokenForRepo(repoInfo);
    } catch (error) {
      this.log.warn(`Failed to get GitHub App token: ${toErrorMessage(error)}`);
      return undefined;
    }
  }

  private buildAuthOptions(repoInfo: RepoInfo, token: string): GitAuthOptions {
    const host = isGitHubRepo(repoInfo) ? repoInfo.host : "github.com";
    return {
      token,
      host,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    };
  }
}
