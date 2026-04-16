import { ValidationError } from "../shared/errors.js";
import type {
  RepoInfo,
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  GitLabRepoInfo,
} from "./types.js";

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
 * Assert that a RepoInfo is a GitHub repository, narrowing the type.
 * Use in GitHub-specific strategies to avoid duplicating validation logic.
 */
export function assertGitHubRepo(
  repoInfo: RepoInfo,
  context: string
): asserts repoInfo is GitHubRepoInfo {
  if (!isGitHubRepo(repoInfo)) {
    throw new ValidationError(
      `${context} requires GitHub repositories. Got: ${repoInfo.type}`
    );
  }
}

/**
 * Assert that a RepoInfo is an Azure DevOps repository, narrowing the type.
 * Use in Azure-specific strategies to avoid duplicating validation logic.
 */
export function assertAzureDevOpsRepo(
  repoInfo: RepoInfo,
  context: string
): asserts repoInfo is AzureDevOpsRepoInfo {
  if (!isAzureDevOpsRepo(repoInfo)) {
    throw new ValidationError(
      `${context} requires Azure DevOps repositories. Got: ${repoInfo.type}`
    );
  }
}

/**
 * Assert that a RepoInfo is a GitLab repository, narrowing the type.
 * Use in GitLab-specific strategies to avoid duplicating validation logic.
 */
export function assertGitLabRepo(
  repoInfo: RepoInfo,
  context: string
): asserts repoInfo is GitLabRepoInfo {
  if (!isGitLabRepo(repoInfo)) {
    throw new ValidationError(
      `${context} requires GitLab repositories. Got: ${repoInfo.type}`
    );
  }
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
