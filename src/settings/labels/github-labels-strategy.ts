import {
  ICommandExecutor,
  defaultExecutor,
} from "../../shared/command-executor.js";
import {
  isGitHubRepo,
  GitHubRepoInfo,
  RepoInfo,
} from "../../shared/repo-detector.js";
import { escapeShellArg } from "../../shared/shell-utils.js";
import { withRetry } from "../../shared/retry-utils.js";
import type {
  ILabelsStrategy,
  GitHubLabel,
  LabelsStrategyOptions,
} from "./types.js";

export interface GitHubLabelsStrategyOptions {
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
    options?: LabelsStrategyOptions
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
    options?: LabelsStrategyOptions
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
    options?: LabelsStrategyOptions
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
    options?: LabelsStrategyOptions
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

  /**
   * Executes a GitHub API call using the gh CLI.
   * Uses the project's ICommandExecutor + escapeShellArg pattern
   * (matching github-ruleset-strategy.ts).
   */
  private async ghApi(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    endpoint: string,
    payload?: unknown,
    options?: LabelsStrategyOptions,
    paginate?: boolean
  ): Promise<string> {
    const args: string[] = ["gh", "api"];

    // Add method flag
    if (method !== "GET") {
      args.push("-X", method);
    }

    // Add pagination for list endpoint
    if (paginate) {
      args.push("--paginate");
    }

    // Add host flag for GitHub Enterprise
    if (options?.host && options.host !== "github.com") {
      args.push("--hostname", escapeShellArg(options.host));
    }

    // Add endpoint
    args.push(escapeShellArg(endpoint));

    // Build base command
    const baseCommand = args.join(" ");

    // Add GH_TOKEN environment variable prefix if token provided
    const tokenPrefix = options?.token
      ? `GH_TOKEN=${escapeShellArg(options.token)} `
      : "";

    // For POST/PATCH with payload, use echo pipe pattern
    if (payload && (method === "POST" || method === "PATCH")) {
      const payloadJson = JSON.stringify(payload);
      const command = `echo ${escapeShellArg(payloadJson)} | ${tokenPrefix}${baseCommand} --input -`;
      return await withRetry(() => this.executor.exec(command, process.cwd()), {
        retries: this.retries,
      });
    }

    // For GET/DELETE, run command directly
    const command = `${tokenPrefix}${baseCommand}`;
    return await withRetry(() => this.executor.exec(command, process.cwd()), {
      retries: this.retries,
    });
  }
}
