import type { RepoConfig, GitHubRepoSettings } from "../../config/index.js";
import type { GitHubRepoInfo, RepoInfo } from "../../shared/repo-detector.js";
import type { IRepoSettingsStrategy, CurrentRepoSettings } from "./types.js";
import { diffRepoSettings, hasChanges } from "./diff.js";
import { formatRepoSettingsPlan, RepoSettingsPlanResult } from "./formatter.js";
import {
  withGitHubGuards,
  type BaseProcessorOptions,
  type BaseProcessorResult,
  type ISettingsProcessor,
  type ChangeCounts,
  buildDryRunResult,
  buildApplyResult,
} from "../base-processor.js";

export type IRepoSettingsProcessor = ISettingsProcessor<
  RepoSettingsProcessorOptions,
  RepoSettingsProcessorResult
>;

export type RepoSettingsProcessorOptions = BaseProcessorOptions;

export interface RepoSettingsProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  warnings?: string[];
  planOutput?: RepoSettingsPlanResult;
}

export class RepoSettingsProcessor implements IRepoSettingsProcessor {
  private readonly strategy: IRepoSettingsStrategy;

  constructor(strategy: IRepoSettingsStrategy) {
    this.strategy = strategy;
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: RepoSettingsProcessorOptions
  ): Promise<RepoSettingsProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) => {
        const repoSettings = rc.settings?.repo;
        return !!repoSettings && Object.keys(repoSettings).length > 0;
      },
      emptySettingsMessage: "No repo settings configured",
      applySettings: (githubRepo, rc, opts, token, repoName) =>
        this.applySettings(githubRepo, rc, opts, token, repoName),
    });
  }

  private async applySettings(
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
      const unchangedCount = changes.filter(
        (c) => c.action === "unchanged"
      ).length;
      return {
        success: true,
        repoName,
        message: "No changes needed",
        changes: { create: 0, update: 0, delete: 0, unchanged: unchangedCount },
      };
    }

    // Format plan output
    const planOutput = formatRepoSettingsPlan(changes);

    const changeCounts = {
      create: planOutput.creates,
      update: planOutput.updates,
      delete: 0,
      unchanged: changes.filter((c) => c.action === "unchanged").length,
    };

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts, {
        warnings: planOutput.warnings,
        planOutput,
      });
    }

    // Apply changes - only send settings that actually changed
    const changedSettings: Partial<GitHubRepoSettings> = {};
    for (const change of changes) {
      if (change.action !== "unchanged") {
        (changedSettings as Record<string, unknown>)[change.property] =
          change.newValue;
      }
    }

    await this.applyChanges(githubRepo, changedSettings, strategyOptions);

    const appliedCount = Object.keys(changedSettings).length;
    return buildApplyResult(repoName, changeCounts, appliedCount, {
      warnings: planOutput.warnings,
      planOutput,
    });
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
