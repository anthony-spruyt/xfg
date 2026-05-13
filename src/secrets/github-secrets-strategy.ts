import type { ICommandExecutor } from "../shared/command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "../repo/index.js";
import { GhApiClient, type GhApiOptions } from "../shared/gh-api-utils.js";
import { parseApiJson } from "../shared/json-utils.js";
import type {
  ISecretsStrategy,
  GitHubSecret,
  GitHubSecretsListResponse,
  GitHubPublicKey,
} from "./types.js";

interface GitHubSecretsStrategyOptions {
  retries?: number;
  cwd: string;
}

export class GitHubSecretsStrategy implements ISecretsStrategy {
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubSecretsStrategyOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async list(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubSecret[]> {
    assertGitHubRepo(repoInfo, "GitHub Secrets strategy");
    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/secrets?per_page=100`;
    const result = await this.api.call("GET", endpoint, { options });
    const response = parseApiJson<GitHubSecretsListResponse>(
      result,
      "secrets response"
    );
    return response.secrets;
  }

  async getPublicKey(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubPublicKey> {
    assertGitHubRepo(repoInfo, "GitHub Secrets strategy");
    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/secrets/public-key`;
    const result = await this.api.call("GET", endpoint, { options });
    return parseApiJson<GitHubPublicKey>(result, "public key response");
  }

  async upsert(
    repoInfo: RepoInfo,
    name: string,
    encryptedValue: string,
    keyId: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Secrets strategy");
    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/secrets/${encodeURIComponent(name)}`;
    await this.api.call("PUT", endpoint, {
      payload: { encrypted_value: encryptedValue, key_id: keyId },
      options,
    });
  }

  async delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Secrets strategy");
    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/secrets/${encodeURIComponent(name)}`;
    await this.api.call("DELETE", endpoint, { options });
  }
}
