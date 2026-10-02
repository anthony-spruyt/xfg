import type { ICommandExecutor } from "../../shared/command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "../../repo/index.js";
import { GhApiClient, type GhApiOptions } from "../../shared/gh-api-utils.js";
import { parseApiJson } from "../../shared/json-utils.js";
import { isHttp404Error } from "../../shared/gh-token-utils.js";
import {
  MANIFEST_FILENAME,
  parseManifestContent,
  type XfgManifest,
} from "../../sync/manifest.js";
import type {
  ICollaboratorsStrategy,
  GitHubCollaborator,
  GitHubRepoInvitation,
} from "./types.js";

interface GitHubCollaboratorsStrategyOptions {
  retries?: number;
  cwd: string;
}

const CONTEXT = "GitHub Collaborators strategy";

export class GitHubCollaboratorsStrategy implements ICollaboratorsStrategy {
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubCollaboratorsStrategyOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async listCollaborators(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubCollaborator[]> {
    assertGitHubRepo(repoInfo, CONTEXT);

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/collaborators?affiliation=direct`;
    const result = await this.api.call("GET", endpoint, {
      options,
      paginate: true,
    });
    return parseApiJson<GitHubCollaborator[]>(result, "collaborators response");
  }

  async listInvitations(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubRepoInvitation[]> {
    assertGitHubRepo(repoInfo, CONTEXT);

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/invitations`;
    const result = await this.api.call("GET", endpoint, {
      options,
      paginate: true,
    });
    return parseApiJson<GitHubRepoInvitation[]>(result, "invitations response");
  }

  async add(
    repoInfo: RepoInfo,
    username: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, CONTEXT);

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/collaborators/${encodeURIComponent(username)}`;
    await this.api.call("PUT", endpoint, { options });
  }

  async remove(
    repoInfo: RepoInfo,
    username: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, CONTEXT);

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/collaborators/${encodeURIComponent(username)}`;
    await this.api.call("DELETE", endpoint, { options });
  }

  async cancelInvitation(
    repoInfo: RepoInfo,
    invitationId: number,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, CONTEXT);

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/invitations/${invitationId}`;
    await this.api.call("DELETE", endpoint, { options });
  }

  async getManifest(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<XfgManifest | null> {
    assertGitHubRepo(repoInfo, CONTEXT);

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${MANIFEST_FILENAME}`;
    let result: string;
    try {
      result = await this.api.call("GET", endpoint, { options });
    } catch (error) {
      if (isHttp404Error(error)) return null;
      throw error;
    }

    const file = parseApiJson<{ content?: string; encoding?: string }>(
      result,
      "manifest contents response"
    );
    if (file.encoding !== "base64" || file.content === undefined) return null;
    return parseManifestContent(
      Buffer.from(file.content, "base64").toString("utf-8")
    );
  }
}
