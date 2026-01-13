export type RepoType = 'github' | 'azure-devops';

export interface RepoInfo {
  type: RepoType;
  gitUrl: string;
  owner: string;
  repo: string;
  // Azure DevOps specific
  organization?: string;
  project?: string;
}

export function detectRepoType(gitUrl: string): RepoType {
  if (gitUrl.includes('dev.azure.com')) {
    return 'azure-devops';
  }
  return 'github';
}

export function parseGitUrl(gitUrl: string): RepoInfo {
  const type = detectRepoType(gitUrl);

  if (type === 'azure-devops') {
    return parseAzureDevOpsUrl(gitUrl);
  }

  return parseGitHubUrl(gitUrl);
}

function parseGitHubUrl(gitUrl: string): RepoInfo {
  // Handle SSH format: git@github.com:owner/repo.git
  const sshMatch = gitUrl.match(/git@github\.com:([^/]+)\/([^.]+)(?:\.git)?/);
  if (sshMatch) {
    return {
      type: 'github',
      gitUrl,
      owner: sshMatch[1],
      repo: sshMatch[2],
    };
  }

  // Handle HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = gitUrl.match(/https?:\/\/github\.com\/([^/]+)\/([^.]+)(?:\.git)?/);
  if (httpsMatch) {
    return {
      type: 'github',
      gitUrl,
      owner: httpsMatch[1],
      repo: httpsMatch[2],
    };
  }

  throw new Error(`Unable to parse GitHub URL: ${gitUrl}`);
}

function parseAzureDevOpsUrl(gitUrl: string): RepoInfo {
  // Handle SSH format: git@ssh.dev.azure.com:v3/organization/project/repo
  const sshMatch = gitUrl.match(/git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^.]+)/);
  if (sshMatch) {
    return {
      type: 'azure-devops',
      gitUrl,
      owner: sshMatch[1],
      repo: sshMatch[3],
      organization: sshMatch[1],
      project: sshMatch[2],
    };
  }

  // Handle HTTPS format: https://dev.azure.com/organization/project/_git/repo
  const httpsMatch = gitUrl.match(/https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^.]+)/);
  if (httpsMatch) {
    return {
      type: 'azure-devops',
      gitUrl,
      owner: httpsMatch[1],
      repo: httpsMatch[3],
      organization: httpsMatch[1],
      project: httpsMatch[2],
    };
  }

  throw new Error(`Unable to parse Azure DevOps URL: ${gitUrl}`);
}

export function getRepoDisplayName(repoInfo: RepoInfo): string {
  if (repoInfo.type === 'azure-devops') {
    return `${repoInfo.organization}/${repoInfo.project}/${repoInfo.repo}`;
  }
  return `${repoInfo.owner}/${repoInfo.repo}`;
}
