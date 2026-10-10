import type { RepoInfo } from "../../repo/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";
import type { DeploymentBranchPattern } from "../../config/index.js";
import type { GitHubPublicKey, GitHubSecret } from "../secrets/types.js";

export interface GitHubDeploymentBranchPolicy {
  protected_branches: boolean;
  custom_branch_policies: boolean;
}

export interface GitHubEnvironment {
  name: string;
  /** null: any branch can deploy */
  deployment_branch_policy: GitHubDeploymentBranchPolicy | null;
}

export interface GitHubEnvironmentsListResponse {
  total_count: number;
  environments?: GitHubEnvironment[];
}

export interface GitHubBranchPolicy {
  id: number;
  name: string;
  type?: "branch" | "tag";
}

export interface GitHubBranchPoliciesResponse {
  total_count: number;
  branch_policies?: GitHubBranchPolicy[];
}

/** A pattern as it exists on GitHub; the id is what DELETE takes. */
export interface ExistingBranchPattern extends DeploymentBranchPattern {
  id: number;
}

export interface IEnvironmentsStrategy {
  list(repoInfo: RepoInfo, options?: GhApiOptions): Promise<GitHubEnvironment[]>;
  createOrUpdate(
    repoInfo: RepoInfo,
    name: string,
    policy: GitHubDeploymentBranchPolicy | null,
    options?: GhApiOptions
  ): Promise<void>;
  delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void>;
  listBranchPolicies(
    repoInfo: RepoInfo,
    environment: string,
    options?: GhApiOptions
  ): Promise<ExistingBranchPattern[]>;
  createBranchPolicy(
    repoInfo: RepoInfo,
    environment: string,
    pattern: DeploymentBranchPattern,
    options?: GhApiOptions
  ): Promise<void>;
  deleteBranchPolicy(
    repoInfo: RepoInfo,
    environment: string,
    id: number,
    options?: GhApiOptions
  ): Promise<void>;
}

export interface IEnvironmentSecretsStrategy {
  list(repoInfo: RepoInfo, options?: GhApiOptions): Promise<GitHubEnvironment[]>;
  listSecrets(
    repoInfo: RepoInfo,
    environment: string,
    options?: GhApiOptions
  ): Promise<GitHubSecret[]>;
  getSecretsPublicKey(
    repoInfo: RepoInfo,
    environment: string,
    options?: GhApiOptions
  ): Promise<GitHubPublicKey>;
  upsertSecret(
    repoInfo: RepoInfo,
    environment: string,
    name: string,
    encryptedValue: string,
    keyId: string,
    options?: GhApiOptions
  ): Promise<void>;
  deleteSecret(
    repoInfo: RepoInfo,
    environment: string,
    name: string,
    options?: GhApiOptions
  ): Promise<void>;
}
