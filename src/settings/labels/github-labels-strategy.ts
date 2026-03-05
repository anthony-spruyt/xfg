import {
  ICommandExecutor,
  defaultExecutor,
} from "../../shared/command-executor.js";
import { assertGitHubRepo, RepoInfo } from "../../shared/repo-detector.js";
import {
  GhApiClient,
  parseApiJson,
  type GhApiOptions,
} from "../../shared/gh-api-utils.js";
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
  private api: GhApiClient;

  constructor(
    executor?: ICommandExecutor,
    options?: GitHubLabelsStrategyOptions
  ) {
    this.api = new GhApiClient(
      executor ?? defaultExecutor,
      options?.retries ?? 3
    );
  }

  /**
   * Lists all labels for a repository.
   * Uses --paginate to retrieve all labels.
   */
  async list(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubLabel[]> {
    assertGitHubRepo(repoInfo, "GitHub Labels strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/labels`;
    const result = await this.api.call(
      "GET",
      endpoint,
      undefined,
      options,
      true
    );

    return parseApiJson<GitHubLabel[]>(result, "labels response");
  }

  /**
   * Creates a new label.
   */
  async create(
    repoInfo: RepoInfo,
    label: { name: string; color: string; description?: string },
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Labels strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/labels`;
    await this.api.call("POST", endpoint, label, options);
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
    assertGitHubRepo(repoInfo, "GitHub Labels strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/labels/${encodeURIComponent(currentName)}`;
    await this.api.call("PATCH", endpoint, label, options);
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
    assertGitHubRepo(repoInfo, "GitHub Labels strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/labels/${encodeURIComponent(name)}`;
    await this.api.call("DELETE", endpoint, undefined, options);
  }
}
