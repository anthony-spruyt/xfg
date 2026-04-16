import type { ICommandExecutor } from "../../shared/command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "../../repo/index.js";
import { GhApiClient, type GhApiOptions } from "../../shared/gh-api-utils.js";
import { parseApiJson } from "../../shared/json-utils.js";
import type { ILabelsStrategy, GitHubLabel } from "./types.js";

interface GitHubLabelsStrategyOptions {
  retries?: number;
  cwd: string;
}

export class GitHubLabelsStrategy implements ILabelsStrategy {
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubLabelsStrategyOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async list(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubLabel[]> {
    assertGitHubRepo(repoInfo, "GitHub Labels strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/labels`;
    const result = await this.api.call("GET", endpoint, {
      options,
      paginate: true,
    });

    return parseApiJson<GitHubLabel[]>(result, "labels response");
  }

  async create(
    repoInfo: RepoInfo,
    label: { name: string; color: string; description?: string },
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Labels strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/labels`;
    await this.api.call("POST", endpoint, { payload: label, options });
  }

  async update(
    repoInfo: RepoInfo,
    currentName: string,
    label: { new_name?: string; color?: string; description?: string },
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Labels strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/labels/${encodeURIComponent(currentName)}`;
    await this.api.call("PATCH", endpoint, { payload: label, options });
  }

  async delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Labels strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/labels/${encodeURIComponent(name)}`;
    await this.api.call("DELETE", endpoint, { options });
  }
}
