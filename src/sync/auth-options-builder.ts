import { RepoInfo, isGitHubRepo } from "../shared/repo-detector.js";
import type { GitHubRepoInfo } from "../shared/repo-detector.js";
import { GitAuthOptions } from "../vcs/authenticated-git-ops.js";
import { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";
import type { AuthResult, IAuthOptionsBuilder } from "./types.js";
import { resolveGitHubToken } from "../shared/gh-api-utils.js";

export class AuthOptionsBuilder implements IAuthOptionsBuilder {
  constructor(
    private readonly tokenManager: GitHubAppTokenManager | null,
    private readonly _log: unknown
  ) {}

  async resolve(repoInfo: RepoInfo, repoName: string): Promise<AuthResult> {
    if (!isGitHubRepo(repoInfo)) {
      // Non-GitHub repos don't use token-based auth
      return { ok: true, token: undefined, authOptions: undefined };
    }

    const { token, skipped } = await resolveGitHubToken(
      repoInfo,
      this.tokenManager,
      repoName
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
