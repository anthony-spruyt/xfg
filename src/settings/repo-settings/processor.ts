import type { RepoConfig, GitHubRepoSettings } from "../../config/index.js";
import type { RepoInfo, GitHubRepoInfo } from "../../shared/repo-detector.js";
import {
  isGitHubRepo,
  getRepoDisplayName,
} from "../../shared/repo-detector.js";
import { GitHubRepoSettingsStrategy } from "./github-repo-settings-strategy.js";
import type { IRepoSettingsStrategy } from "./types.js";
import { diffRepoSettings, hasChanges } from "./diff.js";
import { formatRepoSettingsPlan, RepoSettingsPlanResult } from "./formatter.js";
import { hasGitHubAppCredentials } from "../../vcs/index.js";
import { GitHubAppTokenManager } from "../../vcs/github-app-token-manager.js";

export interface IRepoSettingsProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: RepoSettingsProcessorOptions
  ): Promise<RepoSettingsProcessorResult>;
}

export interface RepoSettingsProcessorOptions {
  dryRun?: boolean;
  token?: string;
}

export interface RepoSettingsProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  skipped?: boolean;
  dryRun?: boolean;
  changes?: {
    adds: number;
    changes: number;
  };
  warnings?: string[];
  planOutput?: RepoSettingsPlanResult;
}

export class RepoSettingsProcessor implements IRepoSettingsProcessor {
  private readonly strategy: IRepoSettingsStrategy;
  private readonly tokenManager: GitHubAppTokenManager | null;

  constructor(strategy?: IRepoSettingsStrategy) {
    this.strategy = strategy ?? new GitHubRepoSettingsStrategy();

    if (hasGitHubAppCredentials()) {
      this.tokenManager = new GitHubAppTokenManager(
        process.env.XFG_GITHUB_APP_ID!,
        process.env.XFG_GITHUB_APP_PRIVATE_KEY!
      );
    } else {
      this.tokenManager = null;
    }
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: RepoSettingsProcessorOptions
  ): Promise<RepoSettingsProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { dryRun, token } = options;

    // Check if this is a GitHub repo
    if (!isGitHubRepo(repoInfo)) {
      return {
        success: true,
        repoName,
        message: `Skipped: ${repoName} is not a GitHub repository`,
        skipped: true,
      };
    }

    const githubRepo = repoInfo as GitHubRepoInfo;
    const desiredSettings = repoConfig.settings?.repo;

    // If no repo settings configured, skip
    if (!desiredSettings || Object.keys(desiredSettings).length === 0) {
      return {
        success: true,
        repoName,
        message: "No repo settings configured",
        skipped: true,
      };
    }

    try {
      // Resolve App token if available, fall back to provided token
      const effectiveToken =
        token ?? (await this.getInstallationToken(githubRepo));
      const strategyOptions = { token: effectiveToken, host: githubRepo.host };

      // Fetch current settings
      const currentSettings = await this.strategy.getSettings(
        githubRepo,
        strategyOptions
      );

      // Compute diff
      const changes = diffRepoSettings(currentSettings, desiredSettings);

      if (!hasChanges(changes)) {
        return {
          success: true,
          repoName,
          message: "No changes needed",
          changes: { adds: 0, changes: 0 },
        };
      }

      // Format plan output
      const planOutput = formatRepoSettingsPlan(changes);

      // Dry run mode - report planned changes without applying
      if (dryRun) {
        return {
          success: true,
          repoName,
          message: `[DRY RUN] ${planOutput.adds} to add, ${planOutput.changes} to change`,
          dryRun: true,
          changes: { adds: planOutput.adds, changes: planOutput.changes },
          warnings: planOutput.warnings,
          planOutput,
        };
      }

      // Apply changes - only send settings that actually changed
      const changedSettings = changes.reduce(
        (acc, change) => {
          if (change.action !== "unchanged") {
            acc[change.property] = change.newValue;
          }
          return acc;
        },
        {} as Record<string, unknown>
      ) as GitHubRepoSettings;

      await this.applyChanges(githubRepo, changedSettings, strategyOptions);

      return {
        success: true,
        repoName,
        message: `Applied: ${planOutput.adds} added, ${planOutput.changes} changed`,
        changes: { adds: planOutput.adds, changes: planOutput.changes },
        warnings: planOutput.warnings,
        planOutput,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        repoName,
        message: `Failed: ${message}`,
      };
    }
  }

  private async applyChanges(
    repoInfo: GitHubRepoInfo,
    settings: GitHubRepoSettings,
    options: { token?: string; host?: string }
  ): Promise<void> {
    // Extract settings that need separate API calls
    const {
      vulnerabilityAlerts,
      automatedSecurityFixes,
      privateVulnerabilityReporting,
      ...mainSettings
    } = settings;

    // Update main settings via PATCH /repos
    if (Object.keys(mainSettings).length > 0) {
      await this.strategy.updateSettings(repoInfo, mainSettings, options);
    }

    // Handle vulnerability alerts (separate endpoint)
    // Must be done before automated security fixes
    if (vulnerabilityAlerts !== undefined) {
      await this.strategy.setVulnerabilityAlerts(
        repoInfo,
        vulnerabilityAlerts,
        options
      );
    }

    // Handle private vulnerability reporting (separate endpoint)
    if (privateVulnerabilityReporting !== undefined) {
      await this.strategy.setPrivateVulnerabilityReporting(
        repoInfo,
        privateVulnerabilityReporting,
        options
      );
    }

    // Handle automated security fixes (separate endpoint)
    // Done last to ensure vulnerability alerts have been fully processed
    if (automatedSecurityFixes !== undefined) {
      await this.strategy.setAutomatedSecurityFixes(
        repoInfo,
        automatedSecurityFixes,
        options
      );
    }
  }

  /**
   * Resolves a GitHub App installation token for the given repo.
   * Returns undefined if no token manager or token resolution fails.
   */
  private async getInstallationToken(
    repoInfo: GitHubRepoInfo
  ): Promise<string | undefined> {
    if (!this.tokenManager) {
      return undefined;
    }

    try {
      const token = await this.tokenManager.getTokenForRepo(repoInfo);
      return token ?? undefined;
    } catch {
      return undefined;
    }
  }
}
