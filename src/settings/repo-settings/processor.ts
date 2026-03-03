import type { RepoConfig, GitHubRepoSettings } from "../../config/index.js";
import type { GitHubRepoInfo } from "../../shared/repo-detector.js";
import { GitHubRepoSettingsStrategy } from "./github-repo-settings-strategy.js";
import type { IRepoSettingsStrategy, CurrentRepoSettings } from "./types.js";
import { diffRepoSettings, hasChanges } from "./diff.js";
import { formatRepoSettingsPlan, RepoSettingsPlanResult } from "./formatter.js";
import {
  BaseSettingsProcessor,
  type BaseProcessorOptions,
} from "../base-processor.js";

export interface IRepoSettingsProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: import("../../shared/repo-detector.js").RepoInfo,
    options: RepoSettingsProcessorOptions
  ): Promise<RepoSettingsProcessorResult>;
}

export type RepoSettingsProcessorOptions = BaseProcessorOptions;

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

export class RepoSettingsProcessor
  extends BaseSettingsProcessor<
    RepoSettingsProcessorOptions,
    RepoSettingsProcessorResult
  >
  implements IRepoSettingsProcessor
{
  private readonly strategy: IRepoSettingsStrategy;

  constructor(strategy?: IRepoSettingsStrategy) {
    super();
    this.strategy = strategy ?? new GitHubRepoSettingsStrategy();
  }

  protected hasDesiredSettings(repoConfig: RepoConfig): boolean {
    const desiredSettings = repoConfig.settings?.repo;
    return !!desiredSettings && Object.keys(desiredSettings).length > 0;
  }

  protected getEmptySettingsMessage(): string {
    return "No repo settings configured";
  }

  protected createSkipResult(
    repoName: string,
    message: string
  ): RepoSettingsProcessorResult {
    return { success: true, repoName, message, skipped: true };
  }

  protected createErrorResult(
    repoName: string,
    message: string
  ): RepoSettingsProcessorResult {
    return { success: false, repoName, message };
  }

  protected async processSettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: RepoSettingsProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<RepoSettingsProcessorResult> {
    const { dryRun } = options;
    const desiredSettings = repoConfig.settings!.repo!;

    const strategyOptions = { token: effectiveToken, host: githubRepo.host };

    // Fetch current settings
    const currentSettings = await this.strategy.getSettings(
      githubRepo,
      strategyOptions
    );

    // Validate security settings compatibility
    const securityErrors = this.validateSecuritySettings(
      desiredSettings,
      currentSettings
    );
    if (securityErrors.length > 0) {
      return {
        success: false,
        repoName,
        message: `Failed: ${securityErrors.join("; ")}`,
      };
    }

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

  private validateSecuritySettings(
    desiredSettings: GitHubRepoSettings,
    currentSettings: CurrentRepoSettings
  ): string[] {
    const errors: string[] = [];
    const isPublic = currentSettings.visibility === "public";

    // privateVulnerabilityReporting is only available on public repos
    if (desiredSettings.privateVulnerabilityReporting === true && !isPublic) {
      errors.push(
        "privateVulnerabilityReporting is only available for public repositories"
      );
    }

    // secretScanning and secretScanningPushProtection:
    // - Available on public repos (free)
    // - Available on org private/internal repos with GHAS (security_and_analysis is populated)
    // - NOT available on user private repos or org private/internal repos without GHAS
    if (!isPublic) {
      const isUserOwned = currentSettings.owner_type === "User";
      const hasGHAS = currentSettings.security_and_analysis != null;

      if (
        desiredSettings.secretScanning === true &&
        (isUserOwned || !hasGHAS)
      ) {
        errors.push(
          "secretScanning requires GitHub Advanced Security (not available for this repository)"
        );
      }

      if (
        desiredSettings.secretScanningPushProtection === true &&
        (isUserOwned || !hasGHAS)
      ) {
        errors.push(
          "secretScanningPushProtection requires GitHub Advanced Security (not available for this repository)"
        );
      }
    }

    return errors;
  }
}
