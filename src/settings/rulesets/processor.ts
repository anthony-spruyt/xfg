import type { RepoConfig, Ruleset } from "../../config/index.js";
import type { GitHubRepoInfo } from "../../shared/repo-detector.js";
import {
  GitHubRulesetStrategy,
  type GitHubRuleset,
} from "./github-ruleset-strategy.js";
import { diffRulesets } from "./diff.js";
import { formatRulesetPlan, RulesetPlanResult } from "./formatter.js";
import {
  BaseSettingsProcessor,
  type BaseProcessorOptions,
} from "../base-processor.js";

// =============================================================================
// Interfaces
// =============================================================================

export interface IRulesetProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: import("../../shared/repo-detector.js").RepoInfo,
    options: RulesetProcessorOptions
  ): Promise<RulesetProcessorResult>;
}

// =============================================================================
// Types
// =============================================================================

export interface RulesetProcessorOptions extends BaseProcessorOptions {
  noDelete?: boolean;
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
  planOutput?: RulesetPlanResult;
}

// =============================================================================
// Processor Implementation
// =============================================================================

/**
 * Processes ruleset configuration for a repository.
 * Handles create/update/delete operations via GitHub Rulesets API.
 */
export class RulesetProcessor
  extends BaseSettingsProcessor<RulesetProcessorOptions, RulesetProcessorResult>
  implements IRulesetProcessor
{
  private readonly strategy: GitHubRulesetStrategy;

  constructor(strategy?: GitHubRulesetStrategy) {
    super();
    this.strategy = strategy ?? new GitHubRulesetStrategy();
  }

  protected hasDesiredSettings(repoConfig: RepoConfig): boolean {
    const desiredRulesets = repoConfig.settings?.rulesets ?? {};
    return Object.keys(desiredRulesets).length > 0;
  }

  protected getEmptySettingsMessage(): string {
    return "No rulesets configured";
  }

  protected createSkipResult(
    repoName: string,
    message: string
  ): RulesetProcessorResult {
    return { success: true, repoName, message, skipped: true };
  }

  protected createErrorResult(
    repoName: string,
    message: string
  ): RulesetProcessorResult {
    return { success: false, repoName, message };
  }

  protected async processSettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: RulesetProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<RulesetProcessorResult> {
    const { dryRun, noDelete } = options;
    const settings = repoConfig.settings;
    const desiredRulesets = settings?.rulesets ?? {};
    const deleteOrphaned = settings?.deleteOrphaned ?? false;

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
    const changes = diffRulesets(fullRulesets, desiredMap, deleteOrphaned);

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
    };
  }
}
