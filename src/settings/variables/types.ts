import type { RepoInfo } from "../../repo/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";

export interface GitHubVariable {
  name: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubVariablesListResponse {
  total_count: number;
  variables: GitHubVariable[];
}

export interface VariableCreateParams {
  name: string;
  value: string;
}

export interface VariableUpdateParams {
  name: string;
  value: string;
}

export interface IVariablesStrategy {
  list(repoInfo: RepoInfo, options?: GhApiOptions): Promise<GitHubVariable[]>;
  create(
    repoInfo: RepoInfo,
    params: VariableCreateParams,
    options?: GhApiOptions
  ): Promise<void>;
  update(
    repoInfo: RepoInfo,
    params: VariableUpdateParams,
    options?: GhApiOptions
  ): Promise<void>;
  delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void>;
}
