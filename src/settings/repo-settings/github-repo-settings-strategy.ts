import {
  ICommandExecutor,
  defaultExecutor,
} from "../../shared/command-executor.js";
import {
  assertGitHubRepo,
  type GitHubRepoInfo,
  type RepoInfo,
} from "../../shared/repo-detector.js";
import {
  GhApiClient,
  parseApiJson,
  isHttp404Error,
  type GhApiOptions,
} from "../../shared/gh-api-utils.js";
import type { GitHubRepoSettings } from "../../config/index.js";
import type { IRepoSettingsStrategy, CurrentRepoSettings } from "./types.js";
import { camelToSnake } from "../../shared/string-utils.js";

/**
 * Converts GitHubRepoSettings (camelCase) to GitHub API format (snake_case).
 */
function configToGitHubPayload(
  settings: GitHubRepoSettings
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  // Map config properties to API properties
  const directMappings: (keyof GitHubRepoSettings)[] = [
    "description",
    "hasIssues",
    "hasProjects",
    "hasWiki",
    "hasDiscussions",
    "isTemplate",
    "allowForking",
    "visibility",
    "archived",
    "allowSquashMerge",
    "allowMergeCommit",
    "allowRebaseMerge",
    "allowAutoMerge",
    "deleteBranchOnMerge",
    "allowUpdateBranch",
    "squashMergeCommitTitle",
    "squashMergeCommitMessage",
    "mergeCommitTitle",
    "mergeCommitMessage",
    "webCommitSignoffRequired",
    "defaultBranch",
  ];

  for (const key of directMappings) {
    if (settings[key] !== undefined) {
      payload[camelToSnake(key)] = settings[key];
    }
  }

  // Handle security_and_analysis for secret scanning
  if (
    settings.secretScanning !== undefined ||
    settings.secretScanningPushProtection !== undefined
  ) {
    payload.security_and_analysis = {
      ...(settings.secretScanning !== undefined && {
        secret_scanning: {
          status: settings.secretScanning ? "enabled" : "disabled",
        },
      }),
      ...(settings.secretScanningPushProtection !== undefined && {
        secret_scanning_push_protection: {
          status: settings.secretScanningPushProtection
            ? "enabled"
            : "disabled",
        },
      }),
    };
  }

  return payload;
}

interface GitHubRepoSettingsStrategyOptions {
  retries?: number;
}

export class GitHubRepoSettingsStrategy implements IRepoSettingsStrategy {
  private api: GhApiClient;

  constructor(
    executor?: ICommandExecutor,
    options?: GitHubRepoSettingsStrategyOptions
  ) {
    this.api = new GhApiClient(
      executor ?? defaultExecutor,
      options?.retries ?? 3
    );
  }

  async getSettings(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<CurrentRepoSettings> {
    assertGitHubRepo(repoInfo, "GitHub Repo Settings strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}`;
    const result = await this.api.call("GET", endpoint, { options });
    const parsed = parseApiJson<
      CurrentRepoSettings & { owner?: { type?: "User" | "Organization" } }
    >(result, "repo settings response");
    const settings = parsed as CurrentRepoSettings;

    // Extract owner type from nested API response
    settings.owner_type = parsed.owner?.type;

    settings.vulnerability_alerts = await this.getVulnerabilityAlerts(
      repoInfo,
      options
    );
    // Pass vulnerability_alerts state - automated security fixes requires it enabled
    settings.automated_security_fixes = await this.getAutomatedSecurityFixes(
      repoInfo,
      options,
      settings.vulnerability_alerts
    );
    settings.private_vulnerability_reporting =
      await this.getPrivateVulnerabilityReporting(repoInfo, options);

    return settings;
  }

  async updateSettings(
    repoInfo: RepoInfo,
    settings: GitHubRepoSettings,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Repo Settings strategy");

    const payload = configToGitHubPayload(settings);

    // Skip if no settings to update
    if (Object.keys(payload).length === 0) {
      return;
    }

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}`;
    await this.api.call("PATCH", endpoint, { payload, options });
  }

  async setVulnerabilityAlerts(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Repo Settings strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/vulnerability-alerts`;
    const method = enable ? "PUT" : "DELETE";
    await this.api.call(method, endpoint, { options });
  }

  async setAutomatedSecurityFixes(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Repo Settings strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/automated-security-fixes`;
    const method = enable ? "PUT" : "DELETE";
    await this.api.call(method, endpoint, { options });
  }

  async setPrivateVulnerabilityReporting(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Repo Settings strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/private-vulnerability-reporting`;
    const method = enable ? "PUT" : "DELETE";
    await this.api.call(method, endpoint, { options });
  }

  private async getVulnerabilityAlerts(
    github: GitHubRepoInfo,
    options?: GhApiOptions
  ): Promise<boolean> {
    const endpoint = `/repos/${github.owner}/${github.repo}/vulnerability-alerts`;
    try {
      await this.api.call("GET", endpoint, { options });
      return true; // 204 = enabled
    } catch (error) {
      if (isHttp404Error(error)) {
        return false; // 404 = disabled
      }
      throw error; // Re-throw other errors
    }
  }

  private async getAutomatedSecurityFixes(
    github: GitHubRepoInfo,
    options?: GhApiOptions,
    _vulnerabilityAlertsEnabled?: boolean
  ): Promise<boolean> {
    // Note: GitHub returns JSON with {enabled: boolean} for this endpoint
    const endpoint = `/repos/${github.owner}/${github.repo}/automated-security-fixes`;
    try {
      const result = await this.api.call("GET", endpoint, { options });
      // Parse JSON response - GitHub returns {"enabled": true/false}
      if (result) {
        const data = parseApiJson<{ enabled?: boolean }>(
          result,
          "automated security fixes response"
        );
        return data.enabled === true;
      }
      // Empty response (204) means enabled
      return true;
    } catch (error) {
      if (isHttp404Error(error)) {
        return false;
      }
      throw error;
    }
  }

  private async getPrivateVulnerabilityReporting(
    github: GitHubRepoInfo,
    options?: GhApiOptions
  ): Promise<boolean> {
    const endpoint = `/repos/${github.owner}/${github.repo}/private-vulnerability-reporting`;
    try {
      const result = await this.api.call("GET", endpoint, { options });
      const data = parseApiJson<{ enabled?: boolean }>(
        result,
        "private vulnerability reporting response"
      );
      return data.enabled === true;
    } catch (error) {
      if (isHttp404Error(error)) {
        return false; // 404 = not available (e.g. private repos)
      }
      throw error; // Re-throw other errors
    }
  }
}
