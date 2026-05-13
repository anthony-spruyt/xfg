import type { ICommandExecutor } from "../../shared/command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "../../repo/index.js";
import { GhApiClient, type GhApiOptions } from "../../shared/gh-api-utils.js";
import { parseApiJson } from "../../shared/json-utils.js";
import type {
  IVariablesStrategy,
  GitHubVariable,
  GitHubVariablesListResponse,
} from "./types.js";

interface GitHubVariablesStrategyOptions {
  retries?: number;
  cwd: string;
}

export class GitHubVariablesStrategy implements IVariablesStrategy {
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubVariablesStrategyOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async list(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubVariable[]> {
    assertGitHubRepo(repoInfo, "GitHub Variables strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/variables?per_page=100`;
    const result = await this.api.call("GET", endpoint, {
      options,
    });

    const response = parseApiJson<GitHubVariablesListResponse>(
      result,
      "variables response"
    );
    return response.variables;
  }

  async create(
    repoInfo: RepoInfo,
    name: string,
    value: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Variables strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/variables`;
    await this.api.call("POST", endpoint, {
      payload: { name, value },
      options,
    });
  }

  async update(
    repoInfo: RepoInfo,
    name: string,
    value: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Variables strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/variables/${encodeURIComponent(name)}`;
    await this.api.call("PATCH", endpoint, {
      payload: { name, value },
      options,
    });
  }

  async delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Variables strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/variables/${encodeURIComponent(name)}`;
    await this.api.call("DELETE", endpoint, { options });
  }
}
