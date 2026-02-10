import type { RepoConfig, Ruleset } from "../../config/index.js";
import type { RepoInfo, GitHubRepoInfo } from "../../shared/repo-detector.js";
import {
  isGitHubRepo,
  getRepoDisplayName,
} from "../../shared/repo-detector.js";
import {
  GitHubRulesetStrategy,
  type GitHubRuleset,
} from "../../strategies/github-ruleset-strategy.js";
import { diffRulesets } from "./diff.js";
import { formatRulesetPlan, RulesetPlanResult } from "./formatter.js";
import { hasGitHubAppCredentials } from "../../strategies/index.js";
import { GitHubAppTokenManager } from "../../git/github-app-token-manager.js";

// =============================================================================
// Interfaces
// =============================================================================

export interface IRulesetProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: RulesetProcessorOptions
  ): Promise<RulesetProcessorResult>;
}

// =============================================================================
// Types
// =============================================================================

export interface RulesetProcessorOptions {
  configId: string;
  dryRun?: boolean;
  managedRulesets: string[];
  noDelete?: boolean;
  token?: string;
}

export interface RulesetProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  skipped?: boolean;
  dryRun?: boolean;
  changes?: {
    create: number;
    update: number;
    delete: number;
    unchanged: number;
  };
  manifestUpdate?: {
    rulesets: string[];
  };
  planOutput?: RulesetPlanResult;
}

// =============================================================================
// Processor Implementation
// =============================================================================

/**
 * Processes ruleset configuration for a repository.
 * Handles create/update/delete operations via GitHub Rulesets API.
 */
export class RulesetProcessor implements IRulesetProcessor {
  private readonly strategy: GitHubRulesetStrategy;
  private readonly tokenManager: GitHubAppTokenManager | null;

  constructor(strategy?: GitHubRulesetStrategy) {
    this.strategy = strategy ?? new GitHubRulesetStrategy();

    if (hasGitHubAppCredentials()) {
      this.tokenManager = new GitHubAppTokenManager(
        process.env.XFG_GITHUB_APP_ID!,
        process.env.XFG_GITHUB_APP_PRIVATE_KEY!
      );
    } else {
      this.tokenManager = null;
    }
  }

  /**
   * Process rulesets for a single repository.
   */
  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: RulesetProcessorOptions
  ): Promise<RulesetProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { dryRun, managedRulesets, noDelete, token } = options;

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
    const settings = repoConfig.settings;
    const desiredRulesets = settings?.rulesets ?? {};
    const deleteOrphaned = settings?.deleteOrphaned ?? false;

    // If no rulesets configured, skip
    if (
      Object.keys(desiredRulesets).length === 0 &&
      managedRulesets.length === 0
    ) {
      return {
        success: true,
        repoName,
        message: "No rulesets configured",
        skipped: true,
      };
    }

    try {
      // Resolve App token if available, fall back to provided token
      const effectiveToken =
        token ?? (await this.getInstallationToken(githubRepo));
      const strategyOptions = { token: effectiveToken, host: githubRepo.host };
      const currentRulesets = await this.strategy.list(
        githubRepo,
        strategyOptions
      );

      // Convert desired rulesets to Map
      const desiredMap = new Map<string, Ruleset>(
        Object.entries(desiredRulesets)
      );

      // Hydrate rulesets that match desired names with full details from get()
      // The list endpoint only returns summary fields (id, name, target, enforcement)
      // but not rules, conditions, or bypass_actors needed for accurate diffing
      const fullRulesets: GitHubRuleset[] = [];
      for (const summary of currentRulesets) {
        if (desiredMap.has(summary.name)) {
          const full = await this.strategy.get(
            githubRepo,
            summary.id,
            strategyOptions
          );
          fullRulesets.push(full);
        } else {
          fullRulesets.push(summary);
        }
      }

      // Compute diff
      const changes = diffRulesets(fullRulesets, desiredMap, managedRulesets);

      // Count changes by type
      const changeCounts = {
        create: changes.filter((c) => c.action === "create").length,
        update: changes.filter((c) => c.action === "update").length,
        delete: changes.filter((c) => c.action === "delete").length,
        unchanged: changes.filter((c) => c.action === "unchanged").length,
      };

      const planOutput = formatRulesetPlan(changes);

      // Dry run mode - report planned changes without applying
      if (dryRun) {
        const summary = this.formatChangeSummary(changeCounts);
        return {
          success: true,
          repoName,
          message: `[DRY RUN] ${summary}`,
          dryRun: true,
          changes: changeCounts,
          planOutput,
          manifestUpdate: this.computeManifestUpdate(
            desiredRulesets,
            deleteOrphaned
          ),
        };
      }

      // Apply changes
      let appliedCount = 0;

      for (const change of changes) {
        switch (change.action) {
          case "create":
            if (change.desired) {
              await this.strategy.create(
                githubRepo,
                change.name,
                change.desired,
                strategyOptions
              );
              appliedCount++;
            }
            break;

          case "update":
            if (change.rulesetId !== undefined && change.desired) {
              await this.strategy.update(
                githubRepo,
                change.rulesetId,
                change.name,
                change.desired,
                strategyOptions
              );
              appliedCount++;
            }
            break;

          case "delete":
            // Check if deletion is allowed
            if (!noDelete && deleteOrphaned && change.rulesetId !== undefined) {
              await this.strategy.delete(
                githubRepo,
                change.rulesetId,
                strategyOptions
              );
              appliedCount++;
            }
            break;

          case "unchanged":
            // No action needed
            break;
        }
      }

      const summary = this.formatChangeSummary(changeCounts);
      return {
        success: true,
        repoName,
        message: appliedCount > 0 ? `Applied: ${summary}` : "No changes needed",
        changes: changeCounts,
        planOutput,
        manifestUpdate: this.computeManifestUpdate(
          desiredRulesets,
          deleteOrphaned
        ),
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

  /**
   * Format change counts into a summary string.
   */
  private formatChangeSummary(counts: {
    create: number;
    update: number;
    delete: number;
    unchanged: number;
  }): string {
    const parts: string[] = [];
    if (counts.create > 0) parts.push(`${counts.create} created`);
    if (counts.update > 0) parts.push(`${counts.update} updated`);
    if (counts.delete > 0) parts.push(`${counts.delete} deleted`);
    if (counts.unchanged > 0) parts.push(`${counts.unchanged} unchanged`);
    return parts.length > 0 ? parts.join(", ") : "no changes";
  }

  /**
   * Compute manifest update based on current config.
   * Only rulesets with deleteOrphaned enabled should be tracked.
   */
  private computeManifestUpdate(
    rulesets: Record<string, Ruleset>,
    deleteOrphaned: boolean
  ): { rulesets: string[] } | undefined {
    if (!deleteOrphaned) {
      return undefined;
    }

    // Track all ruleset names when deleteOrphaned is enabled
    const rulesetNames = Object.keys(rulesets).sort();
    return { rulesets: rulesetNames };
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
