import type { RepoConfig, GitHubRepoSettings } from "../../config/index.js";
import type { GitHubRepoInfo, RepoInfo } from "../../repo/index.js";
import type { IRepoSettingsStrategy } from "./types.js";
import type { IRepoMetadataProvider, RepoMetadata } from "../../repo/index.js";
import { diffRepoSettings, hasRepoSettingsChanges } from "./diff.js";
import {
  formatRepoSettingsPlan,
  type RepoSettingsPlanResult,
} from "./formatter.js";
import {
  withGitHubGuards,
  type BaseProcessorOptions,
  type BaseProcessorResult,
  type ISettingsProcessor,
  type ChangeCounts,
  buildDryRunResult,
  buildApplyResult,
} from "../base-processor.js";

// GitHub rejects a commit message setting sent without its title, and vice versa
const PAIRED_SETTINGS: ReadonlyArray<
  readonly [keyof GitHubRepoSettings, keyof GitHubRepoSettings]
> = [
  ["squashMergeCommitTitle", "squashMergeCommitMessage"],
  ["mergeCommitTitle", "mergeCommitMessage"],
];

function withPairedSettings(
  changed: Partial<GitHubRepoSettings>,
  desired: GitHubRepoSettings
): Partial<GitHubRepoSettings> {
  const payload: Record<string, unknown> = { ...changed };
  for (const pair of PAIRED_SETTINGS) {
    if (!pair.some((key) => key in changed)) continue;
    for (const key of pair) {
      if (!(key in payload) && desired[key] !== undefined) {
        payload[key] = desired[key];
      }
    }
  }
  return payload as Partial<GitHubRepoSettings>;
}

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
  private readonly metadataProvider: IRepoMetadataProvider;

  constructor(
    strategy: IRepoSettingsStrategy,
    metadataProvider: IRepoMetadataProvider
  ) {
    this.strategy = strategy;
    this.metadataProvider = metadataProvider;
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
    const desiredSettings = repoConfig.settings?.repo;
    if (!desiredSettings || typeof desiredSettings !== "object") {
      throw new Error("applySettings called without repo settings");
    }

    const strategyOptions = { token: effectiveToken, host: githubRepo.host };

    const [currentSettings, metadata] = await Promise.all([
      this.strategy.get(githubRepo, strategyOptions),
      this.metadataProvider.getMetadata(githubRepo, strategyOptions),
    ]);

    const securityErrors = this.validateSecuritySettings(
      desiredSettings,
      metadata
    );
    if (securityErrors.length > 0) {
      return {
        success: false,
        repoName,
        message: `Failed: ${securityErrors.join("; ")}`,
      };
    }

    const changes = diffRepoSettings(currentSettings, desiredSettings);

    if (!hasRepoSettingsChanges(changes)) {
      return {
        success: true,
        repoName,
        message: "No changes needed",
        changes: { create: 0, update: 0, delete: 0, unchanged: 0 },
      };
    }

    const defaultBranchChange = changes.find(
      (c) => c.property === "defaultBranch"
    );
    if (defaultBranchChange) {
      const targetBranch = String(defaultBranchChange.newValue);
      const exists = await this.strategy.branchExists(
        githubRepo,
        targetBranch,
        strategyOptions
      );
      if (!exists) {
        const currentBranch = defaultBranchChange.oldValue
          ? String(defaultBranchChange.oldValue)
          : "unknown";
        return {
          success: false,
          repoName,
          message: `Failed: Cannot set default branch to '${targetBranch}': branch '${targetBranch}' does not exist (current: '${currentBranch}'). Create or rename the branch first.`,
        };
      }
    }

    const planOutput = formatRepoSettingsPlan(changes);

    const changeCounts = {
      create: planOutput.creates,
      update: planOutput.updates,
      delete: 0,
      unchanged: 0,
    };

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts, {
        warnings: planOutput.warnings,
        planOutput,
      });
    }

    const changedSettings: Partial<GitHubRepoSettings> = {};
    for (const change of changes) {
      (changedSettings as Record<string, unknown>)[change.property] =
        change.newValue;
    }

    await this.applyChanges(
      githubRepo,
      withPairedSettings(changedSettings, desiredSettings),
      strategyOptions
    );

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
    const {
      vulnerabilityAlerts,
      automatedSecurityFixes,
      privateVulnerabilityReporting,
      ...mainSettings
    } = settings;

    if (Object.keys(mainSettings).length > 0) {
      await this.strategy.update(repoInfo, mainSettings, options);
    }

    // Must run before automated security fixes
    if (vulnerabilityAlerts !== undefined) {
      await this.strategy.updateVulnerabilityAlerts(
        repoInfo,
        vulnerabilityAlerts,
        options
      );
    }

    if (privateVulnerabilityReporting !== undefined) {
      await this.strategy.updatePrivateVulnerabilityReporting(
        repoInfo,
        privateVulnerabilityReporting,
        options
      );
    }

    // Last, so vulnerability alerts are fully processed first
    if (automatedSecurityFixes !== undefined) {
      await this.strategy.updateAutomatedSecurityFixes(
        repoInfo,
        automatedSecurityFixes,
        options
      );
    }
  }

  private validateSecuritySettings(
    desiredSettings: GitHubRepoSettings,
    metadata: RepoMetadata
  ): string[] {
    const errors: string[] = [];
    const effectiveVisibility =
      desiredSettings.visibility ?? metadata.visibility;
    const isPublic = effectiveVisibility === "public";

    if (desiredSettings.privateVulnerabilityReporting === true && !isPublic) {
      errors.push(
        "privateVulnerabilityReporting is only available for public repositories"
      );
    }

    if (!isPublic) {
      const isUserOwned = metadata.ownerType === "User";
      const hasGHAS = metadata.hasGHAS;

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
