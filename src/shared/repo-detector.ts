export type RepoType = "github" | "azure-devops" | "gitlab";

// Context for repo detection with optional GitHub Enterprise hosts
export interface RepoDetectorContext {
  githubHosts?: string[];
}

// Base interface with common fields
interface BaseRepoInfo {
  gitUrl: string;
  repo: string;
}

// GitHub-specific type
export interface GitHubRepoInfo extends BaseRepoInfo {
  type: "github";
  owner: string;
  host: string; // "github.com" or GHE hostname
}

// Azure DevOps-specific type
export interface AzureDevOpsRepoInfo extends BaseRepoInfo {
  type: "azure-devops";
  owner: string;
  organization: string;
  project: string;
}

// GitLab-specific type
export interface GitLabRepoInfo extends BaseRepoInfo {
  type: "gitlab";
  owner: string; // First path segment (for consistency with other platforms)
  namespace: string; // Full path before repo (supports nested groups)
  host: string; // gitlab.com or self-hosted domain
}

// Discriminated union
export type RepoInfo = GitHubRepoInfo | AzureDevOpsRepoInfo | GitLabRepoInfo;

// Type guards
export function isGitHubRepo(info: RepoInfo): info is GitHubRepoInfo {
  return info.type === "github";
}

export function isAzureDevOpsRepo(info: RepoInfo): info is AzureDevOpsRepoInfo {
  return info.type === "azure-devops";
}

export function isGitLabRepo(info: RepoInfo): info is GitLabRepoInfo {
  return info.type === "gitlab";
}

/**
 * Extract hostname from a git URL.
 */
function extractHostFromUrl(gitUrl: string): string | null {
  // SSH: git@hostname:path
  const sshMatch = gitUrl.match(/^git@([^:]+):/);
  if (sshMatch) {
    return sshMatch[1];
  }

  // HTTPS: https://hostname/path
  const httpsMatch = gitUrl.match(/^https?:\/\/([^/]+)/);
  if (httpsMatch) {
    return httpsMatch[1];
  }

  return null;
}

/**
 * Valid URL patterns for supported repository types.
 */
const GITHUB_URL_PATTERNS = [/^git@github\.com:/, /^https?:\/\/github\.com\//];

const AZURE_DEVOPS_URL_PATTERNS = [
  /^git@ssh\.dev\.azure\.com:/,
  /^https?:\/\/dev\.azure\.com\//,
];

const GITLAB_SAAS_URL_PATTERNS = [
  /^git@gitlab\.com:/,
  /^https?:\/\/gitlab\.com\//,
];

/**
 * Check if a URL looks like a GitLab-style URL (used for self-hosted detection).
 * This is a fallback for URLs that don't match known platforms.
 */
function isGitLabStyleUrl(gitUrl: string): boolean {
  // SSH: git@hostname:path/to/repo.git
  const sshMatch = gitUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const path = sshMatch[2];
    // Must have at least one slash (owner/repo or namespace/repo)
    return path.includes("/");
  }

  // HTTPS: https://hostname/path/to/repo.git
  const httpsMatch = gitUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    const path = httpsMatch[2];
    // Must have at least one slash (owner/repo or namespace/repo)
    return path.includes("/");
  }

  return false;
}

export function detectRepoType(
  gitUrl: string,
  context?: RepoDetectorContext
): RepoType {
  // Check for GitHub Enterprise hosts first (if configured)
  if (context?.githubHosts?.length) {
    const host = extractHostFromUrl(gitUrl)?.toLowerCase();
    const normalizedHosts = context.githubHosts.map((h) => h.toLowerCase());
    if (host && normalizedHosts.includes(host)) {
      return "github";
    }
  }

  // Check for Azure DevOps formats (most specific patterns)
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

  // Check for GitLab SaaS formats
  for (const pattern of GITLAB_SAAS_URL_PATTERNS) {
    if (pattern.test(gitUrl)) {
      return "gitlab";
    }
  }

  // For unrecognized URLs, try GitLab-style parsing as fallback (self-hosted)
  if (isGitLabStyleUrl(gitUrl)) {
    return "gitlab";
  }

  // Throw for unrecognized URL formats
  throw new Error(
    `Unrecognized git URL format: ${gitUrl}. Supported formats: GitHub (git@github.com: or https://github.com/), Azure DevOps (git@ssh.dev.azure.com: or https://dev.azure.com/), and GitLab (git@gitlab.com: or https://gitlab.com/)`
  );
}

export function parseGitUrl(
  gitUrl: string,
  context?: RepoDetectorContext
): RepoInfo {
  const type = detectRepoType(gitUrl, context);

  if (type === "azure-devops") {
    return parseAzureDevOpsUrl(gitUrl);
  }

  if (type === "gitlab") {
    return parseGitLabUrl(gitUrl);
  }

  // For GitHub, extract the host from the URL
  const host = extractHostFromUrl(gitUrl) ?? "github.com";
  return parseGitHubUrl(gitUrl, host);
}

function parseGitHubUrl(gitUrl: string, host: string): GitHubRepoInfo {
  // Handle SSH format: git@hostname:owner/repo.git
  // Use (.+?) with end anchor to handle repo names with dots (e.g., my.repo.git)
  const sshMatch = gitUrl.match(/^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      type: "github",
      gitUrl,
      owner: sshMatch[1],
      repo: sshMatch[2],
      host,
    };
  }

  // Handle HTTPS format: https://hostname/owner/repo.git
  // Use (.+?) with end anchor to handle repo names with dots
  const httpsMatch = gitUrl.match(
    /^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/
  );
  if (httpsMatch) {
    return {
      type: "github",
      gitUrl,
      owner: httpsMatch[1],
      repo: httpsMatch[2],
      host,
    };
  }

  throw new Error(`Unable to parse GitHub URL: ${gitUrl}`);
}

function parseAzureDevOpsUrl(gitUrl: string): AzureDevOpsRepoInfo {
  // Handle SSH format: git@ssh.dev.azure.com:v3/organization/project/repo
  // Use (.+?) with end anchor to handle repo names with dots
  const sshMatch = gitUrl.match(
    /git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/
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
    /https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/(.+?)(?:\.git)?$/
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

function parseGitLabUrl(gitUrl: string): GitLabRepoInfo {
  // Handle SSH format: git@gitlab.com:owner/repo.git or git@gitlab.com:org/group/repo.git
  // Also handles self-hosted: git@gitlab.example.com:owner/repo.git
  const sshMatch = gitUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const host = sshMatch[1];
    const fullPath = sshMatch[2];
    return parseGitLabPath(gitUrl, host, fullPath);
  }

  // Handle HTTPS format: https://gitlab.com/owner/repo.git or https://gitlab.com/org/group/repo.git
  // Also handles self-hosted: https://gitlab.example.com/owner/repo.git
  const httpsMatch = gitUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    const host = httpsMatch[1];
    const fullPath = httpsMatch[2];
    return parseGitLabPath(gitUrl, host, fullPath);
  }

  throw new Error(`Unable to parse GitLab URL: ${gitUrl}`);
}

function parseGitLabPath(
  gitUrl: string,
  host: string,
  fullPath: string
): GitLabRepoInfo {
  // Split path into segments: org/group/subgroup/repo -> [org, group, subgroup, repo]
  const segments = fullPath.split("/");

  if (segments.length < 2) {
    throw new Error(`Unable to parse GitLab URL: ${gitUrl}`);
  }

  // Last segment is repo, everything else is namespace
  const repo = segments[segments.length - 1];
  const namespace = segments.slice(0, -1).join("/");
  const owner = segments[0]; // First segment for display

  return {
    type: "gitlab",
    gitUrl,
    repo,
    owner,
    namespace,
    host,
  };
}

export function getRepoDisplayName(repoInfo: RepoInfo): string {
  if (repoInfo.type === "azure-devops") {
    return `${repoInfo.organization}/${repoInfo.project}/${repoInfo.repo}`;
  }
  if (repoInfo.type === "gitlab") {
    return `${repoInfo.namespace}/${repoInfo.repo}`;
  }
  return `${repoInfo.owner}/${repoInfo.repo}`;
}
