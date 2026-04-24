import type { ICommandExecutor } from "../../shared/command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "../../repo/index.js";
import { GhApiClient, type GhApiOptions } from "../../shared/gh-api-utils.js";
import { parseApiJson } from "../../shared/json-utils.js";
import type {
  ICodeScanningStrategy,
  CurrentCodeScanningSettings,
} from "./types.js";

interface GitHubCodeScanningStrategyOptions {
  retries?: number;
  cwd: string;
}

export class GitHubCodeScanningStrategy implements ICodeScanningStrategy {
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubCodeScanningStrategyOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async get(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<CurrentCodeScanningSettings> {
    assertGitHubRepo(repoInfo, "GitHub Code Scanning strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/code-scanning/default-setup`;
    const result = await this.api.call("GET", endpoint, { options });

    return parseApiJson<CurrentCodeScanningSettings>(
      result,
      "code scanning default setup response"
    );
  }

  async update(
    repoInfo: RepoInfo,
    settings: { state: string; query_suite?: string; languages?: string[] },
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Code Scanning strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/code-scanning/default-setup`;
    await this.api.call("PATCH", endpoint, { payload: settings, options });
  }
}
