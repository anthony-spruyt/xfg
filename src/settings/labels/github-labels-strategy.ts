import {
  ICommandExecutor,
  defaultExecutor,
} from "../../shared/command-executor.js";
import {
  isGitHubRepo,
  GitHubRepoInfo,
  RepoInfo,
} from "../../shared/repo-detector.js";
import {
  ghApiCall,
  type HttpMethod,
  type GhApiOptions,
} from "../gh-api-utils.js";
import type { ILabelsStrategy, GitHubLabel } from "./types.js";

interface GitHubLabelsStrategyOptions {
  retries?: number;
}

/**
 * GitHub Labels Strategy for managing repository labels via GitHub REST API.
 * Uses `gh api` CLI for authentication and API calls.
 *
 * Note: Uses ICommandExecutor (the project's safe executor pattern) with
 * escapeShellArg for input sanitization, matching the rulesets strategy pattern.
 */
export class GitHubLabelsStrategy implements ILabelsStrategy {
  private executor: ICommandExecutor;
  private retries: number;

  constructor(
    executor?: ICommandExecutor,
    options?: GitHubLabelsStrategyOptions
  ) {
    this.executor = executor ?? defaultExecutor;
    this.retries = options?.retries ?? 3;
  }

  /**
   * Lists all labels for a repository.
   * Uses --paginate to retrieve all labels.
   */
  async list(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubLabel[]> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/labels`;
    const result = await this.ghApi("GET", endpoint, undefined, options, true);

    return JSON.parse(result) as GitHubLabel[];
  }

  /**
   * Creates a new label.
   */
  async create(
    repoInfo: RepoInfo,
    label: { name: string; color: string; description?: string },
    options?: GhApiOptions
  ): Promise<void> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/labels`;
    await this.ghApi("POST", endpoint, label, options);
  }

  /**
   * Updates an existing label.
   * Uses encodeURIComponent for label name in URL path.
   */
  async update(
    repoInfo: RepoInfo,
    currentName: string,
    label: { new_name?: string; color?: string; description?: string },
    options?: GhApiOptions
  ): Promise<void> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/labels/${encodeURIComponent(currentName)}`;
    await this.ghApi("PATCH", endpoint, label, options);
  }

  /**
   * Deletes a label.
   * Uses encodeURIComponent for label name in URL path.
   */
  async delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/labels/${encodeURIComponent(name)}`;
    await this.ghApi("DELETE", endpoint, undefined, options);
  }

  /**
   * Validates that the repo is a GitHub repository.
   */
  private validateGitHub(repoInfo: RepoInfo): void {
    if (!isGitHubRepo(repoInfo)) {
      throw new Error(
        `GitHub Labels strategy requires GitHub repositories. Got: ${repoInfo.type}`
      );
    }
  }

  private async ghApi(
    method: HttpMethod,
    endpoint: string,
    payload?: unknown,
    options?: GhApiOptions,
    paginate?: boolean
  ): Promise<string> {
    return ghApiCall(method, endpoint, {
      executor: this.executor,
      retries: this.retries,
      apiOpts: options,
      payload,
      paginate,
    });
  }
}
