interface BaseRepoInfo {
  gitUrl: string;
  repo: string;
}

export interface GitHubRepoInfo extends BaseRepoInfo {
  type: "github";
  owner: string;
  host: string;
}

export interface AzureDevOpsRepoInfo extends BaseRepoInfo {
  type: "azure-devops";
  owner: string;
  organization: string;
  project: string;
}

export interface GitLabRepoInfo extends BaseRepoInfo {
  type: "gitlab";
  owner: string;
  namespace: string;
  host: string;
}

export type RepoInfo = GitHubRepoInfo | AzureDevOpsRepoInfo | GitLabRepoInfo;
