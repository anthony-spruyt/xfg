import type { RepoInfo } from "../../shared/repo-detector.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";

/**
 * GitHub label as returned by the API.
 */
export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
  default: boolean;
}

/**
 * Strategy interface for label operations.
 * Abstracts platform-specific API calls.
 */
export interface ILabelsStrategy {
  list(repoInfo: RepoInfo, options?: GhApiOptions): Promise<GitHubLabel[]>;
  create(
    repoInfo: RepoInfo,
    label: { name: string; color: string; description?: string },
    options?: GhApiOptions
  ): Promise<void>;
  update(
    repoInfo: RepoInfo,
    currentName: string,
    label: { new_name?: string; color?: string; description?: string },
    options?: GhApiOptions
  ): Promise<void>;
  delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void>;
}
