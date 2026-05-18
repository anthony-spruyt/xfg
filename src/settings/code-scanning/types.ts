import type { RepoInfo } from "../../repo/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";
import type {
  CodeScanningState,
  CodeScanningQuerySuite,
} from "../../config/index.js";

/**
 * Current code scanning default setup state from GitHub API.
 */
export interface CurrentCodeScanningSettings {
  state: CodeScanningState;
  query_suite?: CodeScanningQuerySuite;
  languages?: string[];
}

export interface CodeScanningUpdateParams {
  state: string;
  query_suite?: string;
  languages?: string[];
}

/**
 * Strategy interface for code scanning default setup operations.
 * Abstracts the GitHub API calls for testability.
 */
export interface ICodeScanningStrategy {
  get(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<CurrentCodeScanningSettings>;

  update(
    repoInfo: RepoInfo,
    settings: CodeScanningUpdateParams,
    options?: GhApiOptions
  ): Promise<void>;
}
