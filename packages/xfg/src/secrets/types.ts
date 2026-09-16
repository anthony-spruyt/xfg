import type { RepoInfo } from "../repo/index.js";
import type { GhApiOptions } from "../shared/gh-api-utils.js";

export interface GitHubSecret {
  name: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubSecretsListResponse {
  total_count: number;
  secrets: GitHubSecret[];
}

export interface GitHubPublicKey {
  key_id: string;
  key: string;
}

export interface ISecretsStrategy {
  list(repoInfo: RepoInfo, options?: GhApiOptions): Promise<GitHubSecret[]>;
  getPublicKey(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubPublicKey>;
  upsert(
    repoInfo: RepoInfo,
    name: string,
    encryptedValue: string,
    keyId: string,
    options?: GhApiOptions
  ): Promise<void>;
  delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void>;
}
