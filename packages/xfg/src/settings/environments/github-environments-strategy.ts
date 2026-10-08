import type { ICommandExecutor } from "../../shared/command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "../../repo/index.js";
import { GhApiClient, type GhApiOptions } from "../../shared/gh-api-utils.js";
import { parseApiJson } from "../../shared/json-utils.js";
import type { DeploymentBranchPattern } from "../../config/index.js";
import type {
  GitHubPublicKey,
  GitHubSecret,
  GitHubSecretsListResponse,
} from "../secrets/types.js";
import type {
  GitHubBranchPoliciesResponse,
  GitHubDeploymentBranchPolicy,
  GitHubEnvironment,
  GitHubEnvironmentsListResponse,
  IEnvironmentSecretsStrategy,
  IEnvironmentsStrategy,
} from "./types.js";

interface GitHubEnvironmentsStrategyOptions {
  retries?: number;
  cwd: string;
}

const LABEL = "GitHub Environments strategy";

export class GitHubEnvironmentsStrategy
  implements IEnvironmentsStrategy, IEnvironmentSecretsStrategy
{
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubEnvironmentsStrategyOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  private base(repoInfo: RepoInfo, environment?: string): string {
    assertGitHubRepo(repoInfo, LABEL);
    const root = `/repos/${repoInfo.owner}/${repoInfo.repo}/environments`;
    return environment === undefined
      ? root
      : `${root}/${encodeURIComponent(environment)}`;
  }

  async list(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubEnvironment[]> {
    const result = await this.api.call(
      "GET",
      `${this.base(repoInfo)}?per_page=100`,
      { options, paginate: true }
    );
    const response = parseApiJson<GitHubEnvironmentsListResponse>(
      result,
      "environments response"
    );
    return (response.environments ?? []).map((env) => ({
      name: env.name,
      deployment_branch_policy: env.deployment_branch_policy ?? null,
    }));
  }

  async createOrUpdate(
    repoInfo: RepoInfo,
    name: string,
    policy: GitHubDeploymentBranchPolicy | null,
    options?: GhApiOptions
  ): Promise<void> {
    await this.api.call("PUT", this.base(repoInfo, name), {
      payload: { deployment_branch_policy: policy },
      options,
    });
  }

  async listBranchPolicies(
    repoInfo: RepoInfo,
    environment: string,
    options?: GhApiOptions
  ): Promise<DeploymentBranchPattern[]> {
    const result = await this.api.call(
      "GET",
      `${this.base(repoInfo, environment)}/deployment-branch-policies?per_page=100`,
      { options, paginate: true }
    );
    const response = parseApiJson<GitHubBranchPoliciesResponse>(
      result,
      "deployment branch policies response"
    );
    return (response.branch_policies ?? []).map((p) => ({
      type: p.type ?? "branch",
      name: p.name,
    }));
  }

  async createBranchPolicy(
    repoInfo: RepoInfo,
    environment: string,
    pattern: DeploymentBranchPattern,
    options?: GhApiOptions
  ): Promise<void> {
    await this.api.call(
      "POST",
      `${this.base(repoInfo, environment)}/deployment-branch-policies`,
      { payload: { name: pattern.name, type: pattern.type }, options }
    );
  }

  async listSecrets(
    repoInfo: RepoInfo,
    environment: string,
    options?: GhApiOptions
  ): Promise<GitHubSecret[]> {
    const result = await this.api.call(
      "GET",
      `${this.base(repoInfo, environment)}/secrets?per_page=100`,
      { options, paginate: true }
    );
    const response = parseApiJson<GitHubSecretsListResponse>(
      result,
      "environment secrets response"
    );
    return response.secrets ?? [];
  }

  async getSecretsPublicKey(
    repoInfo: RepoInfo,
    environment: string,
    options?: GhApiOptions
  ): Promise<GitHubPublicKey> {
    const result = await this.api.call(
      "GET",
      `${this.base(repoInfo, environment)}/secrets/public-key`,
      { options }
    );
    return parseApiJson<GitHubPublicKey>(
      result,
      "environment public key response"
    );
  }

  async upsertSecret(
    repoInfo: RepoInfo,
    environment: string,
    name: string,
    encryptedValue: string,
    keyId: string,
    options?: GhApiOptions
  ): Promise<void> {
    await this.api.call(
      "PUT",
      `${this.base(repoInfo, environment)}/secrets/${encodeURIComponent(name)}`,
      { payload: { encrypted_value: encryptedValue, key_id: keyId }, options }
    );
  }
}
