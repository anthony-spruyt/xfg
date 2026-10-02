import type { RepoInfo } from "../../repo/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";
import type { XfgManifest } from "../../sync/manifest.js";

export interface GitHubCollaborator {
  login: string;
}

export interface GitHubRepoInvitation {
  id: number;
  invitee: { login: string } | null;
}

export interface ICollaboratorsStrategy {
  listCollaborators(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubCollaborator[]>;
  listInvitations(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubRepoInvitation[]>;
  add(
    repoInfo: RepoInfo,
    username: string,
    options?: GhApiOptions
  ): Promise<void>;
  remove(
    repoInfo: RepoInfo,
    username: string,
    options?: GhApiOptions
  ): Promise<void>;
  cancelInvitation(
    repoInfo: RepoInfo,
    invitationId: number,
    options?: GhApiOptions
  ): Promise<void>;
  /** Reads .xfg.json from the default branch; null when absent. */
  getManifest(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<XfgManifest | null>;
}
