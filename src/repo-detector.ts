export type RepoType = "github" | "azure-devops";

// Base interface with common fields
interface BaseRepoInfo {
  gitUrl: string;
  repo: string;
}

// GitHub-specific type
export interface GitHubRepoInfo extends BaseRepoInfo {
  type: "github";
  owner: string;
}

// Azure DevOps-specific type
export interface AzureDevOpsRepoInfo extends BaseRepoInfo {
  type: "azure-devops";
  owner: string;
  organization: string;
  project: string;
}

// Discriminated union
export type RepoInfo = GitHubRepoInfo | AzureDevOpsRepoInfo;

// Type guards
export function isGitHubRepo(info: RepoInfo): info is GitHubRepoInfo {
  return info.type === "github";
}

export function isAzureDevOpsRepo(info: RepoInfo): info is AzureDevOpsRepoInfo {
  return info.type === "azure-devops";
}

/**
 * Valid URL patterns for supported repository types.
 */
const GITHUB_URL_PATTERNS = [/^git@github\.com:/, /^https?:\/\/github\.com\//];

const AZURE_DEVOPS_URL_PATTERNS = [
  /^git@ssh\.dev\.azure\.com:/,
  /^https?:\/\/dev\.azure\.com\//,
];

export function detectRepoType(gitUrl: string): RepoType {
  // Check for Azure DevOps formats
  for (const pattern of AZURE_DEVOPS_URL_PATTERNS) {
    if (pattern.test(gitUrl)) {
      return "azure-devops";
    }
  }

  // Check for GitHub formats
  for (const pattern of GITHUB_URL_PATTERNS) {
    if (pattern.test(gitUrl)) {
      return "github";
    }
  }

  // Throw for unrecognized URL formats
  throw new Error(
    `Unrecognized git URL format: ${gitUrl}. Supported formats: GitHub (git@github.com: or https://github.com/) and Azure DevOps (git@ssh.dev.azure.com: or https://dev.azure.com/)`,
  );
}

export function parseGitUrl(gitUrl: string): RepoInfo {
  const type = detectRepoType(gitUrl);

  if (type === "azure-devops") {
    return parseAzureDevOpsUrl(gitUrl);
  }

  return parseGitHubUrl(gitUrl);
}

function parseGitHubUrl(gitUrl: string): GitHubRepoInfo {
  // Handle SSH format: git@github.com:owner/repo.git
  // Use (.+?) with end anchor to handle repo names with dots (e.g., my.repo.git)
  const sshMatch = gitUrl.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      type: "github",
      gitUrl,
      owner: sshMatch[1],
      repo: sshMatch[2],
    };
  }

  // Handle HTTPS format: https://github.com/owner/repo.git
  // Use (.+?) with end anchor to handle repo names with dots
  const httpsMatch = gitUrl.match(
    /https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
  );
  if (httpsMatch) {
    return {
      type: "github",
      gitUrl,
      owner: httpsMatch[1],
      repo: httpsMatch[2],
    };
  }

  throw new Error(`Unable to parse GitHub URL: ${gitUrl}`);
}

function parseAzureDevOpsUrl(gitUrl: string): AzureDevOpsRepoInfo {
  // Handle SSH format: git@ssh.dev.azure.com:v3/organization/project/repo
  // Use (.+?) with end anchor to handle repo names with dots
  const sshMatch = gitUrl.match(
    /git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/,
  );
  if (sshMatch) {
    return {
      type: "azure-devops",
      gitUrl,
      owner: sshMatch[1],
      repo: sshMatch[3],
      organization: sshMatch[1],
      project: sshMatch[2],
    };
  }

  // Handle HTTPS format: https://dev.azure.com/organization/project/_git/repo
  // Use (.+?) with end anchor to handle repo names with dots
  const httpsMatch = gitUrl.match(
    /https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/(.+?)(?:\.git)?$/,
  );
  if (httpsMatch) {
    return {
      type: "azure-devops",
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
  if (repoInfo.type === "azure-devops") {
    return `${repoInfo.organization}/${repoInfo.project}/${repoInfo.repo}`;
  }
  return `${repoInfo.owner}/${repoInfo.repo}`;
}
