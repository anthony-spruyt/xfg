import type { RepoInfo } from "../../repo/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";

export type ActionsEndpointName =
  | "permissions"
  | "selectedActions"
  | "workflow"
  | "forkPrApproval"
  | "artifactRetention"
  | "cacheRetention"
  | "cacheStorage";

/** JSON body of an Actions settings endpoint, in the API's snake_case. */
export type ActionsApiBody = Record<string, unknown>;

export interface IActionsStrategy {
  get(
    repoInfo: RepoInfo,
    endpoint: ActionsEndpointName,
    options?: GhApiOptions
  ): Promise<ActionsApiBody>;

  update(
    repoInfo: RepoInfo,
    endpoint: ActionsEndpointName,
    payload: ActionsApiBody,
    options?: GhApiOptions
  ): Promise<void>;
}
