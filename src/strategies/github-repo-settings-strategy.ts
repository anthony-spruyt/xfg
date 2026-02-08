import { ICommandExecutor, defaultExecutor } from "../command-executor.js";
import { isGitHubRepo, GitHubRepoInfo, RepoInfo } from "../repo-detector.js";
import { escapeShellArg } from "../shell-utils.js";
import type { GitHubRepoSettings } from "../config.js";
import type {
  IRepoSettingsStrategy,
  RepoSettingsStrategyOptions,
  CurrentRepoSettings,
} from "./repo-settings-strategy.js";

/**
 * Converts camelCase to snake_case.
 */
function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
}

/**
 * Converts GitHubRepoSettings (camelCase) to GitHub API format (snake_case).
 */
function configToGitHubPayload(
  settings: GitHubRepoSettings
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  // Map config properties to API properties
  const directMappings: (keyof GitHubRepoSettings)[] = [
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

/**
 * GitHub Repository Settings Strategy.
 * Manages repository settings via GitHub REST API using `gh api` CLI.
 * Note: Uses exec via ICommandExecutor for gh CLI integration, consistent
 * with other strategies in this codebase. Inputs are escaped via escapeShellArg.
 */
export class GitHubRepoSettingsStrategy implements IRepoSettingsStrategy {
  private executor: ICommandExecutor;

  constructor(executor?: ICommandExecutor) {
    this.executor = executor ?? defaultExecutor;
  }

  async getSettings(
    repoInfo: RepoInfo,
    options?: RepoSettingsStrategyOptions
  ): Promise<CurrentRepoSettings> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}`;
    const result = await this.ghApi("GET", endpoint, undefined, options);

    return JSON.parse(result) as CurrentRepoSettings;
  }

  async updateSettings(
    repoInfo: RepoInfo,
    settings: GitHubRepoSettings,
    options?: RepoSettingsStrategyOptions
  ): Promise<void> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const payload = configToGitHubPayload(settings);

    // Skip if no settings to update
    if (Object.keys(payload).length === 0) {
      return;
    }

    const endpoint = `/repos/${github.owner}/${github.repo}`;
    await this.ghApi("PATCH", endpoint, payload, options);
  }

  async setVulnerabilityAlerts(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/vulnerability-alerts`;
    const method = enable ? "PUT" : "DELETE";
    await this.ghApi(method, endpoint, undefined, options);
  }

  async setAutomatedSecurityFixes(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/automated-security-fixes`;
    const method = enable ? "PUT" : "DELETE";
    await this.ghApi(method, endpoint, undefined, options);
  }

  private validateGitHub(repoInfo: RepoInfo): void {
    if (!isGitHubRepo(repoInfo)) {
      throw new Error(
        `GitHub Repo Settings strategy requires GitHub repositories. Got: ${repoInfo.type}`
      );
    }
  }

  private async ghApi(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    endpoint: string,
    payload?: unknown,
    options?: RepoSettingsStrategyOptions
  ): Promise<string> {
    const args: string[] = ["gh", "api"];

    if (method !== "GET") {
      args.push("-X", method);
    }

    if (options?.host && options.host !== "github.com") {
      args.push("--hostname", escapeShellArg(options.host));
    }

    args.push(escapeShellArg(endpoint));

    const baseCommand = args.join(" ");

    const tokenPrefix = options?.token
      ? `GH_TOKEN=${escapeShellArg(options.token)} `
      : "";

    if (
      payload &&
      (method === "POST" || method === "PUT" || method === "PATCH")
    ) {
      const payloadJson = JSON.stringify(payload);
      const command = `echo ${escapeShellArg(payloadJson)} | ${tokenPrefix}${baseCommand} --input -`;
      return await this.executor.exec(command, process.cwd());
    }

    const command = `${tokenPrefix}${baseCommand}`;
    return await this.executor.exec(command, process.cwd());
  }
}
