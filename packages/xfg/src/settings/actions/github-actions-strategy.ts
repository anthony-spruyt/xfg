import type { ICommandExecutor } from "../../shared/command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "../../repo/index.js";
import { GhApiClient, type GhApiOptions } from "../../shared/gh-api-utils.js";
import { parseApiJson } from "../../shared/json-utils.js";
import { endpointByName } from "./endpoints.js";
import type {
  ActionsApiBody,
  ActionsEndpointName,
  IActionsStrategy,
} from "./types.js";

interface GitHubActionsStrategyOptions {
  retries?: number;
  cwd: string;
}

export class GitHubActionsStrategy implements IActionsStrategy {
  private readonly api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubActionsStrategyOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async get(
    repoInfo: RepoInfo,
    endpoint: ActionsEndpointName,
    options?: GhApiOptions
  ): Promise<ActionsApiBody> {
    const url = this.url(repoInfo, endpoint);
    const result = await this.api.call("GET", url, { options });

    return parseApiJson<ActionsApiBody>(
      result,
      `Actions ${endpoint} settings response`
    );
  }

  async update(
    repoInfo: RepoInfo,
    endpoint: ActionsEndpointName,
    payload: ActionsApiBody,
    options?: GhApiOptions
  ): Promise<void> {
    const url = this.url(repoInfo, endpoint);
    await this.api.call("PUT", url, { payload, options });
  }

  private url(repoInfo: RepoInfo, endpoint: ActionsEndpointName): string {
    assertGitHubRepo(repoInfo, "GitHub Actions strategy");
    return `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/${endpointByName(endpoint).path}`;
  }
}
