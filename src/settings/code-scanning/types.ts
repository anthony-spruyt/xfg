import type { RepoInfo } from "../../repo/detector.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";

/**
 * Current code scanning default setup state from GitHub API.
 */
export interface CurrentCodeScanningSettings {
  state: "configured" | "not-configured";
  query_suite?: "default" | "extended";
  languages?: string[];
}

/**
 * Strategy interface for code scanning default setup operations.
 * Abstracts the GitHub API calls for testability.
 */
export interface ICodeScanningStrategy {
  getDefaultSetup(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<CurrentCodeScanningSettings>;

  updateDefaultSetup(
    repoInfo: RepoInfo,
    settings: { state: string; query_suite?: string; languages?: string[] },
    options?: GhApiOptions
  ): Promise<void>;
}
