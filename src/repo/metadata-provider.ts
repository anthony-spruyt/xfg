import type { ICommandExecutor } from "../shared/command-executor.js";
import { assertGitHubRepo } from "./utils.js";
import type { RepoInfo } from "./types.js";
import { GhApiClient, type GhApiOptions } from "../shared/gh-api-utils.js";
import { parseApiJson } from "../shared/json-utils.js";
import type { RepoVisibility } from "../config/index.js";

export interface RepoMetadata {
  visibility: RepoVisibility;
  ownerType: "User" | "Organization";
  hasGHAS: boolean;
}

/**
 * Strategy interface for fetching repository metadata.
 * Used to share repo metadata (visibility, owner type, GHAS)
 * across settings processors without coupling them.
 */
export interface IRepoMetadataProvider {
  getMetadata(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<RepoMetadata>;
}

interface GitHubRepoMetadataProviderOptions {
  retries?: number;
  cwd: string;
}

export class GitHubRepoMetadataProvider implements IRepoMetadataProvider {
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubRepoMetadataProviderOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async getMetadata(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<RepoMetadata> {
    assertGitHubRepo(repoInfo, "Repo Metadata Provider");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}`;
    const result = await this.api.call("GET", endpoint, { options });

    const parsed = parseApiJson<{
      visibility?: RepoVisibility;
      owner?: { type?: "User" | "Organization" };
      security_and_analysis?: Record<string, unknown> | null;
    }>(result, "repo metadata response");

    return {
      visibility: parsed.visibility ?? "public",
      ownerType: parsed.owner?.type ?? "User",
      hasGHAS: parsed.security_and_analysis != null,
    };
  }
}
