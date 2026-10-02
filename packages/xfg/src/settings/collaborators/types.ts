import type { RepoInfo } from "../../repo/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";

export interface GitHubCollaborator {
  login: string;
}

export interface GitHubRepoInvitation {
  id: number;
  invitee: { login: string } | null;
  expired?: boolean;
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
}
